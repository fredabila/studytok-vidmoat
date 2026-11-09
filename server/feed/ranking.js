// The StudyTok algorithm (docs/ALGORITHM.md). Pure functions: no I/O, so it is easy to test
// and tune. Two stages:
//
// 1. WHICH UNIT: for each feed slot every candidate unit (the student's course units plus
//    their interest topics) is scored and the best taken:
//
//   score = affinity      Thompson sample from Beta(engagement + 1, disengagement + 1), so
//                         units the student finishes, likes and answers correctly come up more,
//                         while uncertain units still get explored
//         + progress      the syllabus "frontier": the first units not yet learned get a boost,
//                         decaying along the course order, so the feed walks the syllabus
//         + review        spaced repetition (Leitner boxes): a unit is due again 1, 3, 7 or 21
//                         days after a correct answer, and 20 minutes after a wrong one
//         - recency       just-served units are pushed back so the feed stays varied
//         × less          "show me less" multiplies a unit down
//   with a small, decaying chance of a random candidate (exploration).
//
// 2. WHICH VIDEO of that unit: every ready video is scored by
//     quality        everyone's engagement with that video (watch fraction, completion, likes,
//                    saves, quiz accuracy, early leaves), Bayesian-smoothed
//   × affinity       the student's own taste for the video's format and topic (Thompson sample)
//   × diversity      not the same format as the last video, not the same topic twice running
//   × fatigue        later in a session, shorter and lighter formats win
//   × difficulty     after wrong answers, gentler formats; after a right streak, exam drills
//   × freshness      a small bonus for videos this student has never been served

export const BOX_DAYS = [1, 3, 7, 21];
const WRONG_RETRY_MS = 20 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export const emptyState = () => ({ served: 0, views: 0, completes: 0, skips: 0, likes: 0, less: 0, quizRight: 0, quizWrong: 0, box: -1, lastSeen: 0, due: 0, watchN: 0, pctSum: 0 });

/** Probability-ish estimate that the student has learned the unit (0..1). */
export function mastery(s) {
  if (!s || !s.views) return 0;
  const quiz = (s.quizRight + 0.5) / (s.quizRight + s.quizWrong + 1);
  const exposure = Math.min(1, s.completes / 3);
  return Math.round((0.6 * quiz * Math.min(1, (s.quizRight + s.quizWrong) / 2) + 0.4 * exposure) * 100) / 100;
}

/** Applies one engagement event to a unit state (returns a new state). */
export function applyEvent(state, type, { correct, now = Date.now(), pct = 0 } = {}) {
  const s = { ...emptyState(), ...state };
  switch (type) {
    case 'served': s.served++; break;
    case 'view': s.views++; s.lastSeen = now; if (s.box < 0) { s.box = 0; s.due = now + BOX_DAYS[0] * DAY; } break;
    case 'complete': s.completes++; break;
    case 'skip': s.skips++; break;
    case 'like': s.likes++; break;
    case 'unlike': s.likes = Math.max(0, s.likes - 1); break;
    case 'less': s.less++; break;
    case 'leave': s.watchN++; s.pctSum = Math.round((s.pctSum + Math.max(0, Math.min(1, Number(pct) || 0))) * 1000) / 1000; break;
    case 'quiz_answer':
      if (correct) { s.quizRight++; s.box = Math.min(BOX_DAYS.length - 1, s.box + 1); s.due = now + BOX_DAYS[s.box] * DAY; }
      else { s.quizWrong++; s.box = 0; s.due = now + WRONG_RETRY_MS; }
      break;
    default: break;
  }
  return s;
}

// ---- Beta sampling (Marsaglia-Tsang gamma) ----------------------------------------------------
function gamma(k, rand) {
  if (k < 1) return gamma(k + 1, rand) * rand() ** (1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      // Box-Muller normal
      x = Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export const sampleBeta = (a, b, rand = Math.random) => { const x = gamma(a, rand); return x / (x + gamma(b, rand)); };

/**
 * @param candidates  [{ unit, kind: 'course'|'interest', order }] in syllabus order for courses
 * @param states      { [unitId]: state }
 * @param recent      unit ids served most recently first
 * @returns {Array<{ unit, kind, score, parts }>}  sorted best first
 */
export function scoreUnits(candidates, states, recent = [], { now = Date.now(), rand = Math.random, hasCourse = true, urgency = 0 } = {}) {
  // Frontier: each course's units not yet learned, in syllabus order (ranked per course, so a
  // student with several subjects starts at the beginning of every one of them).
  const frontierRank = new Map();
  const perGroup = new Map();
  for (const c of candidates) {
    if (c.kind !== 'course' || mastery(states[c.unit.id]) >= 0.7) continue;
    const g = c.group || 'course';
    const r = perGroup.get(g) || 0;
    frontierRank.set(c.unit.id, r);
    perGroup.set(g, r + 1);
  }

  return candidates.map((c) => {
    const s = { ...emptyState(), ...states[c.unit.id] };
    // Watch fraction counts as fractional engagement: a video watched 80% is 0.8 of a completion.
    const watched = s.watchN ? s.pctSum : 0;
    const engaged = s.completes + 2 * s.likes + s.quizRight + watched;
    const disengaged = s.skips + 3 * s.less + 0.5 * s.quizWrong + (s.watchN - watched);
    // With no engagement data the sample is pure noise and would override the syllabus order;
    // trust it in proportion to the evidence (half-weight after 3 signals).
    const confidence = (engaged + disengaged) / (engaged + disengaged + 3);
    const affinity = confidence * sampleBeta(1 + engaged, 1 + disengaged, rand) + (1 - confidence) * 0.5;

    let progress = 0;
    if (c.kind === 'course') {
      const r = frontierRank.get(c.unit.id);
      progress = r == null ? 0.05 : Math.max(0.1, 1 - r * 0.3);
    } else {
      progress = hasCourse ? 0.15 : 0.5;
    }

    // Due units; with an exam near, every unit the student has started is worth revisiting.
    const review = (s.lastSeen && s.due && s.due <= now ? (s.quizWrong > s.quizRight ? 0.9 : 0.6) : s.lastSeen && urgency > 0 ? 0.3 * urgency : 0) * (1 + urgency);
    progress *= 1 - 0.3 * urgency;

    const idx = recent.indexOf(c.unit.id);
    const recency = idx === -1 ? 0 : idx === 0 ? 1.6 : idx < 3 ? 0.9 : idx < 6 ? 0.3 : 0;

    const lessFactor = 0.35 ** s.less;
    const score = (affinity + progress + review - recency) * lessFactor;
    return { ...c, score, parts: { affinity: +affinity.toFixed(3), progress, review, recency, lessFactor } };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Picks `count` units for the next feed page (no unit twice on a page unless it is the only one).
 */
/**
 * How close the exam is, 0..1: nothing until 45 days out, then rising to 1 on the day. With an
 * exam near, review outweighs new material and more lessons are retrieval practice.
 */
export function examUrgency(examDate, now = Date.now()) {
  const t = Date.parse(examDate || '');
  if (Number.isNaN(t)) return 0;
  const days = (t - now) / 86400000;
  if (days < -1 || days > 45) return 0;
  return +Math.min(1, Math.max(0, 1 - Math.max(0, days) / 45)).toFixed(3);
}

export function pickUnits(candidates, states, recent, count, { explore = 0.1, rand = Math.random, now = Date.now(), hasCourse = true, urgency = 0 } = {}) {
  const picks = [];
  const seenRecent = [...recent];
  for (let i = 0; i < count && candidates.length; i++) {
    let choice;
    if (rand() < explore) {
      const pool = candidates.filter((c) => !picks.some((p) => p.unit.id === c.unit.id) && !(states[c.unit.id]?.less > 1));
      choice = pool.length ? pool[Math.floor(rand() * pool.length)] : null;
      if (choice) choice = { ...choice, score: null, parts: { explored: true } };
    }
    if (!choice) {
      const ranked = scoreUnits(candidates, states, seenRecent, { now, rand, hasCourse, urgency });
      choice = ranked.find((r) => !picks.some((p) => p.unit.id === r.unit.id)) || ranked[0];
    }
    picks.push(choice);
    seenRecent.unshift(choice.unit.id);
  }
  return picks;
}

/**
 * Smoothed quality of a video from everyone's engagement, 0..1-ish. Watch fraction is the
 * strongest signal (a video people watch 90% of is good even if nobody tapped like); early
 * leaves and wrong answers count against it. Bayesian prior of 1 good : 2 total.
 */
export function videoQuality(stats) {
  const leaves = stats.leaves || 0;
  const meanPct = leaves ? (stats.pctSum || 0) / 100 / leaves : null;
  const good = stats.completes + 2 * stats.likes + stats.quizRight + 2 * (stats.saves || 0) + (meanPct == null ? 0 : meanPct * leaves) + 0.5 * (stats.loops || 0);
  const bad = stats.skips + 0.5 * stats.quizWrong + 2 * (stats.less || 0) + (meanPct == null ? 0 : (1 - meanPct) * leaves);
  return (good + 1) / (stats.views + bad + 3);
}

// ---- Stage 2: which video ------------------------------------------------------------------------

/** Exploration share: none for a new student's first 8 videos, then decaying from 15% towards 3%. */
export const exploreRate = (served) => (served < 8 ? 0 : Math.max(0.03, 0.15 * (20 / (20 + served))));

/**
 * The student's taste for a format or topic from their own signals ({ views, completes, likes,
 * saves, skips, less, right, wrong, n, pctSum }): a Thompson sample shrunk toward 0.5 until
 * there is evidence (half weight after 3 signals).
 */
export function affinity(sig, rand = Math.random) {
  if (!sig) return 0.5;
  const watched = sig.n ? sig.pctSum || 0 : 0;
  const good = (sig.completes || 0) + 2 * (sig.likes || 0) + 2 * (sig.saves || 0) + (sig.right || 0) + watched + 0.5 * (sig.loops || 0);
  const bad = (sig.skips || 0) + 3 * (sig.less || 0) + 0.5 * (sig.wrong || 0) + Math.max(0, (sig.n || 0) - watched);
  const confidence = (good + bad) / (good + bad + 3);
  return confidence * sampleBeta(1 + good, 1 + bad, rand) + (1 - confidence) * 0.5;
}

// How heavy each format feels, for session fatigue (1 = light and short, 0 = long and dense).
export const FORMAT_LIGHTNESS = { rapid: 1, flashcards: 0.9, truefalse: 0.9, wow: 0.9, onething: 0.95, mythbust: 0.8, eli5: 0.75, realworld: 0.7, chat: 0.7, mnemonic: 0.6, why: 0.5, whatif: 0.5, beforeafter: 0.5, explain: 0.4, story: 0.3, examdrill: 0.1 };
// How much a format needs eyes on the screen (1 = dense cards to read, 0 = narration carries it).
export const FORMAT_VISUAL_DENSITY = { mnemonic: 0.85, truefalse: 0.7, beforeafter: 0.6, realworld: 0.35, eli5: 0.35, whatif: 0.3, wow: 0.3, spotmistake: 1, examdrill: 0.95, tierlist: 0.8, flashcards: 0.8, thisorthat: 0.7, speedrun: 0.7, rapid: 0.6, countdown: 0.6, levels: 0.5, guess: 0.5, explain: 0.5, why: 0.45, chat: 0.4, mythbust: 0.4, hottake: 0.35, wyr: 0.35, story: 0.25, pov: 0.25 };
// How much a format makes the student retrieve rather than re-read (review sessions: >1 wins, <1 loses).
export const FORMAT_RETRIEVAL = { flashcards: 1.5, truefalse: 1.5, challenge: 1.45, examdrill: 1.35, spotmistake: 1.3, guess: 1.25, cheatsheet: 1.2, mnemonic: 1.2, thisorthat: 1.15, mistakes: 1.1, speedrun: 1.1, predict: 1, rapid: 1, mythbust: 1, countdown: 0.95, onething: 0.9, tierlist: 0.9, wyr: 0.9, realworld: 0.85, levels: 0.8, chat: 0.8, history: 0.8, hottake: 0.8, beforeafter: 0.8, why: 0.75, pov: 0.75, analogy: 0.75, whatif: 0.75, explain: 0.7, story: 0.7, wow: 0.7, eli5: 0.65 };
// How gentle each format is, for difficulty adaptation (1 = gentlest).
export const FORMAT_GENTLENESS = { explain: 1, eli5: 1, wow: 0.95, realworld: 0.9, why: 0.9, chat: 0.9, whatif: 0.85, story: 0.8, beforeafter: 0.8, mnemonic: 0.7, mythbust: 0.6, rapid: 0.6, truefalse: 0.5, flashcards: 0.4, examdrill: 0 };

/**
 * Scores one ready video for this student right now.
 * @param video    { id, format, topic, createdAt }
 * @param stats    everyone's counters for the video (db.getStats)
 * @param signals  the student's learned tastes (events.js getSignals)
 * @param session  { viewed, lastFormats, lastTopics, wrongStreak, rightStreak, earlyStreak }
 * @returns {{ score, parts }}
 */
export function scoreVideo(video, stats, signals = {}, session = {}, { rand = Math.random, now = Date.now(), review = false, gentle: easeIn = false, weights = null } = {}) {
  // Calibration (feed/calibration.js): a fitted weight w in 0..1 per rule shrinks its multiplier
  // towards 1 (w = 1 keeps the rule as designed, w = 0 switches it off).
  const shrink = (rule, m) => (weights && weights[rule] != null ? 1 + weights[rule] * (m - 1) : m);
  const format = video.format || 'explain';
  const quality = videoQuality(stats);
  const formatAffinity = affinity(signals.formats?.[format], rand);
  const topicAffinity = affinity(signals.topics?.[video.topic], rand);
  const taste = 0.5 + 0.7 * formatAffinity + 0.3 * topicAffinity; // 0.5 .. 1.5

  const lastFormats = session.lastFormats || [];
  const lastTopics = session.lastTopics || [];
  const diversity = (lastFormats[0] === format ? 0.6 : lastFormats[1] === format ? 0.85 : 1) * (lastTopics[0] === video.topic && lastTopics[1] === video.topic ? 0.85 : 1);

  const viewed = session.viewed || 0;
  const light = FORMAT_LIGHTNESS[format] ?? 0.5;
  // After ~10 videos in a session, light formats gain up to +25% and heavy ones lose up to 25%.
  const fatigue = 1 + Math.min(1, Math.max(0, viewed - 6) / 12) * (light - 0.5) * 0.5;

  const gentle = FORMAT_GENTLENESS[format] ?? 0.5;
  const wrong = session.wrongStreak || 0, right = session.rightStreak || 0;
  const difficulty = wrong >= 2 ? 0.75 + 0.5 * gentle : right >= 3 ? 1.2 - 0.4 * gentle : 1;

  const ageDays = video.createdAt ? Math.max(0, (now - Date.parse(video.createdAt)) / 86400000) : 30;
  const freshness = 1 + 0.08 * Math.exp(-ageDays / 14);

  // Context: on the move, formats the narration carries win over dense cards; lying down late at
  // night, calmer and gentler ones do.
  const density = FORMAT_VISUAL_DENSITY[format] ?? 0.5;
  let context = 1;
  if (session.posture === 'moving') context *= 1.25 - 0.5 * density;
  if (session.night && session.posture === 'flat') context *= 0.85 + 0.3 * gentle - 0.15 * ((FORMAT_LIGHTNESS[format] ?? 0.5) > 0.8 ? 1 : 0);

  // Review: a unit that is due again gets retrieval practice (flashcards, true/false, drills), not another explainer.
  const retrieval = review ? FORMAT_RETRIEVAL[format] ?? 1 : 1;
  // Back after days away: the first page eases in with the gentler formats.
  const easing = easeIn ? 0.75 + 0.5 * gentle : 1;

  const score = quality * taste * shrink('diversity', diversity) * shrink('fatigue', fatigue) * shrink('difficulty', difficulty) * shrink('freshness', freshness) * shrink('context', context) * shrink('retrieval', retrieval) * shrink('easing', easing);
  return { score, parts: { quality: +quality.toFixed(3), formatAffinity: +formatAffinity.toFixed(3), topicAffinity: +topicAffinity.toFixed(3), diversity, fatigue: +fatigue.toFixed(3), difficulty: +difficulty.toFixed(3), freshness: +freshness.toFixed(3), context: +context.toFixed(3), ...(review ? { retrieval } : {}), ...(easeIn ? { easing: +easing.toFixed(3) } : {}) } };
}
