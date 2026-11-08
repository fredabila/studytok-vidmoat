// Google Sheet mirror: one row per student, a log of joins and milestones, and a daily summary,
// so you can watch StudyTok grow in a spreadsheet without running a database of your own.
//
// The sheet is written by a tiny Google Apps Script bound to it (scripts/sheet/Code.gs), deployed
// as a web app. StudyTok POSTs JSON to its URL with a shared secret:
//   { secret, ops: [{ op: 'upsert', tab: 'Users', key: 'User ID', rows: [...] },
//                   { op: 'append', tab: 'Joins', rows: [...] }] }
// Nothing here is needed for the app to work: with no STUDYTOK_SHEET_URL every call is a no-op.
// Rows carry the same personal data the app already holds (name and email from Vidmoat sign-in).

import { kv, scanKeys } from './kv.js';
import * as db from './db.js';
import { getSignals, streakOf, studentStats } from '../feed/events.js';
import { getProgress } from '../feed/index.js';
import { mastery } from '../feed/ranking.js';
import { LEVEL_BY_ID } from '../curriculum/levels.js';
import { config } from './config.js';

export const enabled = () => Boolean(config.sheet.url && config.sheet.secret);
const MIN_GAP_MS = 10 * 60 * 1000; // a student's row is refreshed at most every ten minutes
const iso = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : '');

/** POSTs operations to the Apps Script. Never throws: a sheet problem must not break the app. */
export async function post(ops) {
  if (!enabled() || !ops.length) return { ok: false, skipped: true };
  try {
    const res = await fetch(config.sheet.url, {
      method: 'POST', redirect: 'follow',
      headers: { 'content-type': 'text/plain;charset=utf-8' }, // text/plain avoids a CORS preflight in Apps Script
      body: JSON.stringify({ secret: config.sheet.secret, ops }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* Apps Script redirects to an HTML page on errors */ }
    if (!res.ok || !body?.ok) { console.warn('[sheet]', res.status, (body?.error || text).slice(0, 200)); return { ok: false, error: body?.error || `HTTP ${res.status}` }; }
    return body;
  } catch (err) {
    console.warn('[sheet]', err.message);
    return { ok: false, error: err.message };
  }
}

/** Everything the sheet shows about one student, as a flat { column: value } row. */
export async function userRow(user) {
  const [signals, progress, seen, liked, saved, invites] = await Promise.all([
    getSignals(user.id), getProgress(user.id), db.countSet(user.id, 'seen'), db.countSet(user.id, 'liked'), db.countSet(user.id, 'saved'), user.memberNo ? db.referralCount(user.memberNo) : 0,
  ]);
  const stats = await studentStats(user.id, { watched: seen, progress, masteryOf: mastery });
  const p = user.profile || {};
  const b = user.billing || {};
  const weeks = Object.values(signals.weeks || {});
  const minutes = Math.round(weeks.reduce((s, w) => s + (w.watchSec || 0), 0) / 60);
  const device = signals.device || {};
  return {
    'Member #': user.memberNo || '',
    'User ID': user.id,
    'Name': user.vidmoat?.name || '',
    'Email': user.vidmoat?.email || '',
    'Vidmoat ID': user.vidmoat?.id || '',
    'Joined': iso(user.createdAt),
    'Last seen': iso(signals.lastSeenAt),
    'Set up': user.setupDone ?? Boolean(user.units?.length || user.interests?.length) ? 'yes' : 'no',
    'Level': LEVEL_BY_ID[p.level]?.label || p.level || '',
    'Country': p.country || '',
    'Institution': p.institution || '',
    'Course': p.program || '',
    'Exam': p.exam || '',
    'Age': p.age ?? '',
    'Managed by': p.managedBy === 'guardian' ? 'parent/guardian' : 'self',
    'Courses': (user.programKeys || []).length,
    'Units': (user.units || []).length,
    'Interests': (user.interests || []).join(', '),
    'Lessons watched': seen,
    'Minutes watched': minutes,
    'Sessions': signals.sessions || 0,
    'Active days': Object.keys(signals.days || {}).length,
    'Day streak': streakOf(signals),
    'Quizzes': stats.quizN,
    'Quiz accuracy': stats.quizN ? `${Math.round((stats.quizRight / stats.quizN) * 100)}%` : '',
    'Units mastered': stats.mastered,
    'Likes': liked,
    'Saves': saved,
    'Shares': signals.shares || 0,
    'Invited by': user.referredBy ? `#${user.referredBy}` : '',
    'Invites': invites,
    'Billing mode': user.vidmoatTokens && b.mode === 'own' ? 'own account' : 'free allowance',
    'Free lessons used': Math.min(b.houseUsed || 0, config.billing.freeVideos),
    'Own account': user.vidmoatTokens ? `connected ${iso(b.connectedAt).slice(0, 10)}` : '',
    'Own credits': b.lastCredits ?? '',
    'Own plan': b.plan || '',
    'Billing problem': b.problem || '',
    'Device': device.standalone ? 'installed app' : device.platform ? 'browser' : '',
    'Platform': device.platform || '',
    'Time zone': device.tz || '',
    'Language': device.lang || '',
    'Updated': iso(Date.now()),
  };
}

/**
 * Refreshes a student's row (throttled unless `force`) and, with `event`, logs a line in the
 * Joins tab: 'joined', 'set up', 'connected own account', 'disconnected', 'free lessons used up',
 * 'level up'. Call it through waitUntil(): it is a network round-trip.
 */
export async function syncUser(userId, { event = null, detail = '', force = false } = {}) {
  if (!enabled() || !userId) return;
  const user = await db.getUser(userId);
  if (!user) return;
  const last = Number(await kv.get(`user:${userId}:sheetAt`)) || 0;
  if (!force && !event && Date.now() - last < MIN_GAP_MS) return;
  await kv.set(`user:${userId}:sheetAt`, Date.now());
  await db.indexUser(user);
  const ops = [{ op: 'upsert', tab: 'Users', key: 'User ID', rows: [await userRow(user)] }];
  if (event) {
    ops.push({ op: 'append', tab: 'Joins', rows: [{ 'When': iso(Date.now()), 'Event': event, 'Member #': user.memberNo || '', 'Name': user.vidmoat?.name || '', 'Email': user.vidmoat?.email || '', 'Level': LEVEL_BY_ID[user.profile?.level]?.label || '', 'Course': user.profile?.program || '', 'Detail': detail }] });
  }
  return post(ops);
}

/** One line per day in the Daily tab: students, activity and generation for `date` (YYYY-MM-DD). */
export async function dailyRow(date, { now = Date.now() } = {}) {
  const dayStart = Date.parse(`${date}T00:00:00Z`), dayEnd = dayStart + 86400000;
  const [h, total, joined, active] = await Promise.all([
    kv.hgetall(`events:day:${date}`), kv.zcard('users'),
    kv.zcount('users', dayStart, dayEnd - 1), kv.zcount('users:active', dayStart, dayEnd - 1),
  ]);
  const n = (k) => Number(h?.[k]) || 0;
  const right = n('quiz_answer_right'), wrong = n('quiz_answer_wrong');
  return {
    'Date': date,
    'New students': joined,
    'Total students': total || 0,
    'Active students': active,
    'Lessons watched': n('view'),
    'Completed': n('complete'),
    'Quiz answers': n('quiz_answer'),
    'Quiz accuracy': right + wrong ? `${Math.round((right / (right + wrong)) * 100)}%` : '',
    'Likes': n('like'),
    'Saves': n('save'),
    'Shares': n('recap_share') + n('levelup_share') + n('profile_share'),
    'Drops': n('drop'),
    'Breathers': n('breather_view'),
    'Landing views': n('funnel_landing'),
    'From invite links': n('funnel_landing_ref'),
    'Sign-in taps': n('funnel_signin_click'),
    'Signed in (new)': n('funnel_joined'),
    'Signed in (returning)': n('funnel_signed_in'),
    'Set up': n('funnel_setup'),
    'Referred sign-ups': n('referred'),
    'Installs': n('funnel_installed'),
    'Videos made': n('gen_ready'),
    'Videos failed': n('gen_failed'),
    'Library size': await db.readyCount(),
    'Updated': iso(now),
  };
}

/** Writes yesterday's and today's Daily rows (called by the cron). */
export async function syncDaily() {
  if (!enabled()) return;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return post([{ op: 'upsert', tab: 'Daily', key: 'Date', rows: [await dailyRow(yesterday), await dailyRow(today)] }]);
}

/** Rebuilds the Users tab from every student in storage (and fills the `users` index). Returns how many rows went. */
export async function resyncAll() {
  if (!enabled()) return { ok: false, error: 'sheet not configured' };
  const UUID = /^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const ids = new Set(await kv.zrange('users', 0, -1));
  for (const k of await scanKeys('user:*')) if (UUID.test(k)) ids.add(k.slice(5));
  const rows = [];
  for (const id of ids) {
    const user = await db.getUser(id);
    if (!user) continue;
    await db.indexUser(user);
    await db.indexMember(user);
    rows.push(await userRow(user));
  }
  rows.sort((a, b) => (a['Member #'] || 1e9) - (b['Member #'] || 1e9));
  let sent = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const r = await post([{ op: 'upsert', tab: 'Users', key: 'User ID', rows: rows.slice(i, i + 100) }]);
    if (r.ok) sent += Math.min(100, rows.length - i);
  }
  await syncDaily();
  return { ok: true, users: rows.length, sent };
}
