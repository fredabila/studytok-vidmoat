// Worlds: what a student is into outside school (football, music, gaming, food...), and how the
// feed uses it. A lesson can be written INSIDE a world: the syllabus idea is the same, the hook
// and the main example come from somewhere the student already cares about (momentum through a
// free kick, ratios through a recipe). The quiz always stays on the syllabus idea.
//
// Everything here is a pure function of the evidence: no sampling, no model call. The same
// student history always gives the same worlds, in the same order, with a reason for each.
//
//   1. EVIDENCE   what they said (onboarding, Profile), what they did (watched, liked, saved,
//                 skipped lessons set in a world), what they wrote (questions to the tutor,
//                 searches, custom topics that mention a world)
//   2. SCORE      fixed weights (WEIGHTS), one number per world
//   3. ADOPT      a world scoring ADOPT or more is theirs; DROP or less is not for them
//   4. ASSIGN     each new batch of lessons puts the student's worlds on its episodes in rank
//                 order, skipping worlds the unit used last, keeping one episode plain, and
//                 using every PROBE_EVERY-th slot to try a world they have never seen
//   5. RANK       a ready lesson set in an adopted world is preferred (FIT), a dropped one avoided
//
// Lessons stay shared: a world is a tag on a lesson, not part of the lesson key, so a football
// lesson written for one student is there for every other student who likes football.

/** id, label, emoji, what the writer may draw on, and the words that reveal it in free text. */
export const WORLDS = [
  { id: 'football', label: 'Football', emoji: '⚽', draw: 'matches, free kicks, penalties, passing, training, league tables, transfers', words: ['football', 'soccer', 'striker', 'goalkeeper', 'penalty', 'free kick', 'premier league', 'champions league', 'world cup', 'afcon', 'offside'] },
  { id: 'basketball', label: 'Basketball', emoji: '🏀', draw: 'shots, dribbling, rebounds, fast breaks, the shot clock, team plays', words: ['basketball', 'nba', 'dunk', 'three pointer', 'three-pointer', 'rebound', 'dribble'] },
  { id: 'fitness', label: 'Gym and running', emoji: '🏃', draw: 'sprints, lifting, reps, heart rate, stamina, recovery, a school sports day', words: ['gym', 'workout', 'running', 'sprint', 'marathon', 'athletics', 'weights', 'fitness', 'push ups', 'push-ups'] },
  { id: 'music', label: 'Music', emoji: '🎧', draw: 'beats, tempo, bass, playlists, concerts, speakers, streaming numbers, writing a hook', words: ['music', 'song', 'songs', 'playlist', 'afrobeats', 'hip hop', 'hip-hop', 'rap', 'gospel', 'amapiano', 'guitar', 'piano', 'concert', 'album'] },
  { id: 'gaming', label: 'Gaming', emoji: '🎮', draw: 'levels, lag, frame rate, health bars, loot, speedruns, game physics, ranked matches', words: ['gaming', 'video game', 'video games', 'gamer', 'fortnite', 'minecraft', 'fifa', 'call of duty', 'playstation', 'xbox', 'nintendo', 'roblox'] },
  { id: 'anime', label: 'Anime and comics', emoji: '🗯️', draw: 'power levels, training arcs, rivalries, plot twists, drawing panels, heroes and villains', words: ['anime', 'manga', 'comics', 'comic book', 'naruto', 'one piece', 'superhero', 'marvel', 'dc comics'] },
  { id: 'film', label: 'Movies and series', emoji: '🎬', draw: 'plot twists, cliffhangers, special effects, stunts, cameras, box office, a series finale', words: ['movie', 'movies', 'film', 'films', 'netflix', 'series', 'cinema', 'nollywood', 'tv show'] },
  { id: 'food', label: 'Food and cooking', emoji: '🍲', draw: 'recipes, frying, boiling, baking, spice, portions, market prices, a street food stall', words: ['cooking', 'recipe', 'recipes', 'baking', 'food', 'jollof', 'waakye', 'pizza', 'kitchen', 'chef'] },
  { id: 'fashion', label: 'Fashion and beauty', emoji: '👟', draw: 'sneakers, fabrics, fit, colours, hair, skincare, a thrift haul, what an outfit costs', words: ['fashion', 'sneakers', 'outfit', 'clothes', 'makeup', 'skincare', 'hairstyle', 'thrift', 'style'] },
  { id: 'cars', label: 'Cars and bikes', emoji: '🏎️', draw: 'engines, braking, drifting, fuel, top speed, tyres, motorbikes, a race start', words: ['car', 'cars', 'motorbike', 'motorcycle', 'formula 1', 'f1', 'racing', 'engine', 'drift', 'okada'] },
  { id: 'tech', label: 'Phones and tech', emoji: '📱', draw: 'battery life, storage, cameras, wifi, apps, chargers, screens, a phone upgrade', words: ['phone', 'phones', 'iphone', 'android', 'laptop', 'gadget', 'gadgets', 'coding', 'programming', 'robot', 'robots', 'app'] },
  { id: 'creators', label: 'Social and creators', emoji: '🤳', draw: 'views, going viral, the algorithm, editing a video, followers, trends, a comment section', words: ['tiktok', 'youtube', 'instagram', 'snapchat', 'influencer', 'content creator', 'viral', 'followers', 'vlog'] },
  { id: 'money', label: 'Money and hustle', emoji: '💸', draw: 'saving, prices, profit, a side business, mobile money, discounts, pocket money, budgeting', words: ['money', 'business', 'hustle', 'savings', 'investing', 'profit', 'side hustle', 'mobile money', 'budget', 'entrepreneur'] },
  { id: 'travel', label: 'Travel and places', emoji: '✈️', draw: 'flights, time zones, maps, road trips, cities, weather abroad, packing, a long bus ride', words: ['travel', 'travelling', 'traveling', 'flight', 'airport', 'road trip', 'holiday', 'vacation', 'abroad'] },
  { id: 'animals', label: 'Animals and nature', emoji: '🐾', draw: 'pets, predators, migration, camouflage, the ocean, forests, weird animal facts', words: ['animals', 'animal', 'pets', 'dog', 'dogs', 'cat', 'cats', 'wildlife', 'nature', 'ocean', 'birds'] },
  { id: 'art', label: 'Art and design', emoji: '🎨', draw: 'drawing, colour mixing, perspective, graphic design, photography, a mural, editing a photo', words: ['drawing', 'painting', 'art', 'design', 'graphic design', 'photography', 'sketch', 'animation'] },
  { id: 'dance', label: 'Dance', emoji: '💃', draw: 'choreography, rhythm, balance, spins, a dance challenge, timing with the beat', words: ['dance', 'dancing', 'choreography', 'dancer', 'ballet', 'azonto'] },
];
export const WORLD_BY_ID = Object.fromEntries(WORLDS.map((w) => [w.id, w]));
export const WORLD_IDS = WORLDS.map((w) => w.id);

/** How much each kind of evidence counts. Saying it is worth three finished lessons. */
export const WEIGHTS = { said: 3, declined: -6, complete: 1, like: 2, save: 2, rewatch: 1, watched: 1, skip: -1, less: -3, mention: 1.5 };
/** A world scoring this or more is the student's; this or less is not for them. */
export const ADOPT = 2;
export const DROP = -2;
/** At most this many worlds are used for a student at a time. */
export const MAX_WORLDS = 4;
/** Mentions in free text stop counting after this many (one obsession should not drown the rest). */
export const MENTION_CAP = 3;
/** Every this-many world slots, one tries a world the student has never been shown. */
export const PROBE_EVERY = 3;
/** Ranking multipliers for a ready lesson: set in an adopted world, a never-seen world, a dropped world. */
export const FIT = { adopted: 1.3, fresh: 1.05, dropped: 0.75 };

export const cleanWorlds = (a) => [...new Set((Array.isArray(a) ? a : []).filter((id) => WORLD_BY_ID[id]))].slice(0, 8);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MATCHERS = WORLDS.map((w) => ({ id: w.id, re: new RegExp(`(?:^|[^a-z0-9])(?:${w.words.map(escapeRe).join('|')})(?=$|[^a-z0-9])`, 'i') }));
/** The worlds a piece of free text mentions (a tutor question, a search, a custom topic). */
export function worldsIn(text) {
  const t = String(text || '').slice(0, 400);
  return t ? MATCHERS.filter((m) => m.re.test(t)).map((m) => m.id) : [];
}

/**
 * One score per world from the evidence, with the reasons, best first (ties in catalogue order).
 * @param said      world ids the student ticked
 * @param declined  world ids the student removed after the feed picked them up
 * @param watched   signals.worlds: { [id]: { views, completes, likes, saves, rewatches, skips, less, n, pctSum } }
 * @param mentions  { [id]: count } from free text
 * @returns {Array<{ id, score, seen, why: string[] }>}
 */
export function worldScores({ said = [], declined = [], watched = {}, mentions = {} } = {}) {
  return WORLDS.map((w, order) => {
    const s = watched[w.id] || {};
    const why = [];
    let score = 0;
    const add = (n, reason) => { if (n) { score += n; why.push(reason); } };
    add(said.includes(w.id) ? WEIGHTS.said : 0, 'you picked it');
    add(declined.includes(w.id) ? WEIGHTS.declined : 0, 'you removed it');
    add((s.completes || 0) * WEIGHTS.complete, `${s.completes} finished`);
    add((s.likes || 0) * WEIGHTS.like, `${s.likes} liked`);
    add((s.saves || 0) * WEIGHTS.save, `${s.saves} saved`);
    add((s.rewatches || 0) * WEIGHTS.rewatch, `${s.rewatches} rewatched`);
    // Watch fraction beyond the finished ones: half-watched lessons count for half.
    const partial = Math.max(0, (s.pctSum || 0) - (s.completes || 0));
    add(+(partial * WEIGHTS.watched).toFixed(2), 'watched part of others');
    add((s.skips || 0) * WEIGHTS.skip, `${s.skips} skipped`);
    add((s.less || 0) * WEIGHTS.less, `${s.less} "show me less"`);
    const m = Math.min(MENTION_CAP, mentions[w.id] || 0);
    add(m * WEIGHTS.mention, `mentioned ${m} time${m === 1 ? '' : 's'}`);
    return { id: w.id, score: +score.toFixed(2), seen: s.views || 0, why, order };
  }).sort((a, b) => b.score - a.score || a.order - b.order).map(({ order, ...x }) => x);
}

/** The student's worlds: adopted, best first, at most MAX_WORLDS. */
export const adopted = (scores) => scores.filter((s) => s.score >= ADOPT).slice(0, MAX_WORLDS).map((s) => s.id);

/** The world to try next on someone who has never been shown it: fewest views, not dropped, catalogue order. */
export function probeWorld(scores, skip = []) {
  const pool = scores.filter((s) => s.score > DROP && s.score < ADOPT && !skip.includes(s.id));
  if (!pool.length) return null;
  const order = (id) => WORLD_IDS.indexOf(id);
  return [...pool].sort((a, b) => a.seen - b.seen || order(a.id) - order(b.id))[0].id;
}

/**
 * Which world each episode of a new batch is written in (null = plain). Deterministic:
 *   - one episode in three stays plain, so a unit never becomes all football;
 *   - the others take the student's worlds in rank order, starting after any the unit used last;
 *   - every PROBE_EVERY-th world slot (counted over the student's world lessons so far) tries a
 *     world they have never seen, which is how new interests are found;
 *   - a student with no worlds yet gets one probe per batch and nothing else.
 * @param count        episodes in the batch
 * @param scores       worldScores(...)
 * @param recentUnit   worlds this unit's last lessons used, newest first
 * @param tried        how many world lessons this student has been shown so far
 * @param allowProbe   false for young children and review sessions (no experiments there)
 */
export function assignWorlds(count, scores, { recentUnit = [], tried = 0, allowProbe = true } = {}) {
  const mine = adopted(scores);
  const out = Array(count).fill(null);
  const slots = [];
  for (let i = 0; i < count; i++) if (i % 3 !== 2) slots.push(i); // every third episode stays plain
  if (!slots.length) return out;
  if (!mine.length) {
    const probe = allowProbe ? probeWorld(scores, recentUnit.slice(0, 2)) : null;
    if (probe) out[slots[slots.length - 1]] = probe; // the first episode stays plain for a new student
    return out;
  }
  // Rank order, with the worlds this unit used most recently moved to the back.
  const fresh = mine.filter((id) => !recentUnit.slice(0, 2).includes(id));
  const queue = [...fresh, ...mine.filter((id) => !fresh.includes(id))];
  let n = tried;
  slots.forEach((slot, k) => {
    n++;
    const probe = allowProbe && n % PROBE_EVERY === 0 ? probeWorld(scores, [...recentUnit.slice(0, 2), ...out.filter(Boolean)]) : null;
    out[slot] = probe || queue[k % queue.length];
  });
  return out;
}

/** The ranking multiplier for a ready lesson set in `world` (1 for a plain lesson). */
export function worldFit(world, scores) {
  if (!world) return 1;
  const s = scores.find((x) => x.id === world);
  if (!s) return 1;
  if (s.score >= ADOPT) return FIT.adopted;
  if (s.score <= DROP) return FIT.dropped;
  return s.seen === 0 ? FIT.fresh : 1;
}

/** What the writer is told for an episode set in a world. */
export function worldBrief(id, { minor = false } = {}) {
  const w = WORLD_BY_ID[id];
  if (!w) return '';
  return `WORLD: ${w.label}. This student is into it. Set the hook and the main example inside that world (${w.draw}) and teach the syllabus idea through it, so it feels like their feed and still teaches the unit. Use ordinary situations anyone in that world would recognise; do not invent scores, statistics, quotes or events, and do not make claims about real people, teams or brands unless they are common knowledge and certain. The quiz, the key terms and the takeaway stay on the syllabus idea, not the world.${minor ? ' Keep it school-safe.' : ''}`;
}

/** The profile view: every world with whether it was said, picked up or dropped, and why. */
export function worldProfile(scores, said = []) {
  return scores.map((s) => ({
    id: s.id, label: WORLD_BY_ID[s.id].label, emoji: WORLD_BY_ID[s.id].emoji, score: s.score,
    state: said.includes(s.id) ? 'said' : s.score >= ADOPT ? 'found' : s.score <= DROP ? 'dropped' : 'open',
    why: s.why,
  }));
}
