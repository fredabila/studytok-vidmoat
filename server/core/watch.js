// Public lesson pages (GET /v/:id): an HTML page anyone can open without a session, with Open
// Graph / Twitter tags for link previews and the lesson playing in Vidmoat's embed player.
// Built here as a template string so the page can be unit-tested without a browser or a file
// read. Every interpolated value is escaped: lesson titles and hooks come from an LLM.

import { format as formatOf } from '../video/formats.js';
import { TOPIC_BY_ID } from '../curriculum/topics.js';

export const SITE_NAME = 'StudyGraph';
export const FALLBACK_IMAGE = 'https://studytok.vidmoat.com/icons/icon-512.png';

const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap';

/** HTML-escapes text for element content and double-quoted attribute values. */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Member number from ?ref= (positive integer), else null. Never a name. */
export function refOf(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 1e9 ? n : null;
}

/**
 * The lesson as the public page may see it: the same shape as feed/index.js publicVideo() minus
 * everything that belongs to a signed-in viewer (liked, saved, why, position…). Only for ready
 * videos; callers 404 otherwise.
 */
export function publicLesson(v, document) {
  const look = TOPIC_BY_ID[v.topic] || TOPIC_BY_ID.biology;
  const f = formatOf(v.format);
  const quiz = v.quiz ? { ...v.quiz, hold: v.quiz.hold ?? (v.quiz.reveal != null ? Math.max(v.quiz.from ?? 0, +(v.quiz.reveal - 3).toFixed(2)) : null) } : null;
  return {
    id: v.id,
    status: 'ready',
    topic: { id: look.id, label: look.label, emoji: look.emoji, accent: look.accent },
    format: { id: v.format || 'explain', tag: f.tag, name: f.name },
    unit: v.unitId ? { id: v.unitId, title: v.unitTitle || null } : null,
    title: v.lesson?.title || null,
    hook: v.lesson?.hook || null,
    subtopic: v.lesson?.subtopic || null,
    duration: v.duration || null,
    poster: v.poster || null,
    narrated: Boolean(v.narrated),
    quiz,
    scenes: v.scenes || [],
    credits: v.credits || [],
    document: document || undefined,
  };
}

/** Only an http(s) URL may be used as a poster; anything else falls back to the app icon. */
function posterUrl(poster) {
  try {
    const u = new URL(String(poster || ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : FALLBACK_IMAGE;
  } catch { return FALLBACK_IMAGE; }
}

function shell({ title, description, image, url, body, noindex = false, ref = null }) {
  const e = escapeHtml;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${e(title)} · ${SITE_NAME}</title>
  <meta name="description" content="${e(description)}">
  ${noindex ? '<meta name="robots" content="noindex">' : ''}
  <link rel="canonical" href="${e(url)}">
  <meta property="og:type" content="video.other">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${e(title)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:image" content="${e(image)}">
  <meta property="og:url" content="${e(url)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${e(title)}">
  <meta name="twitter:description" content="${e(description)}">
  <meta name="twitter:image" content="${e(image)}">
  <meta name="theme-color" content="#f6f1e7">
  <link rel="icon" href="/icons/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS}">
  <link rel="stylesheet" href="/watch.css">
</head>
<body${ref ? ` data-ref="${ref}"` : ''}>
${body}
<footer class="foot"><span class="mono">Built by Vidmoat · a Buzz Innovations Ltd. company</span></footer>
</body>
</html>
`;
}

const brand = (homeHref) => `<header class="top">
  <a class="brand" href="${escapeHtml(homeHref)}"><span class="brand-mark" aria-hidden="true"></span><span class="serif">StudyGraph</span></a>
</header>`;

/**
 * The public page for a ready video. `url` is the canonical page URL (no query string);
 * `ref` the inviting member's number, or null.
 */
export function watchPage(v, { url, ref = null, playerOrigin }) {
  const e = escapeHtml;
  const title = v.lesson?.title || v.unitTitle || 'A StudyGraph lesson';
  const description = v.lesson?.hook || v.lesson?.takeaway || `A short ${formatOf(v.format).name.toLowerCase()} lesson from ${SITE_NAME}.`;
  const image = posterUrl(v.poster);
  const home = ref ? `/?ref=${ref}` : '/';
  const f = formatOf(v.format);
  const body = `${brand(home)}
<main class="watch" data-video="${e(v.id)}" data-player-origin="${e(playerOrigin)}">
  <div class="pills">
    ${v.unitTitle ? `<span class="unit-pill"><span class="dot"></span>${e(v.unitTitle)}</span>` : ''}
    <span class="fmt-badge">${e(f.tag || f.name)}</span>
  </div>
  <h1 class="title">${e(title)}</h1>
  <p class="hook">${e(description)}</p>
  <section class="stage" aria-label="Lesson video">
    ${v.poster ? `<img class="poster" src="${e(image)}" alt="" decoding="async">` : ''}
    <div class="player-host"></div>
    <button type="button" class="play" aria-label="Play the lesson"><span class="play-ring"><span class="play-tri"></span></span><span class="play-label">Tap to play</span></button>
    <p class="note" aria-live="polite" hidden></p>
    <div class="quiz" hidden>
      <p class="quiz-label">Quick check <span class="quiz-hint">· tap an answer to continue</span></p>
      <div class="quiz-options"></div>
      <p class="quiz-feedback" aria-live="polite"></p>
      <button type="button" class="quiz-skip">Skip</button>
    </div>
    <div class="bar"></div>
  </section>
  ${ref ? `<p class="shared-by mono">Shared by member #${ref}</p>` : ''}
  <section class="cta">
    <h2 class="serif">Lessons like this, for <mark>your</mark> syllabus.</h2>
    <p>Short narrated study videos written for your course, level and exam. Free to start.</p>
    <a class="btn primary" href="${e(home)}">Get lessons for your own syllabus</a>
  </section>
</main>
<script type="module" src="/watch.js"></script>`;
  return shell({ title, description, image, url, body, ref });
}

/** The small branded 404 for a missing or not-yet-ready video. */
export function notFoundPage({ url, ref = null }) {
  const home = ref ? `/?ref=${ref}` : '/';
  const body = `${brand(home)}
<main class="watch">
  <h1 class="title">This lesson isn't here.</h1>
  <p class="hook">It may still be in the making, or the link is incomplete. StudyGraph lessons are made while students scroll, so there is always a fresh one waiting.</p>
  <section class="cta">
    <a class="btn primary" href="${escapeHtml(home)}">Get lessons for your own syllabus</a>
  </section>
</main>`;
  return shell({ title: 'Lesson not found', description: 'This StudyGraph lesson is not available.', image: FALLBACK_IMAGE, url, body, noindex: true, ref });
}
