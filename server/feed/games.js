// Mini games between lessons, built from lessons the student has already watched, so every game
// is retrieval practice on their own material and costs nothing to make. Ten kinds:
//
//   match      tap a term, then its meaning      definitions shown in lessons, flashcards
//   order      tap the steps in the right order   step lists, timelines, cycles, worked examples
//   sort       send each chip to its side         compare tables ("Rough floor | Deep space")
//   truefalse  a fast round of statements        true/false cards, myths and facts
//   fillgap    pick the missing key term          the lesson's own sentences and key terms
//   hangman    guess the word letter by letter    key terms, with their meaning as the clue
//   memory     flip cards to find the pairs       definitions and flashcards
//   scramble   put the letters back in order      one-word key terms
//   pop        pop only the bubbles that belong   compare tables
//   hunt       find the hidden words in a grid    one-word key terms, found from their clues
//
// The second five are the arcade ones: the same material, played the way phone games are.
//
// The app checks answers on the device (instant feedback); the server keeps which lesson each
// scored item came from (`game:{id}`, two days), so a result can update those units' mastery
// and send missed lessons back as recall cards. Paced like moments: never before the fifth
// lesson of a session, then at most one every GAP lessons and MAX_PER_DAY a day.

import { kv } from '../core/kv.js';
import * as db from '../core/db.js';
import { TOPIC_BY_ID } from '../curriculum/topics.js';

export const GAME_TYPES = ['match', 'order', 'sort', 'truefalse', 'fillgap', 'hangman', 'memory', 'scramble', 'pop', 'hunt'];
/** The arcade kinds (letters, cards, bubbles): the ones that feel like a phone game, not a test. */
export const ARCADE_TYPES = ['hangman', 'memory', 'scramble', 'pop', 'hunt'];
export const GAME_META = {
  match: { title: 'Match it', emoji: '🧩', theme: 'sky', intro: 'Tap a term, then what it means.' },
  order: { title: 'Put it in order', emoji: '🔢', theme: 'mint', intro: 'Tap them in the right order.' },
  sort: { title: 'Sort it', emoji: '🗂️', theme: 'sun', intro: 'Which side does each one belong to?' },
  truefalse: { title: 'True or false?', emoji: '⚡', theme: 'rose', intro: 'Six seconds each. Go with your gut.' },
  fillgap: { title: 'Fill the gap', emoji: '✍️', theme: 'grape', intro: 'Pick the missing word.' },
  hangman: { title: 'Save Noti', emoji: '🎈', theme: 'rose', intro: 'Guess the word a letter at a time. Each miss pops a balloon.' },
  memory: { title: 'Flip and match', emoji: '🃏', theme: 'grape', intro: 'Flip two cards. Find each term and its meaning.' },
  scramble: { title: 'Unscramble', emoji: '🔀', theme: 'sun', intro: 'Tap the letters in the right order.' },
  pop: { title: 'Pop it', emoji: '🫧', theme: 'sky', intro: 'Pop only the bubbles that belong. Leave the rest.' },
  hunt: { title: 'Word hunt', emoji: '🔎', theme: 'mint', intro: 'Drag across the letters to find each word.' },
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
  const pairs = [], lists = [], sorts = [], statements = [], gaps = [], terms = new Set(), words = [];
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
        words.push({ word: String(vis.title).trim(), clue: clip(items[0], 90), src });
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
        if (re.test(b.text)) {
          gaps.push({ sentence: clip(b.text.replace(re, '____'), 170), answer: clip(b.keyTerm, 28), src });
          words.push({ word: b.keyTerm.trim(), clue: clip(b.text.replace(re, '____'), 110), src });
        }
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
  // Words for the letter games: one entry per word, a definition's clue winning over a sentence's.
  const byWord = new Map();
  for (const w of words) if (!byWord.has(w.word.toLowerCase())) byWord.set(w.word.toLowerCase(), w);
  return { pairs, lists, sorts, statements, gaps, terms: [...terms], words: [...byWord.values()] };
}

// What each letter game can use: hangman takes short phrases, the others one plain word.
const HANGMAN_OK = (w) => /^[A-Za-z][A-Za-z' -]{3,17}$/.test(w) && w.replace(/[^A-Za-z]/g, '').length >= 4;
const SCRAMBLE_OK = (w) => /^[A-Za-z]{4,10}$/.test(w) && new Set(w.toLowerCase()).size >= 3;
const HUNT_OK = (w) => /^[A-Za-z]{3,8}$/.test(w);
const memoryPairs = (m) => m.pairs.filter((p) => p.left.length <= 28 && p.right.length <= 64);
const popSorts = (m) => m.sorts.filter((x) => x.chips.filter((c) => c.side === 'L').length >= 2 && x.chips.filter((c) => c.side === 'R').length >= 2);
export const HUNT_SIZE = 8;

/**
 * A letter grid with `list` (upper-case words) hidden across, down or diagonally, left to right
 * or top to bottom. Returns rows of letters, or null when a word could not be placed.
 */
export function huntGrid(list, rand = Math.random, size = HUNT_SIZE) {
  // A first word laid corner to corner can leave no room for the next; start again a few times.
  for (let attempt = 0; attempt < 8; attempt++) { const grid = layHunt(list, rand, size); if (grid) return grid; }
  return null;
}
function layHunt(list, rand, size) {
  if (list.some((w) => w.length > size)) return null;
  const cells = Array.from({ length: size }, () => Array(size).fill(''));
  const dirs = [[0, 1], [1, 0], [1, 1]];
  for (const word of [...list].sort((a, b) => b.length - a.length)) {
    let placed = false;
    for (let t = 0; t < 80 && !placed; t++) {
      const [dr, dc] = dirs[Math.floor(rand() * dirs.length)];
      const r0 = Math.floor(rand() * (size - dr * (word.length - 1))), c0 = Math.floor(rand() * (size - dc * (word.length - 1)));
      if (![...word].every((ch, i) => !cells[r0 + dr * i][c0 + dc * i] || cells[r0 + dr * i][c0 + dc * i] === ch)) continue;
      [...word].forEach((ch, i) => { cells[r0 + dr * i][c0 + dc * i] = ch; });
      placed = true;
    }
    if (!placed) return null;
  }
  // Filler letters come from the words themselves, so the grid looks like the subject, not noise.
  const letters = list.join('') || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return cells.map((row) => row.map((ch) => ch || letters[Math.floor(rand() * letters.length)]).join(''));
}

/** Which kinds this material can make a good game of. */
export function playable(m) {
  const types = [];
  if (new Set(m.pairs.map((p) => p.left.toLowerCase())).size >= 3) types.push('match');
  if (m.lists.length) types.push('order');
  if (m.sorts.length) types.push('sort');
  if (m.statements.length >= 4 && m.statements.some((s) => s.truth) && m.statements.some((s) => !s.truth)) types.push('truefalse');
  if (m.gaps.length >= 3 && m.terms.length >= 4) types.push('fillgap');
  const words = m.words || [];
  if (words.some((w) => HANGMAN_OK(w.word))) types.push('hangman');
  if (new Set(memoryPairs(m).map((p) => p.left.toLowerCase())).size >= 3) types.push('memory');
  if (words.filter((w) => SCRAMBLE_OK(w.word)).length >= 3) types.push('scramble');
  if (popSorts(m).length) types.push('pop');
  if (words.filter((w) => HUNT_OK(w.word)).length >= 3) types.push('hunt');
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
  if (type === 'hangman') {
    const w = shuffle(m.words.filter((x) => HANGMAN_OK(x.word)), rand)[0];
    return { game: { ...base, word: w.word.toUpperCase(), clue: w.clue, lives: 6, unit: w.src.unit }, key: [w.src] };
  }
  if (type === 'memory') {
    const seen = new Set(), seenR = new Set(), picked = [];
    for (const p of shuffle(memoryPairs(m), rand)) {
      const k = p.left.toLowerCase(), r = p.right.toLowerCase();
      if (seen.has(k) || seenR.has(r)) continue;
      seen.add(k); seenR.add(r); picked.push(p);
      if (picked.length === 4) break;
    }
    return { game: { ...base, pairs: picked.map(({ left, right }) => ({ left, right })) }, key: picked.map((p) => p.src) };
  }
  if (type === 'scramble') {
    const rounds = shuffle(m.words.filter((x) => SCRAMBLE_OK(x.word)), rand).slice(0, 3).map((w) => {
      const answer = w.word.toUpperCase();
      let letters = shuffle([...answer], rand);
      for (let t = 0; t < 6 && letters.join('') === answer; t++) letters = shuffle([...answer], rand);
      if (letters.join('') === answer) letters = [...answer].reverse();
      return { letters: letters.join(''), answer, clue: w.clue, src: w.src };
    });
    return { game: { ...base, rounds: rounds.map(({ letters, answer, clue }) => ({ letters, answer, clue })) }, key: rounds.map((r) => r.src) };
  }
  if (type === 'pop') {
    const s = shuffle(popSorts(m), rand)[0];
    const side = rand() < 0.5 ? 'L' : 'R';
    const chips = shuffle(s.chips, rand).slice(0, 8).map((c) => ({ text: c.text, hit: c.side === side }));
    if (!chips.some((c) => c.hit) || chips.every((c) => c.hit)) return null;
    return { game: { ...base, prompt: `Pop everything about: ${side === 'L' ? s.left : s.right}`, target: side === 'L' ? s.left : s.right, other: side === 'L' ? s.right : s.left, chips, seconds: 25, unit: s.src.unit }, key: chips.map(() => s.src) };
  }
  if (type === 'hunt') {
    const seen = new Set();
    const picked = shuffle(m.words.filter((x) => HUNT_OK(x.word)), rand).filter((w) => { const k = w.word.toUpperCase(); return !seen.has(k) && ![...seen].some((o) => o.includes(k) || k.includes(o)) && seen.add(k); }).slice(0, 4);
    if (picked.length < 3) return null;
    const list = picked.map((w) => w.word.toUpperCase());
    const grid = huntGrid(list, rand);
    if (!grid) return null;
    return { game: { ...base, size: HUNT_SIZE, grid, words: picked.map((w) => ({ word: w.word.toUpperCase(), clue: w.clue })) }, key: picked.map((w) => w.src) };
  }
  return null;
}

/**
 * How much this student should get each playable kind next (weights, not probabilities):
 *   - a kind never played gets a first try;
 *   - kinds they finish win over kinds they open and leave;
 *   - accuracy near 75 % is the sweet spot: all right every time is too easy to teach anything,
 *     mostly wrong is discouraging;
 *   - the arcade kinds get a small lead, because a game should feel like one;
 *   - the kind played last sits this turn out (unless it is the only one).
 * `played` is signals.games.byType ({ n, items, right } per kind), `served` how often each was shown.
 */
export function gameWeights(options, { played = {}, served = {}, lastType = null } = {}) {
  const pool = options.length > 1 ? options.filter((t) => t !== lastType) : options;
  return pool.map((type) => {
    const p = played[type] || { n: 0, items: 0, right: 0 };
    const shown = Math.max(served[type] || 0, p.n);
    const finish = (p.n + 1) / (shown + 1.5); // smoothed share of shown games that were finished
    const acc = p.items ? p.right / p.items : 0.75;
    const sweet = 1 - Math.min(0.6, Math.abs(acc - 0.75) * 1.6);
    const novelty = shown === 0 ? 1.4 : 1;
    const arcade = ARCADE_TYPES.includes(type) ? 1.25 : 1;
    return { type, weight: +(Math.min(1.2, 0.4 + finish) * sweet * novelty * arcade).toFixed(3) };
  });
}
function weightedPick(list, rand) {
  const total = list.reduce((n, x) => n + x.weight, 0);
  let r = rand() * total;
  for (const x of list) { r -= x.weight; if (r <= 0) return x.type; }
  return list[list.length - 1]?.type || null;
}

/**
 * The lessons-between-games gap for this student: closer together for someone who finishes the
 * games they are shown, further apart for someone who swipes past them.
 */
export function gameGap({ played = {}, served = {} } = {}, base = GAP) {
  const shown = Object.values(served).reduce((n, x) => n + x, 0);
  const done = Object.values(played).reduce((n, x) => n + (x.n || 0), 0);
  if (shown < 3) return base;
  const rate = Math.min(1, done / shown);
  return rate >= 0.7 ? base - 2 : rate <= 0.3 ? base + 4 : base;
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
export async function gameFor(userId, { type = null, rand = Math.random, videos = null, played = {}, weak = null } = {}) {
  const all = videos || await watchedVideos(userId);
  let material = materialOf(all);
  const options = playable(material);
  if (!options.length) return null;
  const mark = (await kv.get(`user:${userId}:games`)) || {};
  const choice = type ? (options.includes(type) ? type : null) : weightedPick(gameWeights(options, { played, served: mark.types || {}, lastType: mark.lastType }), rand);
  if (!choice) return null;
  // Units the student is shaky on come first: when their lessons alone can make this game, it is made from them.
  if (weak?.size) {
    const focus = materialOf(all.filter((v) => weak.has(v.unitId)));
    if (playable(focus).includes(choice)) material = focus;
  }
  const built = buildGame(choice, material, rand) || (material.words ? buildGame(choice, materialOf(all), rand) : null);
  if (!built) return null;
  const id = `${Date.now().toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
  await kv.set(`game:${id}`, { userId, type: choice, key: built.key, at: Date.now() }, { ex: KEY_TTL });
  return gameItem(id, built.game, built.key);
}

/** Pacing for games in the feed. Returns a game item or null. */
export async function pickGame(userId, { session = {}, now = Date.now(), gap = null, rand = Math.random, videos = null, played = {}, weak = null } = {}) {
  const viewed = session.lastAt && now - session.lastAt > STALE_MS ? 0 : session.viewed || 0;
  if (viewed < MIN_VIEWED) return null;
  const mark = (await kv.get(`user:${userId}:games`)) || {};
  gap ??= gameGap({ played, served: mark.types || {} });
  if (mark.sid === (session.sid || '') && viewed - (mark.at ?? -gap) < gap) return null;
  if (mark.day === dayOf(now) && (mark.today || 0) >= MAX_PER_DAY) return null;
  return gameFor(userId, { rand, videos, played, weak });
}

/** Records that a game was served (for pacing and for not repeating the same kind). */
export async function noteGame(userId, item, session = {}, now = Date.now()) {
  const mark = (await kv.get(`user:${userId}:games`)) || {};
  const today = mark.day === dayOf(now) ? (mark.today || 0) + 1 : 1;
  const types = { ...(mark.types || {}), [item.game.type]: ((mark.types || {})[item.game.type] || 0) + 1 };
  await kv.set(`user:${userId}:games`, { ...mark, at: session.viewed || 0, sid: session.sid || '', day: dayOf(now), today, lastType: item.game.type, types });
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
