// Teaching visuals: turns a beat's visual spec into Vidmoat clips (addHtmlElement /
// addMotionComponent). HTML must be self-contained: CSS, unicode and inline SVG work; scripts
// and external resources do not. Positions are offsets from the canvas centre.

export const CARD = { w: 960, h: 780, y: -90 };
const FONT = "'Montserrat', 'Inter', sans-serif";

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = (n) => Math.round(n * 100) / 100;

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

const cardCss = (accent, extra = '') => `
.c{box-sizing:border-box;width:${CARD.w}px;height:${CARD.h}px;padding:56px 60px;border-radius:52px;
background:linear-gradient(160deg,rgba(255,255,255,.13),rgba(255,255,255,.04));border:3px solid ${accent}55;
font-family:${FONT};color:#fff;display:flex;flex-direction:column;justify-content:center;gap:28px;
box-shadow:0 30px 80px rgba(0,0,0,.45)}
.h{font-size:44px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:${accent}}
${extra}`;

function html(id, start, duration, track, html, css, { y = CARD.y, w = CARD.w, h = CARD.h, motion } = {}) {
  const cmds = [{ op: 'addHtmlElement', clipId: id, start: round(start), duration: round(duration), trackIndex: track, width: w, height: h, html, css, patch: { y } }];
  if (motion) cmds.push({ op: 'applyMotionPreset', clipId: id, preset: motion });
  return cmds;
}

/** Progressive reveal: one clip per stage, stage k highlights items 0..k. */
function staged(id, start, duration, track, n, render, css) {
  const cmds = [];
  const span = duration * 0.75;
  for (let k = 0; k < n; k++) {
    const s = start + (k === 0 ? 0 : 0.35 + (span * k) / n);
    const e = k === n - 1 ? start + duration : start + 0.35 + (span * (k + 1)) / n;
    cmds.push(...html(`${id}s${k}`, s, e - s, track, render(k), css, { motion: k === 0 ? 'slide-up' : undefined }));
  }
  return cmds;
}

/**
 * @returns {object[]} commands for one beat's teaching visual, or [] when the kind is media-based.
 */
export function teachingVisual(v, { id, start, duration, track, accent }) {
  const items = v.items || [];
  switch (v.kind) {
    case 'diagram': {
      const svg = sanitizeSvg(v.svg);
      if (!svg) return [];
      return html(id, start, duration, track,
        `<div class="c d">${svg}</div>`,
        cardCss(accent, `.d{align-items:center;justify-content:center;padding:14px}.d svg{width:100%;height:100%}.d text{font-family:${FONT}}`),
        { motion: 'zoom-in' });
    }
    case 'stat': {
      const n = Math.round(v.value);
      const suffix = (v.unit || '').trim();
      if (Number.isInteger(v.value) && n >= 0 && n <= 999_999 && suffix.length <= 2) {
        return [
          { op: 'addMotionComponent', clipId: id, component: 'stat-counter', start: round(start), duration: round(duration), trackIndex: track,
            props: { value: n, suffix, title: (v.title || '').slice(0, 60), accent, reveal: Math.min(1.5, duration / 2) } },
          { op: 'updateClip', clipId: id, patch: { y: CARD.y, scale: 1.25 } },
        ];
      }
      return html(id, start, duration, track,
        `<div class="c s"><div class="n">${esc(v.value.toLocaleString('en-US'))}<span>${esc(v.unit.startsWith(' ') || v.unit.length <= 2 ? v.unit : ` ${v.unit}`)}</span></div><div class="l">${esc(v.title)}</div></div>`,
        cardCss(accent, `.s{align-items:center;text-align:center}.n{font-size:170px;font-weight:900;color:${accent};line-height:1;white-space:pre}.n span{font-size:76px}.l{font-size:54px;font-weight:700;line-height:1.2}`),
        { motion: 'elastic-pop' });
    }
    case 'steps': {
      const list = items.slice(0, 5);
      return staged(id, start, duration, track, list.length, (k) =>
        `<div class="c">${v.title ? `<div class="h">${esc(v.title)}</div>` : ''}${list.map((it, i) =>
          `<div class="r${i <= k ? ' on' : ''}"><b>${i + 1}</b><span>${esc(it)}</span></div>`).join('')}</div>`,
      cardCss(accent, `.r{display:flex;align-items:center;gap:30px;font-size:46px;font-weight:700;line-height:1.15;opacity:.28}
.r.on{opacity:1}.r b{flex:none;width:84px;height:84px;border-radius:50%;background:${accent};color:#0b0b0b;display:flex;align-items:center;justify-content:center;font-size:46px}`));
    }
    case 'timeline': {
      const list = items.slice(0, 5).map((x) => { const [when, ...what] = x.split('|'); return { when: when.trim(), what: what.join('|').trim() || when.trim() }; });
      return staged(id, start, duration, track, list.length, (k) =>
        `<div class="c t">${v.title ? `<div class="h">${esc(v.title)}</div>` : ''}${list.map((it, i) =>
          `<div class="r${i <= k ? ' on' : ''}"><i></i><b>${esc(it.when)}</b><span>${esc(it.what)}</span></div>`).join('')}</div>`,
      cardCss(accent, `.t{gap:34px;position:relative}.r{display:grid;grid-template-columns:40px 210px 1fr;align-items:center;gap:20px;opacity:.28}
.r.on{opacity:1}.r i{width:30px;height:30px;border-radius:50%;background:${accent};box-shadow:0 0 0 8px ${accent}33}
.r b{font-size:46px;font-weight:900;color:${accent}}.r span{font-size:40px;font-weight:700;line-height:1.15}`));
    }
    case 'compare': {
      const [left, right] = (v.title || '|').split('|').map((x) => x.trim());
      const rows = items.slice(0, 4).map((x) => x.split('|').map((y) => y.trim()));
      return html(id, start, duration, track,
        `<div class="c k"><div class="g hd"><div>${esc(left)}</div><div>${esc(right)}</div></div>${rows.map(([a, b]) =>
          `<div class="g"><div>${esc(a)}</div><div>${esc(b || '')}</div></div>`).join('')}</div>`,
        cardCss(accent, `.k{gap:22px}.g{display:grid;grid-template-columns:1fr 1fr;gap:22px}.g div{background:rgba(255,255,255,.08);border-radius:26px;padding:24px 26px;font-size:38px;font-weight:700;line-height:1.15}
.hd div{background:${accent};color:#0b0b0b;font-size:44px;font-weight:900;text-align:center}`),
        { motion: 'slide-up' });
    }
    case 'definition':
      return html(id, start, duration, track,
        `<div class="c f"><div class="h">Definition</div><div class="w">${esc(v.title)}</div><div class="x">${esc(items[0])}</div></div>`,
        cardCss(accent, `.f{gap:36px}.w{font-size:84px;font-weight:900;color:${accent};line-height:1.05}.x{font-size:50px;font-weight:600;line-height:1.3}`),
        { motion: 'slide-up' });
    case 'equation':
      return html(id, start, duration, track,
        `<div class="c q">${items.slice(0, 3).map((l) => `<div class="e">${esc(l)}</div>`).join('')}${v.title ? `<div class="m">${esc(v.title)}</div>` : ''}</div>`,
        cardCss(accent, `.q{align-items:center;text-align:center;gap:40px}.e{font-size:72px;font-weight:800;letter-spacing:2px;font-family:'Courier New',monospace}.e:first-child{color:${accent}}.m{font-size:44px;font-weight:600;opacity:.9;line-height:1.25}`),
        { motion: 'zoom-in' });
    default:
      return [];
  }
}
