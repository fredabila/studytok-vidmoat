// Mini games between lessons, built from lessons the student has already watched, so every game
// is retrieval practice on their own material and costs nothing to make. Five kinds:
//
//   match      tap a term, then its meaning      definitions shown in lessons, flashcards
//   order      tap the steps in the right order   step lists, timelines, cycles, worked examples
//   sort       send each chip to its side         compare tables ("Rough floor | Deep space")
//   truefalse  a fast round of statements        true/false cards, myths and facts
//   fillgap    pick the missing key term          the lesson's own sentences and key terms
//
// The app checks answers on the device (instant feedback); the server keeps which lesson each
// scored item came from (`game:{id}`, two days), so a result can update those units' mastery
// and send missed lessons back as recall cards. Paced like moments: never before the fifth
// lesson of a session, then at most one every GAP lessons and MAX_PER_DAY a day.

import { kv } from '../core/kv.js';
import * as db from '../core/db.js';
import { TOPIC_BY_ID } from '../curriculum/topics.js';

export const GAME_TYPES = ['match', 'order', 'sort', 'truefalse', 'fillgap'];
export const GAME_META = {
  match: { title: 'Match it', emoji: '🧩', theme: 'sky', intro: 'Tap a term, then what it means.' },
  order: { title: 'Put it in order', emoji: '🔢', theme: 'mint', intro: 'Tap them in the right order.' },
  sort: { title: 'Sort it', emoji: '🗂️', theme: 'sun', intro: 'Which side does each one belong to?' },
  truefalse: { title: 'True or false?', emoji: '⚡', theme: 'rose', intro: 'Six seconds each. Go with your gut.' },
  fillgap: { title: 'Fill the gap', emoji: '✍️', theme: 'grape', intro: 'Pick the missing word.' },
};
export const MIN_VIEWED = 5;
export const GAP = 7;
export const MAX_PER_DAY = 4;
const KEY_TTL = 2 * 86400;
const STALE_MS = 12 * 3600000;

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`; };
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
function shuffle(a, rand = Math.random) { const out = [...a]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Everything game-worthy in a set of watched videos. Each entry carries `src`, the video it came
 * from: { videoId, unitId, topic }.
 */
export function materialOf(videos) {
  const pairs = [], lists = [], sorts = [], statements = [], gaps = [], terms = new Set();
  for (const v of videos) {
    const l = v.lesson || {};
    const src = { videoId: v.id, unitId: v.unitId || null, topic: v.topic || 'general', unit: v.unitTitle || null };
    for (const b of l.beats || []) {
      const vis = b.visual || {};
      const items = (vis.items || []).filter(Boolean);
      if (b.keyTerm) terms.add(clip(b.keyTerm, 28));
      if (vis.kind === 'definition' && vis.title && items[0]) {
        pairs.push({ left: clip(vis.title, 28), right: clip(items[0], 90), src });
        terms.add(clip(vis.title, 28));
      }
      if (vis.kind === 'steps' && items.length >= 3) lists.push({ title: clip(vis.title || 'In order', 50), items: items.slice(0, 5).map((t) => ({ text: clip(t, 60) })), src });
      if (vis.kind === 'cycle' && items.length >= 3) lists.push({ title: clip(vis.title || 'The cycle, from the start', 50), items: items.slice(0, 6).map((t) => ({ text: clip(t, 40) })), src });
      if (vis.kind === 'timeline' && items.length >= 3) {
        const rows = items.slice(0, 5).map((x) => { const [when, ...what] = x.split('|'); return { label: clip(when, 14), text: clip(what.join('|') || when, 60), n: parseFloat(String(when).replace(/[^\d.-]/g, '')) }; });
        const ordered = rows.every((r) => Number.isFinite(r.n)) ? [...rows].sort((a, b) => a.n - b.n) : rows;
        lists.push({ title: clip(vis.title || 'Oldest first', 50), items: ordered.map(({ label, text }) => ({ label, text })), src });
      }
      if (vis.kind === 'compare') {
        const [left, right] = (vis.title || '').split('|').map((x) => clip(x, 24));
        const rows = items.slice(0, 4).map((x) => x.split('|').map((y) => clip(y, 40))).filter((r) => r[0] && r[1]);
        if (left && right && rows.length >= 2) sorts.push({ left, right, chips: rows.flatMap(([a, b]) => [{ text: a, side: 'L' }, { text: b, side: 'R' }]), src });
      }
      // Fill the gap: the beat's own sentence with its key term blanked out.
      if (b.keyTerm && b.text && b.keyTerm.length >= 3 && b.keyTerm.length <= 28) {
        const re = new RegExp(`\\b${escapeRe(b.keyTerm)}\\b`, 'i');
        if (re.test(b.text)) gaps.push({ sentence: clip(b.text.replace(re, '____'), 170), answer: clip(b.keyTerm, 28), src });
      }
    }
    if (l.format === 'flashcards') for (const c of l.cards || []) if (c.q && c.a) pairs.push({ left: clip(c.q, 50), right: clip(c.a, 60), src });
    if (l.format === 'truefalse') {
      for (const c of l.cards || []) {
        const m = /^\s*(true|false)\b[:.,]?\s*(.*)$/i.exec(c.a || '');
        if (c.q && m) statements.push({ text: clip(c.q, 90), truth: m[1].toLowerCase() === 'true', why: clip(m[2], 90), src });
      }
    }
    if (l.myth) statements.push({ text: clip(l.myth, 90), truth: false, why: clip(l.fact || '', 90), src });
    if (l.myth && l.fact) statements.push({ text: clip(l.fact, 90), truth: true, why: '', src });
    if (l.format === 'history') {
      const rows = (l.items || []).map((it) => { const [when, ...what] = String(it.title || '').split('|'); return { label: clip(when, 14), text: clip(what.join('|') || it.text, 60), n: parseFloat(String(when).replace(/[^\d.-]/g, '')) }; }).filter((r) => r.text);
      if (rows.length >= 3 && rows.every((r) => Number.isFinite(r.n))) lists.push({ title: 'Oldest first', items: [...rows].sort((a, b) => a.n - b.n).slice(0, 5).map(({ label, text }) => ({ label, text })), src });
    }
    const steps = (l.exam?.steps || []).filter(Boolean);
    if (steps.length >= 3 && steps.every((s) => s.length <= 110)) lists.push({ title: 'Solve it: the steps in order', items: steps.slice(0, 4).map((t) => ({ text: clip(t, 110) })), src });
    if (v.quiz?.options?.[v.quiz.answerIndex]) terms.add(clip(v.quiz.options[v.quiz.answerIndex], 28));
  }
  return { pairs, lists, sorts, statements, gaps, terms: [...terms] };
}

/** Which kinds this material can make a good game of. */
export function playable(m) {
  const types = [];
  if (new Set(m.pairs.map((p) => p.left.toLowerCase())).size >= 3) types.push('match');
  if (m.lists.length) types.push('order');
  if (m.sorts.length) types.push('sort');
  if (m.statements.length >= 4 && m.statements.some((s) => s.truth) && m.statements.some((s) => !s.truth)) types.push('truefalse');
  if (m.gaps.length >= 3 && m.terms.length >= 4) types.push('fillgap');
  return types;
}

/**
 * Builds one game of `type` from the material. Returns { game, key } where `game` is what the
 * app renders (answers included, it checks on the device) and `key` lists each scored item's
 * source lesson in order, or null when the material cannot make that game.
 */
export function buildGame(type, m, rand = Math.random) {
  const meta = GAME_META[type];
  if (!meta || !playable(m).includes(type)) return null;
  const base = { type, title: meta.title, emoji: meta.emoji, theme: meta.theme, intro: meta.intro };
  if (type === 'match') {
    const seen = new Set(), seenR = new Set(), picked = [];
    for (const p of shuffle(m.pairs, rand)) {
      const k = p.left.toLowerCase(), r = p.right.toLowerCase();
      if (seen.has(k) || seenR.has(r)) continue;
      seen.add(k); seenR.add(r); picked.push(p);
      if (picked.length === 4) break;
    }
    return { game: { ...base, pairs: picked.map(({ left, right }) => ({ left, right })) }, key: picked.map((p) => p.src) };
  }
  if (type === 'order') {
    const lists = shuffle(m.lists, rand).sort((a, b) => Math.abs(4 - a.items.length) - Math.abs(4 - b.items.length));
    const list = lists[0];
    return { game: { ...base, prompt: list.title, items: list.items, unit: list.src.unit }, key: list.items.map(() => list.src) };
  }
  if (type === 'sort') {
    const s = shuffle(m.sorts, rand)[0];
    const chips = shuffle(s.chips, rand);
    return { game: { ...base, left: s.left, right: s.right, chips, unit: s.src.unit }, key: chips.map(() => s.src) };
  }
  if (type === 'truefalse') {
    let pool = shuffle(m.statements, rand);
    const t = pool.find((x) => x.truth), f = pool.find((x) => !x.truth);
    pool = [t, f, ...pool.filter((x) => x !== t && x !== f)].slice(0, 6);
    pool = shuffle(pool, rand);
    return { game: { ...base, statements: pool.map(({ text, truth, why }) => ({ text, truth, why })), seconds: 6 }, key: pool.map((s) => s.src) };
  }
  if (type === 'fillgap') {
    const bySrc = new Map();
    for (const g of shuffle(m.gaps, rand)) if (!bySrc.has(g.src.videoId + g.answer)) bySrc.set(g.src.videoId + g.answer, g);
    const rounds = [...bySrc.values()].slice(0, 3).map((g) => {
      const wrong = shuffle(m.terms.filter((t) => t.toLowerCase() !== g.answer.toLowerCase() && !t.toLowerCase().includes(g.answer.toLowerCase()) && !g.answer.toLowerCase().includes(t.toLowerCase())), rand).slice(0, 2);
      const options = shuffle([g.answer, ...wrong], rand);
      return { sentence: g.sentence, options, answerIndex: options.indexOf(g.answer), src: g.src };
    }).filter((r) => r.options.length === 3);
    if (rounds.length < 3) return null;
    return { game: { ...base, rounds: rounds.map(({ sentence, options, answerIndex }) => ({ sentence, options, answerIndex })) }, key: rounds.map((r) => r.src) };
  }
  return null;
}

/** The ready videos behind the student's recent history (most recent first, at most `n`). */
export async function watchedVideos(userId, n = 30) {
  const raw = (await kv.lrange(`user:${userId}:history`, 0, 79)) || [];
  const ids = [...new Set(raw.map((x) => String(x).split('|')[0]))].slice(0, n);
  return (await Promise.all(ids.map((id) => db.getVideo(id)))).filter((v) => v && v.status === 'ready' && v.lesson);
}

/** What the app renders for a game (the same shape as moments and recall cards). */
export function gameItem(id, game, srcs) {
  const counts = {};
  for (const s of srcs) counts[s.topic] = (counts[s.topic] || 0) + 1;
  const topicId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'general';
  const look = TOPIC_BY_ID[topicId] || TOPIC_BY_ID.general || { id: 'general', label: 'General', emoji: '📚', accent: '#ffd93d' };
  return { id: `game:${id}`, kind: 'game', status: 'ready', game: { id, ...game }, topic: { id: look.id, label: look.label, emoji: look.emoji, accent: look.accent } };
}

/**
 * A game for this student now: of `type` when asked (else a kind their history supports, not
 * the last one they played), from their recently watched lessons. Stores the answer sources.
 * Returns the item or null when there is not enough material yet.
 */
export async function gameFor(userId, { type = null, rand = Math.random, videos = null } = {}) {
  const material = materialOf(videos || await watchedVideos(userId));
  const options = playable(material);
  if (!options.length) return null;
  const mark = (await kv.get(`user:${userId}:games`)) || {};
  const choice = type ? (options.includes(type) ? type : null) : (shuffle(options.filter((t) => t !== mark.lastType), rand)[0] || options[0]);
  if (!choice) return null;
  const built = buildGame(choice, material, rand);
  if (!built) return null;
  const id = `${Date.now().toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
  await kv.set(`game:${id}`, { userId, type: choice, key: built.key, at: Date.now() }, { ex: KEY_TTL });
  return gameItem(id, built.game, built.key);
}

/** Pacing for games in the feed. Returns a game item or null. */
export async function pickGame(userId, { session = {}, now = Date.now(), gap = GAP, rand = Math.random, videos = null } = {}) {
  const viewed = session.lastAt && now - session.lastAt > STALE_MS ? 0 : session.viewed || 0;
  if (viewed < MIN_VIEWED) return null;
  const mark = (await kv.get(`user:${userId}:games`)) || {};
  if (mark.sid === (session.sid || '') && viewed - (mark.at ?? -gap) < gap) return null;
  if (mark.day === dayOf(now) && (mark.today || 0) >= MAX_PER_DAY) return null;
  return gameFor(userId, { rand, videos });
}

/** Records that a game was served (for pacing and for not repeating the same kind). */
export async function noteGame(userId, item, session = {}, now = Date.now()) {
  const mark = (await kv.get(`user:${userId}:games`)) || {};
  const today = mark.day === dayOf(now) ? (mark.today || 0) + 1 : 1;
  await kv.set(`user:${userId}:games`, { ...mark, at: session.viewed || 0, sid: session.sid || '', day: dayOf(now), today, lastType: item.game.type });
}

/**
 * Joins a result to the lessons behind it. `wrong` is the list of scored item indices the
 * student missed. Returns { type, units: { unitId: allRight }, missedVideos: [ids] } or null
 * for an unknown or someone else's game.
 */
export async function gameOutcome(userId, id, wrong = []) {
  const g = await kv.get(`game:${id}`);
  if (!g || g.userId !== userId) return null;
  await kv.del(`game:${id}`); // one result per game
  const miss = new Set(wrong.filter((i) => Number.isInteger(i) && i >= 0 && i < g.key.length));
  const units = {}, missedVideos = new Set();
  g.key.forEach((src, i) => {
    if (!src?.unitId) return;
    const ok = !miss.has(i);
    units[src.unitId] = (units[src.unitId] ?? true) && ok;
    if (!ok) missedVideos.add(src.videoId);
  });
  return { type: g.type, units, missedVideos: [...missedVideos].slice(0, 2), total: g.key.length };
}
