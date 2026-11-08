// "Sign in with Vidmoat", used ONLY to identify a student so their StudyTok profile follows
// them across devices. We request the single read-only scope `account.read` (no scope that can
// spend credits is ever requested), read the account id/name/email once from /v1/me, and
// discard the tokens immediately. All generation keeps running on StudyTok's own API key.
//
// Flow: authorization code + PKCE (S256) with a state bound to a short-lived cookie.

import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { kv } from './kv.js';

const AUTHORIZE = 'https://www.vidmoat.com/oauth/authorize';
const TOKEN = 'https://api.vidmoat.com/api/oauth/token';
const ME = 'https://api.vidmoat.com/v1/me';
export const SCOPE = 'account.read';

export const signInEnabled = () => Boolean(config.oauth.clientId && config.oauth.clientSecret);

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
  await kv.set(`oauth:${state}`, { verifier, redirectUri: redirectUri(req) }, { ex: 600 });
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: config.oauth.clientId, redirect_uri: redirectUri(req),
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

  const tokenRes = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: saved.redirectUri, code_verifier: saved.verifier,
      client_id: config.oauth.clientId, client_secret: config.oauth.clientSecret,
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
