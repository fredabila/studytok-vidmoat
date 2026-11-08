// Who pays for a video: the free allowance, then the student's own Vidmoat account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-billing-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_FREE_VIDEOS = '2';
process.env.STUDYTOK_TOKEN_SECRET = 'test-secret';
process.env.VIDMOAT_OAUTH_CLIENT_ID = 'client_123';
process.env.VIDMOAT_OAUTH_CLIENT_SECRET = 'secret_456';
process.env.VIDMOAT_API_KEY = 'vmk_test_house';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const billing = await import('../server/core/billing.js');
const { startSignIn, finishSignIn, GENERATE_SCOPE } = await import('../server/core/auth.js');
const { vidmoat, withCredential, onOwnAccount } = await import('../server/core/vidmoat.js');
const { saveProfile, linkVidmoat } = await import('../server/feed/index.js');

const req = { headers: { host: 'studytok.example', 'x-forwarded-proto': 'https' } };

test('tokens are sealed at rest and readable only with the secret', () => {
  const sealed = billing.seal({ accessToken: 'at_1', refreshToken: 'rt_1', expiresAt: 1 });
  assert.ok(!sealed.includes('at_1') && sealed.startsWith('v1.'));
  assert.deepEqual(billing.open(sealed), { accessToken: 'at_1', refreshToken: 'rt_1', expiresAt: 1 });
  assert.equal(billing.open(sealed.slice(0, -2) + 'xx'), null, 'a tampered blob opens to nothing');
});

test('the free allowance is counted per student, then generation needs their own account', async () => {
  const user = await saveProfile(null, { profile: { level: 'university' } });
  assert.deepEqual(await billing.credentialFor(user.id), { mode: 'house' });
  assert.deepEqual(await billing.credentialFor(user.id), { mode: 'house' });
  assert.deepEqual(await billing.credentialFor(user.id), { mode: 'exhausted', reason: 'allowance' });
  const status = await billing.billingStatus(await db.getUser(user.id));
  assert.equal(status.mode, 'house'); assert.equal(status.houseUsed, 2); assert.equal(status.houseLeft, 0); assert.equal(status.connected, false);
  assert.deepEqual(await billing.credentialFor('cron'), { mode: 'house' }, 'the cron never counts');
});

test('connecting an account asks for the generation scopes, keeps sealed tokens, and switches to own credits', async () => {
  const user = await saveProfile(null, { profile: { level: 'university' } });
  const { user: linked } = await linkVidmoat(user.id, { id: 'acct_9', name: 'Kofi', email: 'k@example.com' });
  const { url, state } = await startSignIn(req, { purpose: 'generate' });
  assert.equal(new URL(url).searchParams.get('scope'), GENERATE_SCOPE);
  assert.ok(!GENERATE_SCOPE.includes('render') && !GENERATE_SCOPE.includes('cast') && !GENERATE_SCOPE.includes('voices'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/oauth/token')) return new Response(JSON.stringify({ access_token: 'at_own', refresh_token: 'rt_own', expires_in: 3600, scope: GENERATE_SCOPE }), { status: 200 });
    if (String(url).endsWith('/v1/me')) return new Response(JSON.stringify({ account: { id: 'acct_9', name: 'Kofi', email: 'k@example.com', credits: { remaining: 120 }, plan: { id: 'creator' } } }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  try {
    const result = await finishSignIn({ code: 'c', state });
    assert.equal(result.purpose, 'generate'); assert.equal(result.tokens.accessToken, 'at_own'); assert.deepEqual(result.missingScopes, []); assert.equal(result.credits, 120);
    await billing.connectOwnAccount(linked.id, result.tokens);
    const stored = await db.getUser(linked.id);
    assert.ok(stored.vidmoatTokens && !JSON.stringify(stored).includes('at_own'), 'tokens are sealed in storage');
    const cred = await billing.credentialFor(linked.id);
    assert.deepEqual(cred, { mode: 'own', token: 'at_own' });
    const status = await billing.billingStatus(await db.getUser(linked.id), { fetchMe: async (token) => { assert.equal(token, 'at_own'); return { account: { credits: { remaining: 120 }, plan: { id: 'creator' } } }; } });
    assert.equal(status.mode, 'own'); assert.equal(status.credits, 120); assert.equal(status.plan, 'creator');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a 402 on the student\'s account pauses their generation; a top-up clears it; disconnect returns to the allowance', async () => {
  const user = await saveProfile(null, { profile: { level: 'university' } });
  await billing.connectOwnAccount(user.id, { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000, scope: GENERATE_SCOPE });
  assert.equal(billing.problemFromError({ status: 402, code: 'insufficient_credits' }), 'exhausted');
  assert.equal(billing.problemFromError({ status: 402, code: 'plan_required' }), 'plan');
  assert.equal(billing.problemFromError({ status: 401, code: 'invalid_token' }), 'reconnect');
  assert.equal(billing.problemFromError({ status: 500 }), null);
  await billing.noteProblem(user.id, 'exhausted');
  assert.deepEqual(await billing.credentialFor(user.id), { mode: 'exhausted', reason: 'exhausted' });
  const status = await billing.billingStatus(await db.getUser(user.id), { fetchMe: async () => ({ account: { credits: { remaining: 500 } } }) });
  assert.equal(status.problem, null, 'a positive balance clears the problem');
  assert.equal((await billing.credentialFor(user.id)).mode, 'own');
  await billing.disconnectOwnAccount(user.id);
  const after = await db.getUser(user.id);
  assert.equal(after.vidmoatTokens, undefined);
  assert.deepEqual(await billing.credentialFor(user.id), { mode: 'house' });
});

test('expiring tokens are refreshed (rotating refresh token) before use', async () => {
  const user = await saveProfile(null, { profile: { level: 'university' } });
  await billing.connectOwnAccount(user.id, { accessToken: 'old', refreshToken: 'rt_old', expiresAt: Date.now() + 30_000, scope: GENERATE_SCOPE });
  const realFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (url, opts) => { body = new URLSearchParams(opts.body); return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'rt_new', expires_in: 3600 }), { status: 200 }); };
  try {
    assert.deepEqual(await billing.credentialFor(user.id), { mode: 'own', token: 'new' });
    assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('refresh_token'), 'rt_old');
    assert.equal(billing.open((await db.getUser(user.id)).vidmoatTokens).refreshToken, 'rt_new');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the Vidmoat client sends the student\'s token inside withCredential and the house key outside it', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => { seen.push(opts.headers.Authorization); return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await vidmoat('GET', '/v1/me');
    await withCredential('at_student', async () => { assert.equal(onOwnAccount(), true); await vidmoat('GET', '/v1/me'); });
    assert.equal(onOwnAccount(), false);
    await vidmoat('GET', '/v1/me');
    assert.deepEqual(seen, ['Bearer vmk_test_house', 'Bearer at_student', 'Bearer vmk_test_house']);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(kv);
});
