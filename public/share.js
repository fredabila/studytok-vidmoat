// Shareable cards: a 1080×1920 PNG drawn on a canvas (paper, highlighter, Noti, stat tiles, the
// student's member number and the URL) for the weekly recap, a level-up and the profile card,
// shared through the phone's share sheet (Web Share API with files) or saved as an image.

const W = 1080, H = 1920;
const PAPER = '#f6f1e7', INK = '#141414', INK2 = '#3d3a35', INK3 = '#6f6a62', HL = '#ffd93d', LINE = '#bfb4a0';

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/); const lines = []; let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}
function svgImage(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img); img.onerror = reject;
    let markup = svg.replace(/var\(--serif\)/g, 'Georgia, serif');
    if (!/xmlns=/.test(markup)) markup = markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}
async function fonts() {
  try { await Promise.all([document.fonts.load('600 90px Fraunces'), document.fonts.load('700 40px Inter'), document.fonts.load('500 32px Inter'), document.fonts.load('600 30px "JetBrains Mono"')]); } catch { /* fall back to system fonts */ }
}

/**
 * @param {object} card
 *   kind      'recap' | 'levelup' | 'profile'
 *   kicker    small mono label on top (e.g. "MY WEEK WITH NOTI")
 *   title     big serif headline; `mark` is the phrase inside it to highlight
 *   subtitle  one line under the title
 *   stats     [{ value, label }] up to 4
 *   line      Noti's sentence (speech bubble)
 *   mascot    SVG markup of the mascot
 *   memberNo  the student's member number
 *   accent    sticker colour
 * @returns {Promise<Blob>} PNG
 */
export async function renderCard(card) {
  await fonts();
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // paper with a dotted grid
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,.10)';
  for (let y = 40; y < H; y += 44) for (let x = 40; x < W; x += 44) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
  // warm glow top-right
  const glow = ctx.createRadialGradient(W, 0, 0, W, 0, 900); glow.addColorStop(0, 'rgba(255,229,128,.9)'); glow.addColorStop(1, 'rgba(255,229,128,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  // brand
  rrect(ctx, 72, 84, 76, 76, 22); ctx.fillStyle = HL; ctx.fill(); ctx.translate(6, 6); ctx.fillStyle = INK; rrect(ctx, 72, 84, 76, 76, 22); ctx.fill(); ctx.translate(-6, -6);
  ctx.fillStyle = HL; ctx.beginPath(); ctx.moveTo(100, 102); ctx.lineTo(136, 122); ctx.lineTo(100, 142); ctx.closePath(); ctx.fill();
  ctx.fillStyle = INK; ctx.font = '700 54px Fraunces, Georgia, serif'; ctx.textBaseline = 'middle'; ctx.fillText('StudyGraph', 170, 124);
  ctx.font = '600 26px "JetBrains Mono", monospace'; ctx.fillStyle = INK3; ctx.textAlign = 'right'; ctx.fillText('study-graph.com', W - 72, 124); ctx.textAlign = 'left';

  // kicker + title with a highlighter mark
  let y = 300;
  ctx.font = '600 28px "JetBrains Mono", monospace'; ctx.fillStyle = INK3; ctx.fillText(String(card.kicker || '').toUpperCase(), 72, y); y += 60;
  ctx.font = '600 96px Fraunces, Georgia, serif'; ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic';
  const lines = wrap(ctx, card.title, W - 144);
  for (const ln of lines) {
    y += 96;
    if (card.mark && ln.includes(card.mark)) {
      const before = ln.slice(0, ln.indexOf(card.mark));
      const x0 = 72 + ctx.measureText(before).width, w = ctx.measureText(card.mark).width;
      ctx.fillStyle = HL; ctx.fillRect(x0 - 6, y - 66, w + 12, 78); ctx.fillStyle = INK;
    }
    ctx.fillText(ln, 72, y);
  }
  y += 24;
  if (card.subtitle) {
    y += 44; ctx.font = '500 36px Inter, sans-serif'; ctx.fillStyle = INK2;
    let sub = String(card.subtitle); while (ctx.measureText(sub).width > W - 144 && sub.length > 8) sub = `${sub.slice(0, -2).trim()}…`;
    ctx.fillText(sub, 72, y);
  }

  // mascot + bubble
  y += 70;
  try { const img = await svgImage(card.mascot); ctx.drawImage(img, 60, y, 300, 300); } catch { /* no mascot */ }
  if (card.line) {
    ctx.font = '500 36px Inter, sans-serif';
    const bl = wrap(ctx, card.line, W - 72 - 400 - 60);
    const bh = bl.length * 48 + 52;
    rrect(ctx, 400, y + 60, W - 72 - 400, bh, 28); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(402, y + 110); ctx.lineTo(372, y + 128); ctx.lineTo(402, y + 146); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic';
    bl.forEach((ln, i) => ctx.fillText(ln, 430, y + 60 + 60 + i * 48));
  }
  y += 360;

  // stat tiles
  const stats = (card.stats || []).slice(0, 4);
  if (stats.length) {
    const gap = 24, tw = (W - 144 - gap * (stats.length - 1)) / stats.length, th = 230;
    stats.forEach((s, i) => {
      const x = 72 + i * (tw + gap);
      rrect(ctx, x, y, tw, th, 32); ctx.fillStyle = s.hl ? HL : '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = s.hl ? INK : LINE; ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = INK;
      ctx.font = '600 84px Fraunces, Georgia, serif'; ctx.fillText(String(s.value), x + tw / 2, y + 125);
      ctx.font = '600 24px "JetBrains Mono", monospace'; ctx.fillStyle = INK3; ctx.fillText(String(s.label).toUpperCase(), x + tw / 2, y + 185);
      ctx.textAlign = 'left';
    });
    y += th + 60;
  }

  // member sticker
  if (card.memberNo) {
    ctx.save(); ctx.translate(W - 200, 300); ctx.rotate(0.14);
    rrect(ctx, -120, -70, 240, 140, 36); ctx.fillStyle = card.accent || HL; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.font = '700 70px Fraunces, Georgia, serif'; ctx.fillText(`#${card.memberNo}`, 0, 8);
    ctx.font = '600 22px "JetBrains Mono", monospace'; ctx.fillText('MEMBER', 0, 48); ctx.restore(); ctx.textAlign = 'left';
  }

  // chips (topics, formats…) and a big faint wordmark as decoration
  const chips = (card.chips || []).slice(0, 6);
  if (chips.length) {
    ctx.font = '600 24px "JetBrains Mono", monospace'; ctx.fillStyle = INK3;
    ctx.fillText(String(card.chipsLabel || 'THIS WEEK').toUpperCase(), 72, y + 10); y += 40;
    let x = 72; ctx.font = '600 30px Inter, sans-serif';
    for (const ch of chips) {
      const w = ctx.measureText(ch).width + 44;
      if (x + w > W - 72) { x = 72; y += 70; }
      rrect(ctx, x, y, w, 56, 28); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
      ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.fillText(ch, x + 22, y + 29); ctx.textBaseline = 'alphabetic';
      x += w + 14;
    }
    y += 90;
  }
  ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = INK; ctx.font = '700 260px Fraunces, Georgia, serif'; ctx.textAlign = 'right'; ctx.fillText('StudyGraph', W + 20, H - 230); ctx.restore(); ctx.textAlign = 'left';
  // Noti, big, bottom right
  try { const img = await svgImage(card.mascot); ctx.save(); ctx.translate(W - 250, H - 520); ctx.rotate(-0.12); ctx.drawImage(img, -170, -170, 340, 340); ctx.restore(); } catch { /* no mascot */ }

  // footer
  ctx.fillStyle = INK3; ctx.font = '500 30px Inter, sans-serif';
  ctx.fillText('Short study videos made for your syllabus. Free to start.', 72, H - 150);
  ctx.font = '600 26px "JetBrains Mono", monospace'; ctx.fillText('Built by Vidmoat · a Buzz Innovations Ltd. company', 72, H - 100);

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

/** Shares the card through the share sheet, else saves it and copies the text. Returns how it went. */
export async function shareCard(blob, { text, filename = 'studygraph-card.png' } = {}) {
  const file = new File([blob], filename, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return 'shared'; }
  } catch (err) { if (err?.name === 'AbortError') return 'cancelled'; }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  try { await navigator.clipboard.writeText(text); } catch { /* fine */ }
  return 'saved';
}
