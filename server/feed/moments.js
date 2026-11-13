// Moments: short, animated cards StudyGraph drops between lessons: a tip about the app, a piece
// of news, or an offer. No video is made for them (they are rendered by the app), so they cost
// nothing, and they are paced so the feed stays a feed: never for a brand-new student, at most
// one every six lessons, at most three a day, and never twice within a moment's repeat window.
//
// The catalogue below is the built-in set. Extra moments (a real offer, this week's news) can be
// posted at runtime to POST /api/admin/moments and live in the `moments:extra` key; they are
// shown ahead of the built-in ones and need no deploy.

import { kv } from '../core/kv.js';
import { config } from '../core/config.js';

export const MIN_VIEWED = 4;      // lessons watched in the session before the first moment
export const GAP = 6;             // lessons between two moments
export const MAX_PER_DAY = 3;
export const THEMES = ['sun', 'mint', 'rose', 'sky', 'grape'];

/**
 * Each moment: id, type (tip | news | offer), title, 2-3 short lines that appear one after the
 * other, an emoji, Noti's mood (happy | cheer | think | sleepy), a call to action
 * ({ label, action }) where action is one of: feed | library | saved | profile | invite | install |
 * reminders | tune | url (with href), a colour theme, a repeat window in days, and `when(ctx)`,
 * which decides whether the moment fits this student right now.
 */
export const MOMENTS = [
  { id: 'tip-save', type: 'tip', theme: 'sun', emoji: '🔖', mood: 'happy', repeatDays: 45,
    title: 'Keep the keepers', lines: ['Tap the bookmark on any lesson.', 'It lands in Library › Saved.', 'Revise the lot the night before.'],
    cta: { label: 'See Saved', action: 'saved' }, when: (c) => c.saved === 0 && c.watched >= 3 },
  { id: 'tip-worlds', type: 'tip', theme: 'rose', emoji: '⚽', mood: 'cheer', repeatDays: 30,
    title: 'What are you into?', lines: ['Football, music, gaming, food, anything.', 'Pick a few and some lessons will be set there.', 'Same syllabus. Your world.'],
    cta: { label: 'Pick mine', action: 'worlds' }, when: (c) => c.watched >= 4 && !(c.user.worlds?.length) && c.worldsFound === 0 },
  { id: 'tip-less', type: 'tip', theme: 'mint', emoji: '🙈', mood: 'think', repeatDays: 60,
    title: 'Teach the feed', lines: ['Not for you? Tap Less.', 'The algorithm takes the hint on the next page.', 'Like and Save do the opposite.'],
    cta: { label: 'Got it', action: 'feed' }, when: (c) => c.watched >= 5 && c.lessTaps === 0 },
  { id: 'tip-why', type: 'tip', theme: 'sky', emoji: '✨', mood: 'think', repeatDays: 60,
    title: 'No black box', lines: ['Every lesson has a Why button.', 'It shows exactly why it was picked for you.', 'Mastery, timing, curiosity: all of it.'],
    cta: { label: 'Next lesson', action: 'feed' }, when: (c) => c.watched >= 6 },
  { id: 'tip-quiz', type: 'tip', theme: 'rose', emoji: '🤔', mood: 'think', repeatDays: 90,
    title: 'The video waits for you', lines: ['At the quick check the lesson pauses.', 'Answer and it carries on.', 'Getting it wrong is how it sticks.'],
    cta: { label: 'Try one', action: 'feed' }, when: (c) => c.watched >= 2 && !(c.signals.quiz?.n > 0) },
  { id: 'tip-goal', type: 'tip', theme: 'sun', emoji: '🎯', mood: 'cheer', repeatDays: 60,
    title: 'Three a day', lines: ['Three lessons fill the ring in your Library.', 'Every day you fill it, the streak grows.', 'Small and daily beats big and never.'],
    cta: { label: 'See my ring', action: 'library' }, when: (c) => c.watched >= 4 },
  { id: 'tip-review', type: 'tip', theme: 'grape', emoji: '🔁', mood: 'happy', repeatDays: 90,
    title: 'Spaced repetition, built in', lines: ['Units come back right before you would forget them.', 'Review sessions use flashcards and quick checks.', 'You never have to plan revision again.'],
    cta: { label: 'Next lesson', action: 'feed' }, when: (c) => c.watched >= 8 },
  { id: 'tip-share', type: 'tip', theme: 'mint', emoji: '📤', mood: 'cheer', repeatDays: 45,
    title: 'Send a lesson to a friend', lines: ['Tap Share on any lesson.', 'They can watch it with no account.', 'If they join, it counts as your invite.'],
    cta: { label: 'Next lesson', action: 'feed' }, when: (c) => c.watched >= 5 && (c.signals.shares || 0) === 0 },
  { id: 'tip-install', type: 'tip', theme: 'sky', emoji: '📲', mood: 'happy', repeatDays: 30,
    title: 'Put StudyGraph on your home screen', lines: ['Opens full screen, like an app.', 'Faster, and your sound settings stick.', 'Takes ten seconds.'],
    cta: { label: 'Show me how', action: 'install' }, when: (c) => c.watched >= 3 && c.device.platform && !c.device.standalone },
  { id: 'tip-reminders', type: 'tip', theme: 'rose', emoji: '🔔', mood: 'happy', repeatDays: 30,
    title: 'A nudge at the right time', lines: ['One reminder a day, only if you have not studied.', 'No spam. Ever.', 'Turn it on in your Profile.'],
    cta: { label: 'Turn on reminders', action: 'reminders' }, when: (c) => c.pushEnabled && !c.pushSubscribed && c.watched >= 6 },
  { id: 'tip-topics', type: 'tip', theme: 'grape', emoji: '✍️', mood: 'think', repeatDays: 60,
    title: 'Learn anything, in your words', lines: ['Type a topic into your Library.', '"Photosynthesis for WASSCE" works. So does "how do vaccines work".', 'Lessons arrive in about a minute.'],
    cta: { label: 'Add a topic', action: 'library' }, when: (c) => c.watched >= 7 && !c.customUnits },
  { id: 'tip-tune', type: 'tip', theme: 'mint', emoji: '🎚️', mood: 'happy', repeatDays: 60,
    title: 'Make it yours', lines: ['Narration on or off. Faster or calmer.', 'More examples or more drills.', 'Tune is one tap away.'],
    cta: { label: 'Open Tune', action: 'tune' }, when: (c) => c.watched >= 9 && !Object.keys(c.signals.prefs || {}).length },
  { id: 'tip-keys', type: 'tip', theme: 'sky', emoji: '⌨️', mood: 'happy', repeatDays: 90,
    title: 'Keyboard, if you like', lines: ['↑ ↓ or J K to move.', 'Space pauses. L likes.', 'Your hands never leave the keys.'],
    cta: { label: 'Next lesson', action: 'feed' }, when: (c) => c.watched >= 4 && c.device.platform && !/iPhone|iPad|Android/i.test(c.device.platform) },

  { id: 'news-formats', type: 'news', theme: 'sun', emoji: '🎬', mood: 'cheer', repeatDays: 120,
    title: '32 ways to learn one thing', lines: ['Explainers, flashcards, myth-busters, before-and-afters…', 'The feed learns which ones work for you.', 'Same syllabus, never the same video.'],
    cta: { label: 'Keep swiping', action: 'feed' }, when: (c) => c.watched >= 10 },
  { id: 'news-breathers', type: 'news', theme: 'grape', emoji: '🫧', mood: 'happy', repeatDays: 120,
    title: 'Noti knows when you need a breather', lines: ['Three wrong in a row? A fun one from next door.', 'Then straight back to your units.', 'You will see a small "Breather" tag when it happens.'],
    cta: { label: 'Keep swiping', action: 'feed' }, when: (c) => c.watched >= 12 },
  { id: 'news-explore', type: 'news', theme: 'sky', emoji: '🧭', mood: 'cheer', repeatDays: 60,
    title: 'Packs people have shared', lines: ['The ideas of a book. Notes from a class. What a project does.', 'Add one from Explore and its units join your course.', 'Share your own with a Markdown file.'],
    cta: { label: 'Open Explore', action: 'explore' }, when: (c) => c.watched >= 5 && !(c.user.packs || []).length },
  { id: 'news-links', type: 'news', theme: 'mint', emoji: '🔗', mood: 'cheer', repeatDays: 120,
    title: 'Lessons now have links', lines: ['Every lesson has a page anyone can open.', 'Paste it in a group chat. It just plays.', 'Your invite rides along with it.'],
    cta: { label: 'Keep swiping', action: 'feed' }, when: (c) => c.watched >= 8 },

  { id: 'offer-invite', type: 'offer', theme: 'rose', emoji: '🎁', mood: 'cheer', repeatDays: 21,
    title: 'Bring a classmate', lines: ['Your invite link is in your Profile.', 'Every friend who joins shows up under your name.', 'Lessons are better argued over.'],
    cta: { label: 'Get my link', action: 'invite' }, when: (c) => c.watched >= 6 && c.invites === 0 },
  { id: 'offer-free', type: 'offer', theme: 'sun', emoji: '🆓', mood: 'happy', repeatDays: 14,
    title: (c) => `${Math.max(0, c.freeLeft)} free lessons left`, lines: [(c) => `StudyGraph makes your first ${c.freeTotal} brand-new lessons for you.`, 'Lessons already in the library stay free forever.', 'Connect your own Vidmoat account for unlimited.'],
    cta: { label: 'See my credits', action: 'profile' }, when: (c) => c.freeTotal > 0 && !c.ownAccount && c.freeLeft > 0 && c.freeLeft <= Math.ceil(c.freeTotal / 2) },
  { id: 'offer-unlimited', type: 'offer', theme: 'sky', emoji: '🚀', mood: 'cheer', repeatDays: 14,
    title: 'Unlimited lessons, your way', lines: ['Connect a Vidmoat account and every new lesson is yours.', 'Your syllabus, your pace, no waiting list.', 'It takes one tap in your Profile.'],
    cta: { label: 'Connect Vidmoat', action: 'profile' }, when: (c) => !c.ownAccount && c.freeTotal > 0 && c.freeLeft === 0 },
];

const str = (x, ctx) => (typeof x === 'function' ? x(ctx) : x);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const STALE_MS = 12 * 3600000; // a session older than this is over: the next page opens a new visit

/**
 * Looking after the student: after 40 minutes in one sitting an under-18 is told to rest their
 * eyes, and anyone still going late at night is told that sleep is when memory consolidates.
 * Once a session, ahead of any other moment, never counted against the day's quota. The streak
 * is safe either way: the point is to come back tomorrow, not to stay.
 */
export const BREAK_AFTER_MS = 40 * 60 * 1000;
export function careMoment({ session = {}, ctx = {}, now = Date.now(), mark = {} } = {}) {
  const started = session.startedAt || 0;
  if (!started || now - started < BREAK_AFTER_MS || (session.sid && mark.careSid === session.sid)) return null;
  if (session.night) {
    return { id: 'care-sleep', type: 'tip', theme: 'grape', emoji: '🌙', mood: 'sleepy', care: true,
      title: 'Sleep is part of studying', lines: ['Your brain files today\'s lessons while you sleep.', 'Stopping now helps them stick.', 'Your streak is safe. See you tomorrow.'],
      cta: { label: 'One more, then sleep', action: 'feed' } };
  }
  if (!ctx.minor) return null;
  return { id: 'care-break', type: 'tip', theme: 'mint', emoji: '🌿', mood: 'sleepy', care: true,
    title: 'Time for a short break', lines: [`That's ${Math.round((now - started) / 60000)} minutes of learning. Nice.`, 'Rest your eyes for five minutes.', 'A break helps it sink in.'],
    cta: { label: 'Back to learning', action: 'feed' } };
}

/**
 * The card that opens a visit, when there is something worth saying: welcome back after days
 * away, what happened last time, or the exam countdown. At most one a day, in the first slot.
 */
export function openerMoment({ session = {}, signals = {}, stats = {}, exam = null, now = Date.now(), mark = {} } = {}) {
  if (!session.lastAt || now - session.lastAt < STALE_MS) return null;
  if (mark.openerDay === dayOf(now)) return null;
  const away = Math.floor((now - (signals.lastSeenAt || session.lastAt)) / 86400000);
  const goal = stats.goal || 3;
  if (away >= 3) {
    return { id: 'opener-welcome', type: 'welcome', theme: 'sun', emoji: '👋', mood: 'cheer', opener: true,
      title: `Welcome back. ${plural(away, 'day')} away.`,
      lines: ['Your streak starts again today.', `${goal} lessons and you are back in it.`, 'The first ones are on the easy side. On purpose.'],
      cta: { label: "Let's go", action: 'feed' } };
  }
  if (exam && exam.days != null && exam.days >= 0 && exam.days <= 60 && (!mark.examAt || now - mark.examAt > 7 * 86400000)) {
    const left = Math.max(0, (stats.unitsTotal || 0) - (stats.mastered || 0));
    const perDay = exam.days > 0 && left ? Math.max(1, Math.ceil((left * 3) / exam.days)) : null;
    return { id: 'opener-exam', type: 'exam', theme: 'rose', emoji: '📅', mood: 'think', opener: true, examMark: true,
      title: exam.days === 0 ? `${exam.name} is today` : `${plural(exam.days, 'day')} to ${exam.name}`,
      lines: exam.days === 0 ? ['Breathe. You have done the work.', 'A light review, then rest.'] : [
        left ? `${plural(left, 'unit')} still to master.` : 'Every unit mastered. Keep them warm.',
        perDay ? `${plural(perDay, 'lesson')} a day covers it with room to spare.` : 'Review sessions take over from here.',
        'Your feed now leans towards revision.'],
      cta: { label: 'See my course', action: 'library' } };
  }
  if ((session.viewed || 0) >= 1) {
    const q = session.quizN || 0, r = session.quizRight || 0;
    const lines = [q ? `${r} of ${q} quick checks right.` : 'No quick checks last time.',
      stats.due ? `${plural(stats.due, 'unit')} due for review today.` : 'Your syllabus continues where you left it.',
      stats.streak >= 2 ? `${stats.streak}-day streak. Keep it.` : `Today's goal: ${goal} lessons.`];
    return { id: 'opener-recap', type: 'recap', theme: 'sky', emoji: '🗒️', mood: 'happy', opener: true,
      title: `Last time: ${plural(session.viewed, 'lesson')}`, lines, cta: { label: 'Continue', action: 'feed' } };
  }
  return null;
}

/** The facts a moment's `when` can look at. */
export function momentContext({ user = {}, signals = {}, worldsFound = 0, saved = 0, watched = 0, invites = 0, pushEnabled = false, pushSubscribed = false } = {}) {
  const b = user.billing || {};
  const freeTotal = config.billing?.freeVideos || 0;
  return {
    user, signals, worldsFound, saved, watched, invites, pushEnabled, pushSubscribed,
    minor: user.profile?.age != null && user.profile.age < 18,
    device: signals.device || {},
    customUnits: (user.units || []).some((id) => String(id).startsWith('cu:')),
    lessTaps: Object.values(signals.topics || {}).reduce((n, t) => n + (t?.less || 0), 0),
    ownAccount: Boolean(user.vidmoatTokens),
    freeTotal, freeLeft: Math.max(0, freeTotal - (b.houseUsed || 0)),
  };
}

/** Extra moments posted by the admin (offers, news). Each has the same shape as a built-in one, without `when`. */
export async function extraMoments() {
  const list = await kv.get('moments:extra');
  return Array.isArray(list) ? list.filter((m) => m && m.id && m.title) : [];
}
export async function setExtraMoments(list) {
  const clean = (Array.isArray(list) ? list : []).slice(0, 20).map((m) => ({
    id: `x-${String(m.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || Date.now()}`,
    type: ['tip', 'news', 'offer'].includes(m.type) ? m.type : 'news',
    theme: THEMES.includes(m.theme) ? m.theme : 'sun',
    emoji: String(m.emoji || '📣').slice(0, 4),
    mood: ['happy', 'cheer', 'think', 'sleepy'].includes(m.mood) ? m.mood : 'cheer',
    title: String(m.title || '').slice(0, 60),
    lines: (Array.isArray(m.lines) ? m.lines : []).slice(0, 3).map((l) => String(l).slice(0, 120)),
    cta: m.cta?.label ? { label: String(m.cta.label).slice(0, 30), action: /^https?:\/\//.test(m.cta.href || '') ? 'url' : (m.cta.action || 'feed'), href: /^https?:\/\//.test(m.cta.href || '') ? m.cta.href : undefined } : { label: 'Keep swiping', action: 'feed' },
    repeatDays: Math.max(1, Math.min(365, Number(m.repeatDays) || 14)),
    until: m.until && !Number.isNaN(Date.parse(m.until)) ? m.until : undefined,
    minWatched: Math.max(0, Number(m.minWatched) || 0),
  }));
  await kv.set('moments:extra', clean);
  return clean;
}

/** What the app renders: the moment with its strings resolved for this student. */
export function momentItem(m, ctx) {
  return {
    id: `moment:${m.id}`, kind: 'moment', status: 'ready',
    moment: { id: m.id, type: m.type, theme: m.theme, emoji: m.emoji, mood: m.mood, title: str(m.title, ctx), lines: m.lines.map((l) => str(l, ctx)), cta: m.cta },
    topic: { id: 'moment', label: { offer: 'Offer', news: 'News', welcome: 'Welcome back', recap: 'Last time', exam: 'Countdown' }[m.type] || 'Tip', emoji: m.emoji, accent: '#ffd93d' },
  };
}

/**
 * Picks the moment for this page, if the pacing allows one: `session.viewed` lessons into the
 * session, at least GAP since the last moment, under MAX_PER_DAY today, nothing repeated inside
 * its window, and the student's facts fit. Extras (admin-posted) come first, then the catalogue
 * in order. Returns null when no moment fits.
 */
export async function pickMoment(userId, { session = {}, ctx, now = Date.now(), hasBreather = false, stats = null, exam = null, gap = GAP } = {}) {
  if (hasBreather || !ctx) return null;
  const viewed = session.viewed || 0;
  const mark = (await kv.get(`user:${userId}:moments`)) || { seen: {}, at: -GAP, day: '', today: 0 };
  const care = careMoment({ session, ctx, now, mark });
  if (care) return care;
  const opener = stats ? openerMoment({ session, signals: ctx.signals, stats, exam, now, mark }) : null;
  if (opener) return opener;
  // A stale session is over: the new visit starts counting from zero, like the events will.
  if (session.lastAt && now - session.lastAt > STALE_MS) return null;
  if (viewed < MIN_VIEWED || viewed - (mark.at ?? -gap) < gap) return null;
  if (mark.day === dayOf(now) && (mark.today || 0) >= MAX_PER_DAY) return null;
  const fresh = (m) => !(mark.seen?.[m.id]) || now - mark.seen[m.id] > (m.repeatDays || 30) * 86400000;
  for (const m of await extraMoments()) {
    if ((m.until && Date.parse(m.until) < now) || ctx.watched < (m.minWatched || 0)) continue;
    if (fresh(m)) return m;
  }
  for (const m of MOMENTS) if (fresh(m) && m.when(ctx)) return m;
  return null;
}

/** Records that a moment was served at `viewed` lessons into the session. */
export async function noteMoment(userId, m, viewed = 0, now = Date.now(), { sid = '' } = {}) {
  const mark = (await kv.get(`user:${userId}:moments`)) || { seen: {} };
  if (m.care) { await kv.set(`user:${userId}:moments`, { ...mark, careSid: sid || `t${now}` }); return; } // once a session
  if (m.opener) { // openers do not count against the day's quota or the gap
    await kv.set(`user:${userId}:moments`, { ...mark, openerDay: dayOf(now), ...(m.examMark ? { examAt: now } : {}) });
    return;
  }
  const today = mark.day === dayOf(now) ? (mark.today || 0) + 1 : 1;
  const seen = { ...(mark.seen || {}), [m.id]: now };
  await kv.set(`user:${userId}:moments`, { ...mark, seen, at: viewed, day: dayOf(now), today, lastAt: now });
}
