// The learning profile: how a student learns best, measured. Ported from StudyGraph's
// learning-style questionnaire (Visual, Auditory, Reading/Writing, Kinesthetic), with one
// change: there, the style was what the student said; here, what they say is only the starting
// point, and the profile follows what they actually finish, get right, replay and play.
// (Matching teaching to a self-reported style has little evidence behind it; matching to what a
// student measurably engages with and learns from is just good personalisation, and the
// calibration loop checks whether it helps: see `style` in feed/calibration.js.)
//
// Four ways in, each format weighted by what it asks of the student:
//   visual    seeing it        diagrams, cards, timelines, tier lists, before/after
//   listening hearing it       stories, POV, analogies, "like I am five", what-ifs
//   reading   reading it       flashcards, cheat sheets, mnemonics, mistakes, chats
//   handson   doing it         guess first, challenges, spot the mistake, exam drills, games

export const STYLES = ['visual', 'listening', 'reading', 'handson'];
export const STYLE_META = {
  visual: { label: 'Seeing it', short: 'Visual', blurb: 'diagrams, cards and timelines', said: 'Visual' },
  listening: { label: 'Hearing it explained', short: 'Listening', blurb: 'stories, analogies and explanations', said: 'Auditory' },
  reading: { label: 'Reading it', short: 'Reading', blurb: 'flashcards, cheat sheets and notes', said: 'Reading/Writing' },
  handson: { label: 'Doing it', short: 'Hands-on', blurb: 'guessing first, challenges and games', said: 'Kinesthetic' },
};

/** What each format asks of the student (weights sum to 1). */
export const FORMAT_STYLE = {
  explain: { visual: 0.6, listening: 0.4 }, onething: { visual: 0.7, listening: 0.3 }, beforeafter: { visual: 0.7, listening: 0.3 },
  history: { visual: 0.6, listening: 0.4 }, tierlist: { visual: 0.6, reading: 0.4 }, realworld: { visual: 0.6, listening: 0.4 },
  rapid: { visual: 0.5, listening: 0.5 }, countdown: { visual: 0.5, listening: 0.5 }, wow: { visual: 0.5, listening: 0.5 },
  speedrun: { visual: 0.4, listening: 0.6 }, cheatsheet: { visual: 0.4, reading: 0.6 }, mnemonic: { visual: 0.4, reading: 0.6 },
  story: { listening: 0.8, visual: 0.2 }, pov: { listening: 0.8, visual: 0.2 }, eli5: { listening: 0.7, visual: 0.3 },
  levels: { listening: 0.7, visual: 0.3 }, analogy: { listening: 0.7, visual: 0.3 }, whatif: { listening: 0.7, visual: 0.3 },
  why: { listening: 0.6, visual: 0.4 }, hottake: { listening: 0.7, handson: 0.3 }, mythbust: { listening: 0.5, reading: 0.5 },
  chat: { reading: 0.7, listening: 0.3 }, flashcards: { reading: 0.6, handson: 0.4 }, mistakes: { reading: 0.6, visual: 0.4 },
  thisorthat: { handson: 0.6, reading: 0.4 }, truefalse: { handson: 0.6, reading: 0.4 },
  examdrill: { handson: 0.6, reading: 0.4 }, spotmistake: { handson: 0.7, reading: 0.3 }, guess: { handson: 0.8, listening: 0.2 },
  challenge: { handson: 0.8, reading: 0.2 }, wyr: { handson: 0.7, listening: 0.3 }, predict: { handson: 0.5, visual: 0.5 },
  detective: { handson: 0.5, listening: 0.5 }, teachback: { handson: 0.7, listening: 0.3 }, numbers: { visual: 0.8, listening: 0.2 },
  zoom: { visual: 0.8, listening: 0.2 }, interview: { reading: 0.6, listening: 0.4 }, debate: { listening: 0.7, handson: 0.3 },
  connect: { listening: 0.5, visual: 0.5 }, howto: { handson: 0.6, visual: 0.4 },
};
/** Games count towards doing it, and the word games towards reading it too. */
const GAME_STYLE = { match: { handson: 0.5, reading: 0.5 }, order: { handson: 0.7, visual: 0.3 }, sort: { handson: 0.7, visual: 0.3 }, truefalse: { handson: 0.8, reading: 0.2 }, fillgap: { handson: 0.5, reading: 0.5 } };

export const cleanStyles = (a) => [...new Set((Array.isArray(a) ? a : []).filter((s) => STYLES.includes(s)))];

const zero = () => ({ good: 0, bad: 0, right: 0, wrong: 0, views: 0, pctSum: 0, n: 0 });

/**
 * The profile from a student's signals and what they said they prefer.
 * @returns {{ styles: Array<{id,label,short,blurb,score,watch,accuracy,views}>, top, confidence, said, measured: boolean }}
 */
export function learningProfile(signals = {}, said = []) {
  said = cleanStyles(said);
  const acc = Object.fromEntries(STYLES.map((s) => [s, zero()]));
  for (const [format, sig] of Object.entries(signals.formats || {})) {
    const w = FORMAT_STYLE[format];
    if (!w || !sig) continue;
    const n = sig.n || 0, pct = sig.pctSum || 0;
    for (const [s, k] of Object.entries(w)) {
      const a = acc[s];
      a.good += k * (pct + 0.5 * (sig.completes || 0) + (sig.likes || 0) + (sig.saves || 0) + 0.5 * (sig.loops || 0));
      a.bad += k * (Math.max(0, n - pct) + (sig.skips || 0) + 2 * (sig.less || 0));
      a.right += k * (sig.right || 0); a.wrong += k * (sig.wrong || 0);
      a.views += k * n; a.pctSum += k * pct; a.n += k * n;
    }
  }
  for (const [type, g] of Object.entries(signals.games?.byType || {})) {
    const w = GAME_STYLE[type];
    if (!w || !g) continue;
    for (const [s, k] of Object.entries(w)) {
      const a = acc[s];
      a.good += k * (g.n || 0); a.right += k * (g.right || 0); a.wrong += k * Math.max(0, (g.items || 0) - (g.right || 0)); a.views += k * (g.n || 0);
    }
  }
  // What the student said is a prior worth a few lessons, not the answer.
  for (const s of said) { acc[s].good += 3; acc[s].bad += 1; }
  const evidence = STYLES.reduce((t, s) => t + acc[s].views, 0);
  const confidence = +((evidence + (said.length ? 4 : 0)) / (evidence + (said.length ? 4 : 0) + 10)).toFixed(3);
  const styles = STYLES.map((s) => {
    const a = acc[s];
    const engagement = (a.good + 1) / (a.good + a.bad + 2);
    const accuracy = (a.right + 1) / (a.right + a.wrong + 2);
    return { id: s, ...STYLE_META[s], score: +(0.6 * engagement + 0.4 * accuracy).toFixed(3), watch: a.n ? +(a.pctSum / a.n).toFixed(3) : null, accuracy: a.right + a.wrong ? +(a.right / (a.right + a.wrong)).toFixed(3) : null, views: Math.round(a.views) };
  }).sort((x, y) => y.score - x.score);
  return { styles, top: styles[0].id, confidence, said, measured: evidence >= 12 };
}

/**
 * The ranking multiplier for a format given a profile: formats that use the student's stronger
 * ways in get up to +12 %, weaker ones down to −12 %, scaled by how sure the profile is.
 */
export function styleFit(format, profile) {
  const w = FORMAT_STYLE[format];
  if (!w || !profile?.confidence) return 1;
  const by = Object.fromEntries(profile.styles.map((s) => [s.id, s.score]));
  const mean = STYLES.reduce((t, s) => t + by[s], 0) / STYLES.length;
  const fit = Object.entries(w).reduce((t, [s, k]) => t + k * by[s], 0);
  return +Math.max(0.88, Math.min(1.12, 1 + 1.2 * profile.confidence * (fit - mean))).toFixed(3);
}

/** One sentence on what the numbers show, for the Profile card (null until there is evidence). */
export function insightOf(profile) {
  if (!profile?.measured) return null;
  const withWatch = profile.styles.filter((s) => s.watch != null && s.views >= 3);
  if (withWatch.length < 2) return null;
  const best = [...withWatch].sort((a, b) => b.watch - a.watch)[0], worst = [...withWatch].sort((a, b) => a.watch - b.watch)[0];
  if (best.id === worst.id || best.watch - worst.watch < 0.08) return `You watch every kind of lesson about as far through (around ${Math.round(best.watch * 100)}%). Your feed keeps the mix.`;
  return `You watch ${Math.round(best.watch * 100)}% of ${best.short.toLowerCase()} lessons on average and ${Math.round(worst.watch * 100)}% of ${worst.short.toLowerCase()} ones. Your feed leans that way, and keeps checking.`;
}
