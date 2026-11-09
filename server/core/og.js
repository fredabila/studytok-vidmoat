// Per-lesson share images (GET /og/v/:id.png): a 1200×630 card with the lesson's title, hook,
// unit and topic in StudyGraph's look, plus the lesson's poster when it has one. Link previews
// (WhatsApp, X, iMessage, Slack, Google) show this instead of a bare stock thumbnail.
//
// Rendered with satori (layout → SVG) and resvg (SVG → PNG). Fonts ship with the repo
// (server/assets/fonts, SIL OFL), so rendering never fetches a font. The poster is fetched with
// a short timeout and a size cap and left out on any failure, so a card always renders.

import { readFile } from 'node:fs/promises';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { TOPIC_BY_ID } from '../curriculum/topics.js';
import { format as formatOf } from '../video/formats.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const POSTER_MAX_BYTES = 4 * 1024 * 1024;

const font = (file) => readFile(new URL(`../assets/fonts/${file}`, import.meta.url));
let fontsPromise = null;
function fonts() {
  fontsPromise ||= Promise.all([
    ['Fraunces', 600, 'fraunces-latin-600-normal.woff'], ['Fraunces Ext', 600, 'fraunces-latin-ext-600-normal.woff'],
    ['Inter', 500, 'inter-latin-500-normal.woff'], ['Inter Ext', 500, 'inter-latin-ext-500-normal.woff'],
    ['Inter', 600, 'inter-latin-600-normal.woff'], ['Inter Ext', 600, 'inter-latin-ext-600-normal.woff'],
    ['JetBrains Mono', 600, 'jetbrains-mono-latin-600-normal.woff'],
  ].map(async ([name, weight, file]) => ({ name, weight, style: 'normal', data: await font(file) })))
    .catch((err) => { fontsPromise = null; throw err; });
  return fontsPromise;
}

/** Shortens text to at most n characters, on a word boundary, with an ellipsis. */
export function clip(text, n) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > n * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}

/** Title size steps down as titles get longer, so every title fits in three lines. */
export function titleSize(title, narrow) {
  const n = title.length;
  if (narrow) return n <= 28 ? 72 : n <= 48 ? 60 : n <= 72 ? 50 : 44;
  return n <= 34 ? 84 : n <= 60 ? 70 : n <= 90 ? 58 : 50;
}

/** The poster as a data URI (https only, JPEG/PNG only, size-capped), or null. */
export async function posterData(poster, { fetchImpl = fetch, timeoutMs = 3500 } = {}) {
  let u;
  try { u = new URL(String(poster || '')); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  try {
    const res = await fetchImpl(u.href, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'image/jpeg,image/png' } });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!['image/jpeg', 'image/png'].includes(type)) return null;
    if (Number(res.headers.get('content-length')) > POSTER_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > POSTER_MAX_BYTES || !buf.length) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

// Satori uses one file per family name, so each subset is its own family and every text
// style lists them as fallbacks (Twi letters such as ɛ and ɔ live in the latin-ext subsets).
const SERIF = 'Fraunces, Fraunces Ext, Inter Ext';
const SANS = 'Inter, Inter Ext';
const MONO = 'JetBrains Mono, Inter Ext';

// Tiny element helper for satori's React-like tree (no JSX build step).
const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c != null && c !== false) } });
const img = (src, style) => ({ type: 'img', props: { src, style } });

/** The card's element tree. Exported for tests. */
export function cardTree(v, { poster = null, site = 'study-graph.com' } = {}) {
  const look = TOPIC_BY_ID[v.topic] || TOPIC_BY_ID.biology;
  const f = formatOf(v.format);
  const title = clip(v.lesson?.title || v.unitTitle || 'A StudyGraph lesson', 96);
  const hook = clip(v.lesson?.hook || v.lesson?.takeaway || '', poster ? 110 : 150);
  const narrow = Boolean(poster);
  const minutes = v.duration ? `${Math.max(1, Math.round(v.duration))}s` : null;
  const ink = '#141414', ink3 = '#6f6a62', paper = '#f6f1e7', hl = '#ffd93d';
  const accent = /^#[0-9a-f]{6}$/i.test(look.accent || '') ? look.accent : hl;

  const kicker = h('div', { alignItems: 'center', gap: 14, fontFamily: MONO, fontSize: 22, color: ink3, letterSpacing: 1 },
    h('div', { width: 16, height: 16, borderRadius: 8, background: accent }),
    `${look.label}${v.unitTitle ? ` · ${clip(v.unitTitle, narrow ? 34 : 54)}` : ''}`.toUpperCase());
  const titleEl = h('div', { fontFamily: SERIF, fontSize: titleSize(title, narrow), lineHeight: 1.05, color: ink, letterSpacing: -1, marginTop: 26 }, title);
  const hookEl = hook ? h('div', { fontFamily: SANS, fontWeight: 500, fontSize: 28, lineHeight: 1.3, color: '#3d3a35', marginTop: 22 }, hook) : null;
  const foot = h('div', { alignItems: 'center', justifyContent: 'space-between', width: '100%' },
    h('div', { alignItems: 'center', gap: 14 },
      h('div', { fontFamily: SANS, fontWeight: 600, fontSize: 30, color: ink, background: hl, padding: '4px 12px' }, 'StudyGraph'),
      h('div', { fontFamily: MONO, fontSize: 22, color: ink3 }, site)),
    h('div', { fontFamily: SANS, fontWeight: 600, fontSize: 22, color: ink, border: `2px solid ${ink}`, borderRadius: 999, padding: '6px 16px' },
      [f.tag || f.name, minutes].filter(Boolean).join(' · ')));

  const text = h('div', { flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1, flexShrink: 1, height: '100%' },
    h('div', { flexDirection: 'column' }, kicker, titleEl, hookEl), foot);
  const art = poster
    ? h('div', { width: 380, height: 486, flexShrink: 0, marginLeft: 56, border: `3px solid ${ink}`, borderRadius: 24, overflow: 'hidden', background: ink },
      img(poster, { width: 380, height: 486, objectFit: 'cover' }))
    : null;
  return h('div', { width: OG_WIDTH, height: OG_HEIGHT, background: paper, padding: '72px 80px', alignItems: 'center',
    borderTop: `14px solid ${accent}` }, text, art);
}

/** PNG bytes of the lesson's share card. */
export async function lessonCard(v, { fetchImpl = fetch, site } = {}) {
  const poster = await posterData(v.poster, { fetchImpl });
  const svg = await satori(cardTree(v, { poster, site }), { width: OG_WIDTH, height: OG_HEIGHT, fonts: await fonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH }, font: { loadSystemFonts: false } }).render().asPng();
}
