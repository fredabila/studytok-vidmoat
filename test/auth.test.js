// Sign in with Vidmoat: identity only. Vidmoat's token and /v1/me endpoints are stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-auth-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.VIDMOAT_OAUTH_CLIENT_ID = 'client_123';
process.env.VIDMOAT_OAUTH_CLIENT_SECRET = 'secret_456';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { startSignIn, finishSignIn, SCOPE, signInEnabled } = await import('../server/core/auth.js');
const { saveProfile, linkVidmoat } = await import('../server/feed/index.js');
const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');

const req = { headers: { host: 'studytok.example', 'x-forwarded-proto': 'https' } };

test('sign-in asks only for account.read, with PKCE S256 and the exact redirect URI', async () => {
  assert.equal(signInEnabled(), true);
  assert.equal(SCOPE, 'account.read');
  const { url, state } = await startSignIn(req);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://www.vidmoat.com/oauth/authorize');
  assert.equal(u.searchParams.get('scope'), 'account.read');
  assert.equal(u.searchParams.get('client_id'), 'client_123');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://studytok.example/api/auth/vidmoat/callback');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('state'), state);
  const saved = await kv.get(`oauth:${state}`);
  const expected = createHash('sha256').update(saved.verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(u.searchParams.get('code_challenge'), expected);
});

test('callback exchanges the code once, reads /v1/me, and keeps no tokens', async () => {
  const { state } = await startSignIn(req);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).endsWith('/api/oauth/token')) return new Response(JSON.stringify({ access_token: 'at_secret', refresh_token: 'rt_secret', scope: 'account.read' }), { status: 200 });
    if (String(url).endsWith('/v1/me')) return new Response(JSON.stringify({ account: { id: 'acct_1', name: 'Ama Mensah', email: 'ama@example.com' } }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  try {
    const identity = await finishSignIn({ code: 'code_abc', state });
    assert.deepEqual(identity, { id: 'acct_1', name: 'Ama Mensah', email: 'ama@example.com' });
    const body = new URLSearchParams(calls[0].opts.body);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code'), 'code_abc');
    assert.ok(body.get('code_verifier'));
    assert.equal(calls[1].opts.headers.Authorization, 'Bearer at_secret');
    await assert.rejects(finishSignIn({ code: 'code_abc', state }), /expired/, 'state is single-use');
    const dump = JSON.stringify([...kv.data.entries()].map(([k, v]) => [k, v instanceof Set ? [...v] : v instanceof Map ? [...v] : v]));
    assert.ok(!dump.includes('at_secret') && !dump.includes('rt_secret'), 'tokens are never stored');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('first sign-in links the guest profile; a new device restores it', async () => {
  const guest = await saveProfile(null, { profile: { level: 'university', program: 'Computer Science' }, programKeys: ['cat:uni-cs'], units: ['uni-cs-u1'] });
  const identity = { id: 'acct_2', name: 'Kofi', email: 'kofi@example.com' };
  const first = await linkVidmoat(guest.id, identity);
  assert.equal(first.user.id, guest.id);
  assert.equal(first.restored, false);
  assert.equal((await db.getUser(guest.id)).vidmoat.email, 'kofi@example.com');

  // Another device: a different (or no) guest session signs in with the same account.
  const second = await linkVidmoat(null, identity);
  assert.equal(second.user.id, guest.id, 'the same StudyGraph profile comes back');
  assert.equal(second.restored, true);
  assert.deepEqual(second.user.units, ['uni-cs-u1']);

  // A brand-new account with no guest profile gets an empty profile that still needs setup.
  const fresh = await linkVidmoat(null, { id: 'acct_3', name: 'New', email: 'new@example.com' });
  assert.equal(fresh.user.setupDone, false);
});

test('without configured credentials, StudyGraph registers its own client once and reuses it', async () => {
  const { config } = await import('../server/core/config.js');
  const saved = { id: config.oauth.clientId, secret: config.oauth.clientSecret };
  config.oauth.clientId = ''; config.oauth.clientSecret = '';
  const realFetch = globalThis.fetch;
  const registrations = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/api/oauth/register')) {
      registrations.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ client_id: 'dyn_abc', client_secret: 'dyn_secret', client_secret_expires_at: 0 }), { status: 201 });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const a = await startSignIn(req);
    const b = await startSignIn(req);
    assert.equal(registrations.length, 1, 'registered once, then reused');
    assert.deepEqual(registrations[0], { client_name: 'StudyGraph', redirect_uris: ['https://studytok.example/api/auth/vidmoat/callback'] });
    for (const { url } of [a, b]) {
      const u = new URL(url);
      assert.equal(u.searchParams.get('client_id'), 'dyn_abc');
      assert.equal(u.searchParams.get('scope'), 'account.read', 'always names the single read-only scope');
    }
  } finally {
    globalThis.fetch = realFetch;
    config.oauth.clientId = saved.id; config.oauth.clientSecret = saved.secret;
  }
});
