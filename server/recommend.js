// The StudyTok algorithm. Pure functions: no I/O, so it is easy to test and tune.
//
// For each feed slot it scores every candidate unit (the student's course units plus their
// interest topics) and takes the best:
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
//   with a small chance of a random candidate (exploration).
//
// Videos within a unit are ranked by a smoothed quality score shared by all students.

export const BOX_DAYS = [1, 3, 7, 21];
const WRONG_RETRY_MS = 20 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export const emptyState = () => ({ served: 0, views: 0, completes: 0, skips: 0, likes: 0, less: 0, quizRight: 0, quizWrong: 0, box: -1, lastSeen: 0, due: 0 });

/** Probability-ish estimate that the student has learned the unit (0..1). */
export function mastery(s) {
  if (!s || !s.views) return 0;
  const quiz = (s.quizRight + 0.5) / (s.quizRight + s.quizWrong + 1);
  const exposure = Math.min(1, s.completes / 3);
  return Math.round((0.6 * quiz * Math.min(1, (s.quizRight + s.quizWrong) / 2) + 0.4 * exposure) * 100) / 100;
}

/** Applies one engagement event to a unit state (returns a new state). */
export function applyEvent(state, type, { correct, now = Date.now() } = {}) {
  const s = { ...emptyState(), ...state };
  switch (type) {
    case 'served': s.served++; break;
    case 'view': s.views++; s.lastSeen = now; if (s.box < 0) { s.box = 0; s.due = now + BOX_DAYS[0] * DAY; } break;
    case 'complete': s.completes++; break;
    case 'skip': s.skips++; break;
    case 'like': s.likes++; break;
    case 'unlike': s.likes = Math.max(0, s.likes - 1); break;
    case 'less': s.less++; break;
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
export function scoreUnits(candidates, states, recent = [], { now = Date.now(), rand = Math.random, hasCourse = true } = {}) {
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
    const engaged = s.completes + 2 * s.likes + s.quizRight;
    const disengaged = s.skips + 3 * s.less + 0.5 * s.quizWrong;
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

    const review = s.lastSeen && s.due && s.due <= now ? (s.quizWrong > s.quizRight ? 0.9 : 0.6) : 0;

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
export function pickUnits(candidates, states, recent, count, { explore = 0.1, rand = Math.random, now = Date.now(), hasCourse = true } = {}) {
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
      const ranked = scoreUnits(candidates, states, seenRecent, { now, rand, hasCourse });
      choice = ranked.find((r) => !picks.some((p) => p.unit.id === r.unit.id)) || ranked[0];
    }
    picks.push(choice);
    seenRecent.unshift(choice.unit.id);
  }
  return picks;
}

/** Smoothed quality of a video from everyone's engagement (for choosing within a unit). */
export function videoQuality(stats) {
  const good = stats.completes + 2 * stats.likes + stats.quizRight + 2 * (stats.saves || 0);
  const bad = stats.skips + 0.5 * stats.quizWrong;
  return (good + 1) / (stats.views + bad + 3);
}
