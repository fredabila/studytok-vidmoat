// Teaching visuals and format cards: turns a beat's visual spec (or a format scene) into
// Vidmoat clips (addHtmlElement / addMotionComponent). HTML must be self-contained: CSS,
// unicode and inline SVG work; scripts and external resources do not. Positions are offsets
// from the canvas centre. Every card takes a `theme`: 'dark' (glass on footage) or 'paper'
// (a cream study card with ink text), so formats look different from each other.

export const CARD = { w: 960, h: 720, y: -130 };
const FONT = "'Montserrat', 'Inter', sans-serif";

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Keep only a self-contained SVG: no scripts, event handlers, foreign objects, embedded
 * images or external references. Returns '' when nothing safe is left.
 */
export function sanitizeSvg(svg) {
  const m = /<svg[\s\S]*<\/svg>/i.exec(String(svg || ''));
  if (!m) return '';
  let s = m[0]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|foreignObject|iframe|object|embed|audio|video|style)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|foreignObject|iframe|object|embed|image|audio|video)\b[^>]*\/?>/gi, '')
    .replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none')
    .replace(/javascript:/gi, '');
  // Force a predictable size inside the card.
  s = s.replace(/<svg\b([^>]*)>/i, (_, attrs) => {
    const cleaned = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const viewBox = /viewBox/i.test(cleaned) ? '' : ' viewBox="0 0 800 800"';
    return `<svg${cleaned}${viewBox} width="920" height="740" preserveAspectRatio="xMidYMid meet">`;
  });
  return s.length > 16000 ? '' : s;
}

// ---- Themes -----------------------------------------------------------------------------------

const THEMES = {
  dark: (accent) => ({
    bg: 'linear-gradient(160deg,rgba(255,255,255,.13),rgba(255,255,255,.04))', border: `${accent}55`, ink: '#ffffff', muted: 'rgba(255,255,255,.72)',
    cell: 'rgba(255,255,255,.08)', onAccent: '#0b0b0b', shadow: '0 30px 80px rgba(0,0,0,.45)', svgInk: '#ffffff',
  }),
  paper: (accent) => ({
    bg: 'linear-gradient(180deg,#fffdf6,#f6efdc)', border: '#d9cfae', ink: '#1d1a14', muted: '#5a5444',
    cell: 'rgba(0,0,0,.06)', onAccent: '#0b0b0b', shadow: '0 30px 70px rgba(0,0,0,.35)', svgInk: '#1d1a14',
  }),
};
const themeOf = (theme, accent) => (THEMES[theme] || THEMES.dark)(accent);

const cardCss = (accent, theme, extra = '', { w = CARD.w, h = CARD.h, pad = '56px 60px' } = {}) => {
  const t = themeOf(theme, accent);
  return `
.c{box-sizing:border-box;width:${w}px;height:${h}px;padding:${pad};border-radius:52px;
background:${t.bg};border:3px solid ${t.border};
font-family:${FONT};color:${t.ink};display:flex;flex-direction:column;justify-content:center;gap:28px;
box-shadow:${t.shadow}}
.h{font-size:44px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:${accent}}
.c .mut{color:${t.muted}}
${extra}`;
};

/**
 * A card's entrance as keyframes on its own clip. The editor's motion presets (slide-up, zoom-in,
 * elastic-pop) animate around the vertical centre, so a card placed above or below it jumped there;
 * these keep the card where it was placed. Times are relative to the clip.
 */
export function entrance(id, y, motion) {
  const kf = (prop, time, value, easing = 'easeOut') => ({ op: 'addKeyframe', clipId: id, prop, time, value, easing });
  const fade = [kf('opacity', 0, 0, 'linear'), kf('opacity', 0.22, 1, 'linear')];
  if (motion === 'elastic-pop') return [kf('scale', 0, 0.6), kf('scale', 0.18, 1.08), kf('scale', 0.32, 1), ...fade];
  if (motion === 'zoom-in') return [kf('scale', 0, 0.86), kf('scale', 0.4, 1), ...fade];
  return [kf('y', 0, y + 90), kf('y', 0.38, y), ...fade]; // slide-up
}

function html(id, start, duration, track, html, css, { y = CARD.y, w = CARD.w, h = CARD.h, motion, x } = {}) {
  const patch = { y, ...(x != null ? { x } : {}) };
  const cmds = [{ op: 'addHtmlElement', clipId: id, start: round(start), duration: round6(duration), trackIndex: track, width: w, height: h, html, css, patch }];
  if (motion) cmds.push(...entrance(id, y, motion));
  return cmds;
}

/** Progressive reveal: one clip per stage, stage k highlights items 0..k. */
function staged(id, start, duration, track, n, render, css, opts = {}) {
  const cmds = [];
  const span = duration * 0.75;
  const edge = (k) => round(k === 0 ? start : start + 0.35 + (span * k) / n);
  for (let k = 0; k < n; k++) {
    // One rounded edge shared by both stages, each ending a microsecond before the next begins: the
    // editor pushes a clip that overlaps (in floating point) up a track, over the captions.
    const s = edge(k);
    const e = k === n - 1 ? round(start + duration) : edge(k + 1);
    cmds.push(...html(`${id}s${k}`, s, e - s - 1e-6, track, render(k), css, { ...opts, motion: k === 0 ? opts.motion || 'slide-up' : undefined }));
  }
  return cmds;
}

// ---- Teaching visuals (diagram, stat, steps, timeline, compare, definition, equation) ----------

/**
 * @returns {object[]} commands for one beat's teaching visual, or [] when the kind is media-based.
 */
export function teachingVisual(v, { id, start, duration, track, accent, theme = 'dark' }) {
  const items = v.items || [];
  const t = themeOf(theme, accent);
  switch (v.kind) {
    case 'diagram': {
      const svg = sanitizeSvg(v.svg);
      if (!svg) return [];
      // Claude draws white strokes/labels for the dark theme; on paper, recolour them to ink.
      const inked = theme === 'paper' ? svg.replace(/#fff(?:fff)?\b/gi, t.svgInk).replace(/\bwhite\b/gi, t.svgInk) : svg;
      return html(id, start, duration, track,
        `<div class="c d">${inked}</div>`,
        cardCss(accent, theme, `.d{align-items:center;justify-content:center;padding:14px}.d svg{width:100%;height:100%}.d text{font-family:${FONT}}`),
        { motion: 'zoom-in' });
    }
    case 'stat': {
      const n = Math.round(v.value);
      const suffix = (v.unit || '').trim();
      if (theme === 'dark' && Number.isInteger(v.value) && n >= 0 && n <= 999_999 && suffix.length <= 2) {
        return [
          { op: 'addMotionComponent', clipId: id, component: 'stat-counter', start: round(start), duration: round6(duration), trackIndex: track,
            props: { value: n, suffix, title: (v.title || '').slice(0, 60), accent, reveal: Math.min(1.5, duration / 2) } },
          { op: 'updateClip', clipId: id, patch: { y: CARD.y, scale: 1.25 } },
        ];
      }
      return html(id, start, duration, track,
        `<div class="c s"><div class="n">${esc(v.value.toLocaleString('en-US'))}<span>${esc(v.unit.startsWith(' ') || v.unit.length <= 2 ? v.unit : ` ${v.unit}`)}</span></div><div class="l">${esc(v.title)}</div></div>`,
        cardCss(accent, theme, `.s{align-items:center;text-align:center}.n{font-size:170px;font-weight:900;color:${accent};line-height:1;white-space:pre}.n span{font-size:76px}.l{font-size:54px;font-weight:700;line-height:1.2}`),
        { motion: 'elastic-pop' });
    }
    case 'steps': {
      const list = items.slice(0, 5);
      return staged(id, start, duration, track, list.length, (k) =>
        `<div class="c">${v.title ? `<div class="h">${esc(v.title)}</div>` : ''}${list.map((it, i) =>
          `<div class="r${i <= k ? ' on' : ''}"><b>${i + 1}</b><span>${esc(it)}</span></div>`).join('')}</div>`,
      cardCss(accent, theme, `.r{display:flex;align-items:center;gap:30px;font-size:46px;font-weight:700;line-height:1.15;opacity:.28}
.r.on{opacity:1}.r b{flex:none;width:84px;height:84px;border-radius:50%;background:${accent};color:${t.onAccent};display:flex;align-items:center;justify-content:center;font-size:46px}`));
    }
    case 'timeline': {
      const list = items.slice(0, 5).map((x) => { const [when, ...what] = x.split('|'); return { when: when.trim(), what: what.join('|').trim() || when.trim() }; });
      return staged(id, start, duration, track, list.length, (k) =>
        `<div class="c t">${v.title ? `<div class="h">${esc(v.title)}</div>` : ''}${list.map((it, i) =>
          `<div class="r${i <= k ? ' on' : ''}"><i></i><b>${esc(it.when)}</b><span>${esc(it.what)}</span></div>`).join('')}</div>`,
      cardCss(accent, theme, `.t{gap:34px;position:relative}.r{display:grid;grid-template-columns:40px 210px 1fr;align-items:center;gap:20px;opacity:.28}
.r.on{opacity:1}.r i{width:30px;height:30px;border-radius:50%;background:${accent};box-shadow:0 0 0 8px ${accent}33}
.r b{font-size:46px;font-weight:900;color:${accent}}.r span{font-size:40px;font-weight:700;line-height:1.15}`));
    }
    case 'compare': {
      const [left, right] = (v.title || '|').split('|').map((x) => x.trim());
      const rows = items.slice(0, 4).map((x) => x.split('|').map((y) => y.trim()));
      return html(id, start, duration, track,
        `<div class="c k"><div class="g hd"><div>${esc(left)}</div><div>${esc(right)}</div></div>${rows.map(([a, b]) =>
          `<div class="g"><div>${esc(a)}</div><div>${esc(b || '')}</div></div>`).join('')}</div>`,
        cardCss(accent, theme, `.k{gap:22px}.g{display:grid;grid-template-columns:1fr 1fr;gap:22px}.g div{background:${t.cell};border-radius:26px;padding:24px 26px;font-size:38px;font-weight:700;line-height:1.15}
.hd div{background:${accent};color:${t.onAccent};font-size:44px;font-weight:900;text-align:center}`),
        { motion: 'slide-up' });
    }
    case 'cycle': {
      const stages = items.slice(0, 6);
      const n = stages.length, cx = 400, cy = 400, R = n >= 5 ? 300 : 250, big = n <= 4; // five or six stages: a wider ring, smaller pills
      const pos = stages.map((_, i) => { const a = -Math.PI / 2 + (i / n) * 2 * Math.PI; return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a }; });
      // Arrows run pill to pill (a gentle outward curve), leaving each pill's edge, so they stay visible however wide the labels are.
      const widths = stages.map((sName) => Math.min(big ? 300 : 250, (big ? 40 : 34) + esc(sName).length * (big ? 19 : 15)));
      const exitDist = (w, dx, dy, padX, padY) => Math.min(dx ? (w / 2 + padX) / Math.abs(dx) : 1e9, dy ? (40 + padY) / Math.abs(dy) : 1e9);
      const arcs = pos.map((p, i) => {
        const j = (i + 1) % n, q = pos[j];
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1, dx = (q.x - p.x) / len, dy = (q.y - p.y) / len;
        const from = exitDist(widths[i], dx, dy, 10, 10), to = exitDist(widths[j], dx, dy, 22, 22);
        if (len - from - to < 24) return '';
        const x1 = p.x + dx * from, y1 = p.y + dy * from, x2 = q.x - dx * to, y2 = q.y - dy * to;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, ox = mx - cx, oy = my - cy, ol = Math.hypot(ox, oy) || 1;
        const bend = 0.22 * (len - from - to);
        return `<path d="M${x1.toFixed(0)} ${y1.toFixed(0)} Q${(mx + (ox / ol) * bend).toFixed(0)} ${(my + (oy / ol) * bend).toFixed(0)} ${x2.toFixed(0)} ${y2.toFixed(0)}" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round" marker-end="url(#ah)"/>`;
      }).join('');
      const nodes = pos.map((p, i) => { const label = esc(stages[i]); const w = widths[i]; return `<g><rect x="${(p.x - w / 2).toFixed(0)}" y="${(p.y - (big ? 40 : 34)).toFixed(0)}" width="${w}" height="${big ? 80 : 68}" rx="40" fill="${i === 0 ? accent : t.cell}" stroke="${t.border}" stroke-width="3"/><text x="${p.x.toFixed(0)}" y="${(p.y + (big ? 13 : 11)).toFixed(0)}" text-anchor="middle" font-size="${big ? (label.length > 14 ? 30 : 36) : (label.length > 14 ? 25 : 29)}" font-weight="800" fill="${i === 0 ? t.onAccent : t.ink}">${label}</text></g>`; }).join('');
      return html(id, start, duration, track,
        `<div class="c y">${v.title ? `<div class="h">${esc(v.title)}</div>` : ''}<svg viewBox="0 0 800 800"><defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0 0L4 2L0 4z" fill="${accent}"/></marker></defs>${arcs}${nodes}</svg></div>`,
        cardCss(accent, theme, `.y{align-items:center;gap:10px}.y svg{width:${v.title ? 540 : 600}px;height:${v.title ? 540 : 600}px;font-family:${FONT}}`),
        { motion: 'zoom-in' });
    }
    case 'bars': {
      const rows = items.slice(0, 5).map((x) => { const [label, num] = x.split('|'); return { label: label.trim(), value: Number(String(num || '').replace(/[^\d.-]/g, '')) || 0 }; });
      const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
      return staged(id, start, duration, track, rows.length, (k) =>
        `<div class="c b">${v.title ? `<div class="h">${esc(v.title)}</div>` : ''}${rows.map((r, i) =>
          `<div class="r${i <= k ? ' on' : ''}"><span class="l">${esc(r.label)}</span><span class="bar"><i style="width:${Math.max(4, Math.round((Math.abs(r.value) / max) * 100))}%"></i></span><b>${esc(r.value.toLocaleString('en-US'))}</b></div>`).join('')}</div>`,
      cardCss(accent, theme, `.b{gap:22px}.r{display:grid;grid-template-columns:230px 1fr 150px;align-items:center;gap:18px;opacity:.28}.r.on{opacity:1}
.r .l{font-size:34px;font-weight:700;line-height:1.1}.r .bar{height:44px;border-radius:22px;background:${t.cell};overflow:hidden}.r .bar i{display:block;height:100%;border-radius:22px;background:${accent}}
.r b{font-size:40px;font-weight:900;color:${accent};text-align:right}`));
    }
    case 'definition':
      return html(id, start, duration, track,
        `<div class="c f"><div class="h">Definition</div><div class="w">${esc(v.title)}</div><div class="x">${esc(items[0])}</div></div>`,
        cardCss(accent, theme, `.f{gap:30px}.w{font-size:${v.title.length > 22 ? 64 : 80}px;font-weight:900;color:${accent};line-height:1.05}.x{font-size:${(items[0] || '').length > 100 ? 40 : 48}px;font-weight:600;line-height:1.3}`),
        { motion: 'slide-up' });
    case 'equation':
      return html(id, start, duration, track,
        `<div class="c q">${items.slice(0, 3).map((l) => `<div class="e">${esc(l)}</div>`).join('')}${v.title ? `<div class="m">${esc(v.title)}</div>` : ''}</div>`,
        cardCss(accent, theme, `.q{align-items:center;text-align:center;gap:40px}.e{font-size:72px;font-weight:800;letter-spacing:2px;font-family:'Courier New',monospace}.e:first-child{color:${accent}}.m{font-size:44px;font-weight:600;opacity:.9;line-height:1.25}`),
        { motion: 'zoom-in' });
    default:
      return [];
  }
}

// ---- Format cards -----------------------------------------------------------------------------

const ABC = 'ABC';
const fit = (s, big, small, at) => (String(s || '').length > at ? small : big);

/** Myth vs fact: a rubber-stamp label slammed over the statement. */
export function stampCard({ id, start, duration, track, accent, theme = 'dark' }, { label, text, color }) {
  return html(id, start, duration, track,
    `<div class="c st"><div class="stamp">${esc(label)}</div><div class="tx">${esc(text)}</div></div>`,
    cardCss(accent, theme, `.st{align-items:center;text-align:center;gap:46px}
.stamp{font-family:'Anton','Oswald',${FONT};font-size:150px;line-height:1;letter-spacing:6px;color:${color};border:12px solid ${color};border-radius:28px;padding:10px 44px;transform:rotate(-7deg);text-transform:uppercase;box-shadow:0 0 0 6px rgba(0,0,0,.25) inset}
.tx{font-size:${fit(text, 60, 50, 60)}px;font-weight:800;line-height:1.15}`),
    { motion: 'elastic-pop' });
}

/** Rapid fire: a slim counter bar ("03 / 05 · title") that sits above full-bleed footage. */
export function numberCard({ id, start, duration, track, accent, theme = 'dark' }, { index, total, title }) {
  const h = 230;
  return html(id, start, duration, track,
    `<div class="c nb"><div class="num">${String(index + 1).padStart(2, '0')}<span>/${String(total).padStart(2, '0')}</span></div><div class="ti">${esc(title)}</div></div>`,
    cardCss(accent, theme, `.nb{flex-direction:row;align-items:center;gap:40px;padding:28px 48px;border-radius:40px;overflow:hidden}
.num{font-family:'Bungee','Anton',${FONT};font-size:96px;line-height:1;color:${accent};white-space:nowrap;flex:none}.num span{font-size:44px;opacity:.6}
.ti{font-size:${fit(title, 58, 46, 18)}px;font-weight:900;line-height:1.05;min-width:0;overflow:hidden}`, { h, pad: '28px 48px' }),
    { y: -520, h, motion: 'slide-up' });
}

/** Recap: the list of items ticked off one by one. */
export function recapCard({ id, start, duration, track, accent, theme = 'dark' }, { items, title = 'Recap' }) {
  const t = themeOf(theme, accent);
  const list = items.slice(0, 5);
  return staged(id, start, duration, track, list.length, (k) =>
    `<div class="c"><div class="h">${esc(title)}</div>${list.map((it, i) =>
      `<div class="r${i <= k ? ' on' : ''}"><b>${i <= k ? '✓' : ''}</b><span>${esc(it)}</span></div>`).join('')}</div>`,
  cardCss(accent, theme, `.r{display:flex;align-items:center;gap:30px;font-size:48px;font-weight:800;line-height:1.15;opacity:.3}
.r.on{opacity:1}.r b{flex:none;width:76px;height:76px;border-radius:22px;border:4px solid ${accent};background:transparent;color:${t.onAccent};display:flex;align-items:center;justify-content:center;font-size:48px}
.r.on b{background:${accent}}`));
}

/** Exam drill: the question with its three options (`revealed` highlights the answer). */
export function questionCard({ id, start, duration, track, accent, theme = 'paper' }, { exam, revealed = false, label = 'Exam question' }) {
  const t = themeOf(theme, accent);
  const h = 900;
  return html(id, start, duration, track,
    `<div class="c qc"><div class="h">${esc(label)}</div><div class="q">${esc(exam.question)}</div>${exam.options.map((o, i) =>
      `<div class="o${revealed && i === exam.answerIndex ? ' ok' : ''}"><b>${ABC[i]}</b><span>${esc(o)}</span></div>`).join('')}</div>`,
    cardCss(accent, theme, `.qc{gap:26px;justify-content:flex-start}.q{font-size:${fit(exam.question, 54, 46, 80)}px;font-weight:800;line-height:1.2;margin-bottom:10px}
.o{display:flex;align-items:center;gap:26px;background:${t.cell};border-radius:28px;padding:22px 28px;font-size:42px;font-weight:700;line-height:1.1;border:3px solid transparent}
.o b{flex:none;width:72px;height:72px;border-radius:50%;border:4px solid ${accent};display:flex;align-items:center;justify-content:center;font-size:40px}
.o.ok{background:${accent};color:${t.onAccent};border-color:${accent}}.o.ok b{border-color:${t.onAccent}}`, { h }),
    { y: -80, h, motion: 'slide-up' });
}

/** Exam drill: the worked solution, one step lit at a time, under the answer line. */
/**
 * Exam drill: the worked solution, one step lit at a time, under the answer line. `mode`:
 * 'walk' (default: step `index` lit), 'all' (every step shown equally: spot the mistake), 'wrong'
 * (step `wrong` turned red).
 */
export function answerSteps({ id, start, duration, track, accent, theme = 'paper' }, { steps, index = 0, exam, mode = 'walk', wrong = -1, heading }) {
  const t = themeOf(theme, accent);
  const h = 900;
  const list = steps.slice(0, 4);
  const answer = exam?.options?.length ? `<div class="ans"><b>${ABC[exam.answerIndex]}</b><span>${esc(exam.options[exam.answerIndex])}</span></div>` : `<div class="q">${esc(exam?.question || '')}</div>`;
  const cls = (i) => (mode === 'all' ? ' on' : mode === 'wrong' ? (i === wrong ? ' bad' : ' done') : i < index ? ' done' : i === index ? ' on' : '');
  return html(id, start, duration, track,
    `<div class="c as">${answer}<div class="h">${esc(heading || (mode === 'all' ? 'One step is wrong' : mode === 'wrong' ? 'The mistake' : 'Working'))}</div>${list.map((s, i) =>
      `<div class="r${cls(i)}"><b>${mode === 'wrong' && i === wrong ? '✗' : i + 1}</b><span>${esc(s)}</span></div>`).join('')}</div>`,
    cardCss(accent, theme, `.as{gap:22px;justify-content:flex-start}
.ans{display:flex;align-items:center;gap:24px;background:${accent};color:${t.onAccent};border-radius:28px;padding:20px 28px;font-size:46px;font-weight:900;line-height:1.1;margin-bottom:8px}
.ans b{flex:none;width:72px;height:72px;border-radius:50%;background:${t.onAccent};color:${accent};display:flex;align-items:center;justify-content:center}
.q{font-size:${(exam?.question || '').length > 70 ? 40 : 48}px;font-weight:800;line-height:1.2;margin-bottom:6px}
.r{display:flex;align-items:flex-start;gap:24px;font-size:40px;font-weight:700;line-height:1.2;opacity:.3}.r.done{opacity:.7}.r.on{opacity:1}
.r b{flex:none;width:64px;height:64px;border-radius:50%;background:${t.cell};display:flex;align-items:center;justify-content:center;font-size:36px}.r.on b{background:${accent};color:${t.onAccent}}
.r.bad{opacity:1;color:#c43d33;text-decoration:line-through}.r.bad b{background:#e5484d;color:#fff;text-decoration:none}`, { h }),
    { y: -80, h, motion: index === 0 && mode === 'walk' ? 'slide-up' : mode === 'all' ? 'slide-up' : undefined });
}

/** Cheat sheet: a revision card whose lines fill in one by one; the newest line is highlighted. */
export function sheetCard({ id, start, duration, track, accent, theme = 'paper' }, { items, upTo, title = 'Cheat sheet' }) {
  const t = themeOf(theme, accent);
  const list = items.slice(0, 6);
  const h = 900;
  return html(id, start, duration, track,
    `<div class="c sh"><div class="h">${esc(title)}</div>${list.map((it, i) =>
      `<div class="r${i < upTo ? ' done' : i === upTo ? ' on' : ''}"><b>${esc(it.title)}</b><span>${esc(it.text)}</span></div>`).join('')}</div>`,
    cardCss(accent, theme, `.sh{gap:16px;justify-content:flex-start}
.r{display:grid;grid-template-columns:300px 1fr;gap:18px;align-items:start;padding:14px 16px;border-radius:18px;background:${t.cell};opacity:.18}
.r.done{opacity:.85}.r.on{opacity:1;outline:3px solid ${accent};background:${accent}22}
.r b{font-size:38px;font-weight:900;line-height:1.1;color:${accent}}.r span{font-size:32px;font-weight:600;line-height:1.25}`, { h }),
    { y: -80, h, motion: upTo === 0 ? 'slide-up' : undefined });
}

/** Tier list: rows S / A / B / C filling up as items are ranked; the newest item is highlighted. */
export function tierCard({ id, start, duration, track, accent, theme = 'dark' }, { items, latest }) {
  const t = themeOf(theme, accent);
  const colors = { S: '#ff5a5f', A: '#ff9f43', B: '#ffd93d', C: '#8fc1ff' };
  const rows = ['S', 'A', 'B', 'C'].map((tier) => {
    const here = items.filter((it) => (it.tier || 'B') === tier);
    return `<div class="row"><b style="background:${colors[tier]}">${tier}</b><div class="cells">${here.map((it) => `<span class="${it === latest ? 'new' : ''}">${esc(it.title)}</span>`).join('')}</div></div>`;
  }).join('');
  return html(id, start, duration, track,
    `<div class="c tl">${rows}</div>`,
    cardCss(accent, theme, `.tl{gap:16px;justify-content:center;padding:40px 44px}
.row{display:flex;align-items:stretch;gap:16px;min-height:118px}.row b{flex:none;width:118px;border-radius:22px;display:flex;align-items:center;justify-content:center;font-family:'Bungee','Anton',${FONT};font-size:64px;color:#0b0b0b}
.cells{flex:1;display:flex;flex-wrap:wrap;gap:12px;align-content:center;background:${t.cell};border-radius:22px;padding:12px}
.cells span{font-size:34px;font-weight:800;line-height:1.1;padding:12px 18px;border-radius:16px;background:rgba(255,255,255,.1)}.cells span.new{background:${accent};color:${t.onAccent};transform:scale(1.04)}`, { pad: '40px 44px' }),
    { motion: latest === items[0] ? 'slide-up' : undefined });
}

/** A labelled callout (common mistake, tip). */
export function calloutCard({ id, start, duration, track, accent, theme = 'dark' }, { label, text, color = accent }) {
  const h = 520;
  return html(id, start, duration, track,
    `<div class="c co"><div class="lb">${esc(label)}</div><div class="tx">${esc(text)}</div></div>`,
    cardCss(accent, theme, `.co{gap:30px;border-left:22px solid ${color}}.lb{font-size:42px;font-weight:900;letter-spacing:4px;text-transform:uppercase;color:${color}}
.tx{font-size:${fit(text, 56, 46, 70)}px;font-weight:800;line-height:1.2}`, { h }),
    { h, motion: 'slide-up' });
}

/** Flashcards: the question side (paper) or the answer side (accent). */
export function flashCard({ id, start, duration, track, accent, theme = 'paper' }, { card, index, total, side }) {
  const t = themeOf(theme, accent);
  const isA = side === 'a';
  const h = 760;
  return html(id, start, duration, track,
    `<div class="c fc${isA ? ' a' : ''}"><div class="top"><span>${isA ? 'Answer' : esc(card.label || 'Question')}</span><span>${index + 1} / ${total}</span></div><div class="tx">${esc(isA ? card.a : card.q)}</div><div class="bot">${isA ? '' : esc(card.hint ?? 'say it out loud…')}</div></div>`,
    cardCss(accent, theme, `.fc{justify-content:space-between;text-align:center;border-radius:60px}
.fc.a{background:${accent};color:${t.onAccent};border-color:${accent}}
.top,.bot{display:flex;justify-content:space-between;font-size:38px;font-weight:800;letter-spacing:3px;text-transform:uppercase;opacity:.75}.bot{justify-content:center;font-style:italic;text-transform:none;letter-spacing:0}
.tx{font-family:'Permanent Marker',${FONT};font-size:${fit(isA ? card.a : card.q, 84, 64, 40)}px;line-height:1.15}`, { h }),
    { h, motion: isA ? 'flip-in' : 'slide-up' });
}

/** Chat: a message thread; the newest bubble is highlighted. Only the last few messages fit. */
export function chatThread({ id, start, duration, track, accent, theme = 'dark' }, { contact, messages }) {
  const t = themeOf(theme, accent);
  const h = 1080;
  const shown = messages.slice(-4);
  const offset = messages.length - shown.length;
  return html(id, start, duration, track,
    `<div class="c ch"><div class="bar"><i></i><span>${esc(contact)}</span><em>online</em></div><div class="th">${shown.map((m, k) => {
      const i = offset + k, mine = i % 2 === 0;
      return `<div class="b${mine ? ' me' : ''}${k === shown.length - 1 ? ' new' : ''}">${esc(m)}</div>`;
    }).join('')}</div></div>`,
    cardCss(accent, theme, `.ch{justify-content:flex-start;gap:30px;padding:40px 44px}
.bar{display:flex;align-items:center;gap:20px;font-size:40px;font-weight:800;padding-bottom:24px;border-bottom:2px solid ${t.border}}
.bar i{width:64px;height:64px;border-radius:50%;background:${accent}}.bar em{margin-left:auto;font-style:normal;font-size:30px;color:${t.muted}}
.th{display:flex;flex-direction:column;gap:22px;justify-content:flex-end;flex:1}
.b{max-width:82%;padding:24px 30px;border-radius:34px;font-size:40px;font-weight:600;line-height:1.22;background:${t.cell};align-self:flex-start;border-bottom-left-radius:10px;opacity:.75}
.b.me{align-self:flex-end;background:${accent};color:${t.onAccent};border-bottom-left-radius:34px;border-bottom-right-radius:10px}
.b.new{opacity:1;box-shadow:0 14px 40px rgba(0,0,0,.3)}`, { h, pad: '40px 44px' }),
    { y: -60, h, motion: 'slide-up' });
}
