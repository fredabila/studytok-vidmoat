// Who pays for a student's videos (docs/BILLING.md).
//
// Every student starts on the HOUSE account: StudyGraph's own Vidmoat key makes their first
// `config.billing.freeVideos` videos. After that they connect their OWN Vidmoat account
// (OAuth with the generation scopes) and every video they trigger is made on their account,
// with their credits; when those run out, Vidmoat's 402 tells us and the app points them to
// credit packs or a plan upgrade. Videos are shared in the library whoever paid for them, so
// a student on an empty balance still gets everything already made.
//
// OAuth tokens are sealed with AES-256-GCM before they are stored (STUDYTOK_TOKEN_SECRET),
// refreshed shortly before they expire, and dropped on disconnect.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { kv } from './kv.js';
import * as db from './db.js';
import { refreshTokens } from './auth.js';

export const MODES = ['house', 'own'];

// ---- Token sealing ------------------------------------------------------------------------------
const key = () => createHash('sha256').update(config.billing.tokenSecret || config.oauth.clientSecret || 'studytok-dev-only').digest();
let warned = false;
export function seal(obj) {
  if (!config.billing.tokenSecret && !warned) { warned = true; console.warn('[billing] STUDYTOK_TOKEN_SECRET is not set: tokens are sealed with a derived key'); }
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${enc.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}
export function open(sealed) {
  try {
    const [v, iv, enc, tag] = String(sealed || '').split('.');
    if (v !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8'));
  } catch { return null; }
}

// ---- Per-student billing state ----------------------------------------------------------------
export const emptyBilling = () => ({ mode: 'house', houseUsed: 0, connectedAt: null, exhaustedAt: null, problem: null, lastCredits: null, lastCreditsAt: 0 });
const billingOf = (user) => ({ ...emptyBilling(), ...(user?.billing || {}) });

/** Stores a student's own-account tokens and switches them to their account. */
export async function connectOwnAccount(userId, tokens) {
  const user = await db.getUser(userId);
  if (!user) throw new Error('No such user');
  user.vidmoatTokens = seal({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, scope: tokens.scope });
  user.billing = { ...billingOf(user), mode: 'own', connectedAt: new Date().toISOString(), exhaustedAt: null, problem: null, lastCredits: null, lastCreditsAt: 0 };
  await db.saveUser(user);
  return user;
}

/** Drops the tokens; the student is back on the house allowance (whatever is left of it). */
export async function disconnectOwnAccount(userId) {
  const user = await db.getUser(userId);
  if (!user) throw new Error('No such user');
  delete user.vidmoatTokens;
  user.billing = { ...billingOf(user), mode: 'house', connectedAt: null, exhaustedAt: null, problem: null, lastCredits: null };
  await db.saveUser(user);
  return user;
}

export async function setMode(userId, mode) {
  const user = await db.getUser(userId);
  if (!user || !MODES.includes(mode)) throw Object.assign(new Error('Bad mode'), { status: 400 });
  if (mode === 'own' && !user.vidmoatTokens) throw Object.assign(new Error('Connect your Vidmoat account first'), { status: 400 });
  user.billing = { ...billingOf(user), mode };
  await db.saveUser(user);
  return user;
}

/** A valid access token for the student's own account, refreshing it when it is about to expire. */
export async function ownToken(user) {
  const t = open(user.vidmoatTokens);
  if (!t?.accessToken) return null;
  if (t.expiresAt && Date.now() > t.expiresAt - 120_000) {
    if (!t.refreshToken) return null;
    const lock = `lock:refresh:${user.id}`;
    if (!(await kv.set(lock, 1, { nx: true, ex: 30 }))) {
      const again = open((await db.getUser(user.id))?.vidmoatTokens);
      return again?.accessToken && Date.now() < again.expiresAt - 60_000 ? again.accessToken : null;
    }
    try {
      const fresh = await refreshTokens(t.refreshToken);
      user.vidmoatTokens = seal({ ...t, ...fresh });
      await db.saveUser(user);
      return fresh.accessToken;
    } catch (err) {
      console.warn(`[billing] token refresh failed for ${user.id.slice(0, 8)}: ${err.message}`);
      await noteProblem(user.id, 'reconnect');
      return null;
    } finally {
      await kv.del(lock);
    }
  }
  return t.accessToken;
}

/**
 * Decides who pays for one more video requested by this student, and counts it.
 * @returns {Promise<{ mode: 'house'|'own', token?: string } | { mode: 'exhausted', reason }>}
 */
export async function credentialFor(userId) {
  if (!userId || userId === 'cron') return { mode: 'house' };
  const user = await db.getUser(userId);
  if (!user) return { mode: 'house' };
  const b = billingOf(user);
  if (b.mode === 'own' && user.vidmoatTokens) {
    if (b.problem === 'exhausted' && b.exhaustedAt && Date.now() - Date.parse(b.exhaustedAt) < 10 * 60 * 1000) return { mode: 'exhausted', reason: 'exhausted' };
    if (b.problem === 'plan') return { mode: 'exhausted', reason: 'plan' };
    const token = await ownToken(user);
    if (token) return { mode: 'own', token };
    return { mode: 'exhausted', reason: 'reconnect' };
  }
  if (b.houseUsed < config.billing.freeVideos) {
    user.billing = { ...b, houseUsed: b.houseUsed + 1 };
    await db.saveUser(user);
    return { mode: 'house' };
  }
  return { mode: 'exhausted', reason: 'allowance' };
}

/** A generation on the student's own account failed for a billing reason (402 / 401). */
export async function noteProblem(userId, problem, extra = {}) {
  const user = await db.getUser(userId);
  if (!user) return;
  user.billing = { ...billingOf(user), problem, exhaustedAt: problem === 'exhausted' ? new Date().toISOString() : null, ...extra };
  await db.saveUser(user);
}

/** Maps a Vidmoat error on the student's account to a billing problem (or null). */
export function problemFromError(err) {
  if (!err) return null;
  if (err.status === 401 || err.code === 'invalid_token' || err.code === 'insufficient_scope') return 'reconnect';
  if (err.status === 402) return err.code === 'plan_required' ? 'plan' : 'exhausted';
  return null;
}

/** What the app shows on the Profile and in the feed. */
export async function billingStatus(user, { fetchMe } = {}) {
  const b = billingOf(user);
  const connected = Boolean(user?.vidmoatTokens);
  const out = {
    mode: b.mode === 'own' && connected ? 'own' : 'house',
    connected,
    freeVideos: config.billing.freeVideos,
    houseUsed: Math.min(b.houseUsed, config.billing.freeVideos),
    houseLeft: Math.max(0, config.billing.freeVideos - b.houseUsed),
    problem: b.problem,
    credits: b.lastCredits,
    plan: b.plan || null,
    billingUrl: config.billing.billingUrl,
  };
  // Refresh the student's own balance now and then (one /v1/me on their token).
  if (out.mode === 'own' && fetchMe && Date.now() - (b.lastCreditsAt || 0) > 5 * 60 * 1000) {
    try {
      const token = await ownToken(user);
      if (token) {
        const me = await fetchMe(token);
        out.credits = me.account?.credits?.remaining ?? null;
        out.plan = me.account?.plan?.id || null;
        user.billing = { ...billingOf(user), lastCredits: out.credits, lastCreditsAt: Date.now(), plan: out.plan, ...(out.credits > 0 && b.problem === 'exhausted' ? { problem: null, exhaustedAt: null } : {}) };
        await db.saveUser(user);
        out.problem = user.billing.problem;
      }
    } catch { /* keep the cached values */ }
  }
  return out;
}
