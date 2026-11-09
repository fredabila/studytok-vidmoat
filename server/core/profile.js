// Public course profile pages (GET /@handle): the course's name, handle, followers and lessons
// as a grid, for anyone with the link and for search engines. Like the lesson pages
// (core/watch.js) it is a template string with every value escaped, no inline scripts and no
// inline styles (CSP); /profile.js wires the share button.

import { escapeHtml, shell, brand, SITE_NAME, SITE_URL } from './watch.js';

const count = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n || 0));
const secs = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s || 0)} s`);

/**
 * @param ch       publicChannel(…, { withUnits: true })
 * @param lessons  [{ id, title, poster, duration, format, unit }] newest first
 */
export function profilePage(ch, lessons, { url, site = SITE_URL, image }) {
  const e = escapeHtml;
  const title = `${ch.name} (@${ch.handle})`;
  const description = clipText(ch.bio || `${ch.name}: short narrated study lessons on ${SITE_NAME}.`, 180)
    + ` ${count(ch.lessons)} lessons · ${count(ch.followers)} followers.`;
  const kicker = [ch.topic ? `${ch.topic.emoji} ${ch.topic.label}` : null, ch.level?.label, ch.official ? 'Official course' : ch.kind === 'pack' ? 'Community pack' : 'Student-made course'].filter(Boolean).join(' · ');
  const grid = lessons.length
    ? `<ul class="grid">${lessons.map((l) => `<li><a class="tile" href="/v/${e(l.id)}">
      ${l.poster ? `<img src="${e(l.poster)}" alt="" loading="lazy" decoding="async">` : '<span class="tile-blank" aria-hidden="true"></span>'}
      <span class="tile-meta"><span class="tile-title">${e(l.title || l.unit || 'Lesson')}</span><span class="tile-len mono">${e([l.format, l.duration ? secs(l.duration) : null].filter(Boolean).join(' · '))}</span></span>
    </a></li>`).join('\n    ')}</ul>`
    : '<p class="empty">The first lessons for this course are being made. Follow it and they will come to your feed.</p>';
  const units = (ch.units || []).length
    ? `<section class="syllabus" aria-labelledby="syl-h"><h2 class="serif" id="syl-h">What it covers</h2><ol>${ch.units.map((u) => `<li><strong>${e(u.title)}</strong>${u.summary ? ` <span>${e(u.summary)}</span>` : ''}</li>`).join('')}</ol></section>`
    : '';
  const body = `${brand('/')}
<main class="watch profile" data-handle="${e(ch.handle)}">
  <header class="p-head">
    <div class="p-avatar" aria-hidden="true">${e(ch.topic?.emoji || '📚')}</div>
    <h1 class="title">${e(ch.name)}</h1>
    <p class="p-handle mono">@${e(ch.handle)}</p>
    <p class="p-kicker">${e(kicker)}</p>
    <ul class="p-stats">
      <li><strong>${count(ch.lessons)}</strong> lessons</li>
      <li><strong>${count(ch.followers)}</strong> followers</li>
      ${ch.views ? `<li><strong>${count(ch.views)}</strong> profile views</li>` : ''}
    </ul>
    ${ch.bio ? `<p class="hook">${e(ch.bio)}</p>` : ''}
    ${ch.by ? `<p class="p-by">By ${e(ch.by)}</p>` : ''}
    <div class="p-actions">
      <a class="btn primary" href="/?follow=${e(ch.handle)}">Follow on StudyGraph</a>
      <button type="button" class="btn p-share" data-url="${e(url)}" data-title="${e(title)}">Share</button>
    </div>
  </header>
  <section aria-label="Lessons">${grid}</section>
  ${units}
  <section class="cta">
    <h2 class="serif">Lessons like these, for <mark>your</mark> syllabus.</h2>
    <p>Short narrated study videos written for your course, level and exam. Free to start.</p>
    <a class="btn primary" href="/?c=${e(ch.handle)}">Watch @${e(ch.handle)} in the app</a>
  </section>
</main>
<script type="module" src="/profile.js"></script>`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    '@id': `${url}#course`,
    name: ch.name,
    description: ch.bio || description,
    url,
    image,
    inLanguage: 'en',
    isAccessibleForFree: true,
    educationalLevel: ch.level?.label,
    about: ch.topic ? { '@type': 'Thing', name: ch.topic.label } : undefined,
    syllabusSections: (ch.units || []).slice(0, 40).map((u) => ({ '@type': 'Syllabus', name: u.title, description: u.summary || undefined })),
    provider: { '@type': 'Organization', '@id': `${site}/#org`, name: SITE_NAME, url: `${site}/` },
    interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/FollowAction', userInteractionCount: ch.followers },
    hasPart: lessons.slice(0, 30).map((l) => ({ '@type': 'VideoObject', name: l.title || l.unit || 'Lesson', url: `${site}/v/${l.id}`, thumbnailUrl: `${site}/og/v/${l.id}.png`, uploadDate: l.at ? new Date(l.at).toISOString() : undefined })),
  };
  return shell({ title, description, image, url, body, ld, ogType: 'profile', imageSize: [1200, 630], imageAlt: `${ch.name} on StudyGraph: ${ch.lessons} lessons` });
}

function clipText(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`;
}
