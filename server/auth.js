// "Sign in with Vidmoat", used ONLY to identify a student so their StudyTok profile follows
// them across devices. We request the single read-only scope `account.read` (no scope that can
// spend credits is ever requested), read the account id/name/email once from /v1/me, and
// discard the tokens immediately. All generation keeps running on StudyTok's own API key.
//
// Flow: authorization code + PKCE (S256) with a state bound to a short-lived cookie.
//
// The OAuth client: VIDMOAT_OAUTH_CLIENT_ID/_SECRET when set; otherwise StudyTok registers
// itself once per redirect URI with RFC 7591 dynamic client registration
// (POST /api/oauth/register) and keeps the client in storage. Registration grants access to
// nothing by itself, and every authorize request names `account.read` explicitly (a dynamic
// client that names no scope would be asking for nearly every scope).

import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { kv } from './kv.js';

const AUTHORIZE = 'https://www.vidmoat.com/oauth/authorize';
const TOKEN = 'https://api.vidmoat.com/api/oauth/token';
const ME = 'https://api.vidmoat.com/v1/me';
const REGISTER = 'https://api.vidmoat.com/api/oauth/register';
export const SCOPE = 'account.read';

export const signInEnabled = () => config.oauth.enabled;

/** The OAuth client for this redirect URI: configured, stored, or registered now. */
export async function oauthClient(redirect) {
  if (config.oauth.clientId && config.oauth.clientSecret) return { clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret };
  const key = `oauth:client:${redirect}`;
  const stored = await kv.get(key);
  if (stored?.clientId) return stored;
  // One registration at a time (Vidmoat allows 10 an hour per IP).
  if (!(await kv.set('lock:oauth:register', 1, { nx: true, ex: 60 }))) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const again = await kv.get(key);
      if (again?.clientId) return again;
    }
    throw Object.assign(new Error('Sign-in is being set up. Please try again in a minute.'), { status: 503 });
  }
  try {
    const res = await fetch(REGISTER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_name: config.oauth.clientName, redirect_uris: [redirect] }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.client_id || !body.client_secret) {
      throw Object.assign(new Error(`Could not register with Vidmoat (${body.error?.code || body.error || res.status})`), { status: 502 });
    }
    const client = { clientId: body.client_id, clientSecret: body.client_secret, registeredAt: new Date().toISOString(), redirectUri: redirect };
    await kv.set(key, client);
    return client;
  } finally {
    await kv.del('lock:oauth:register');
  }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function originOf(req) {
  if (config.oauth.publicUrl) return config.oauth.publicUrl;
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (process.env.VERCEL ? 'https' : 'http');
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}
export const redirectUri = (req) => `${originOf(req)}/api/auth/vidmoat/callback`;

/** Starts sign-in: returns { url, state } and remembers the PKCE verifier for 10 minutes. */
export async function startSignIn(req) {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const redirect = redirectUri(req);
  const client = await oauthClient(redirect);
  await kv.set(`oauth:${state}`, { verifier, redirectUri: redirect, clientId: client.clientId }, { ex: 600 });
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: client.clientId, redirect_uri: redirect,
    scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString(), state };
}

/**
 * Completes sign-in. Returns the Vidmoat identity { id, name, email }.
 * Tokens are used for exactly one /v1/me call and never stored.
 */
export async function finishSignIn({ code, state }) {
  const saved = state && (await kv.get(`oauth:${state}`));
  if (!saved) throw Object.assign(new Error('Sign-in expired. Please try again.'), { status: 400 });
  await kv.del(`oauth:${state}`);
  const client = await oauthClient(saved.redirectUri);

  const tokenRes = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: saved.redirectUri, code_verifier: saved.verifier,
      client_id: client.clientId, client_secret: client.clientSecret,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    throw Object.assign(new Error(`Vidmoat sign-in failed (${token.error || tokenRes.status})`), { status: 502 });
  }
  const granted = String(token.scope || SCOPE).split(/\s+/);
  if (granted.some((s) => s !== SCOPE)) console.warn('[auth] unexpected scopes granted:', granted.join(' '));

  const meRes = await fetch(ME, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(20_000) });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me.account?.id) throw Object.assign(new Error('Could not read your Vidmoat account'), { status: 502 });
  return { id: String(me.account.id), name: me.account.name || '', email: me.account.email || '' };
}
