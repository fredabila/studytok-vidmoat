#!/usr/bin/env node
// Checks every community pack under content/ (see content/README.md): the pack.md format and
// rules, and the asset files (names, sizes, measured dimensions and durations against the
// Assets table). Exits 1 with a list of problems. Runs on every pull request.
//
//   npm run content:check            all packs
//   npm run content:check -- my-pack one pack

import { readdirSync, readFileSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, parsePack, LIMITS, ASSET_NAME } from '../server/curriculum/packs.js';

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const problems = [];
const bad = (slug, msg) => problems.push(`${slug}: ${msg}`);

// ---- measuring files without any dependency ---------------------------------------------------
function head(file, n) { const fd = openSync(file, 'r'); try { const b = Buffer.alloc(n); const got = readSync(fd, b, 0, n, 0); return b.subarray(0, got); } finally { closeSync(fd); } }
function imageDims(file) {
  const b = head(file, 64 * 1024);
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), type: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8) { // JPEG: walk the markers to the first SOF
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), type: 'jpg' };
      i += 2 + len;
    }
    return null;
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), type: 'webp' };
    if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff), type: 'webp' }; }
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, type: 'webp' };
  }
  return null;
}
/** MP4: duration from mvhd, size from the first video tkhd; codecs from the sample descriptions. */
function mp4Info(file) {
  const buf = readFileSync(file);
  const out = { duration: null, width: null, height: null, codecs: [] };
  const walk = (start, end) => {
    let i = start;
    while (i + 8 <= end) {
      let size = buf.readUInt32BE(i); const type = buf.toString('ascii', i + 4, i + 8); let hdr = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(i + 8)); hdr = 16; } else if (size === 0) size = end - i;
      if (size < 8) break;
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) walk(i + hdr, i + size);
      else if (type === 'mvhd') { const v = buf[i + hdr]; const ts = v === 1 ? buf.readUInt32BE(i + hdr + 20) : buf.readUInt32BE(i + hdr + 12); const d = v === 1 ? Number(buf.readBigUInt64BE(i + hdr + 24)) : buf.readUInt32BE(i + hdr + 16); if (ts) out.duration = d / ts; }
      else if (type === 'tkhd') { const v = buf[i + hdr]; const o = i + hdr + (v === 1 ? 88 : 76); const w = buf.readUInt32BE(o) / 65536, h = buf.readUInt32BE(o + 4) / 65536; if (w && h && !out.width) { out.width = Math.round(w); out.height = Math.round(h); } }
      else if (type === 'stsd') { const n = buf.readUInt32BE(i + hdr + 4); let o = i + hdr + 8; for (let k = 0; k < n && o + 8 <= i + size; k++) { const es = buf.readUInt32BE(o); out.codecs.push(buf.toString('ascii', o + 4, o + 8)); o += es || 8; } }
      i += size;
    }
  };
  walk(0, buf.length);
  return out;
}
/** MP3: duration estimated from the first frame's bitrate (CBR) or by walking frames (VBR, capped). */
function mp3Duration(file) {
  const buf = readFileSync(file);
  let i = 0;
  if (buf.toString('ascii', 0, 3) === 'ID3') i = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  const RATES = { 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
  const SAMPLES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let frames = 0, seconds = 0;
  while (i + 4 <= buf.length && frames < 200000) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3, br = buf[i + 2] >> 4, sr = (buf[i + 2] >> 2) & 3, pad = (buf[i + 2] >> 1) & 1;
    if (layer !== 1 || br === 0 || br === 15 || sr === 3 || ver === 1) { i++; continue; }
    const table = ver === 3 ? RATES[3] : RATES[2]; const kbps = table[br]; const rate = SAMPLES[ver === 3 ? 3 : ver === 2 ? 2 : 0][sr];
    const spf = ver === 3 ? 1152 : 576;
    const len = Math.floor((spf / 8) * kbps * 1000 / rate) + pad;
    if (len < 24) { i++; continue; }
    frames++; seconds += spf / rate; i += len;
  }
  return frames ? seconds : null;
}

// ---- the checks ----------------------------------------------------------------------------------
const slugs = readdirSync(CONTENT_DIR).filter((s) => !s.startsWith('_') && !s.startsWith('.') && s.toUpperCase() !== s && statSync(join(CONTENT_DIR, s)).isDirectory());
let checked = 0;
for (const slug of slugs) {
  if (only.length && !only.includes(slug)) continue;
  checked++;
  const dir = join(CONTENT_DIR, slug);
  const entries = readdirSync(dir);
  for (const e of entries) if (!['pack.md', 'assets'].includes(e)) bad(slug, `unexpected file or folder "${e}" (only pack.md and assets/)`);
  const file = join(dir, 'pack.md');
  if (!existsSync(file)) { bad(slug, 'no pack.md'); continue; }
  const text = readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) > 60 * 1024) bad(slug, 'pack.md is over 60 KB');
  const { draft, problems: ps } = parsePack(slug, text);
  ps.forEach((p) => bad(slug, p));
  const assets = draft?.assets || [];
  const assetDir = join(dir, 'assets');
  const files = existsSync(assetDir) ? readdirSync(assetDir) : [];
  for (const f of files) {
    if (!ASSET_NAME.test(f)) bad(slug, `assets/${f}: file names are lower-case letters, digits and dashes with .jpg/.png/.webp/.mp4/.mp3`);
    else if (!assets.some((a) => a.file === f)) bad(slug, `assets/${f} is not listed in the Assets table`);
  }
  for (const a of assets) {
    const path = join(assetDir, a.file || '');
    if (!a.file || !files.includes(a.file)) { bad(slug, `asset "${a.file}" is listed but assets/${a.file} does not exist`); continue; }
    const bytes = statSync(path).size;
    if (a.kind === 'image') {
      if (bytes > LIMITS.image.bytes) bad(slug, `assets/${a.file}: ${(bytes / 1048576).toFixed(1)} MB, images are at most 2 MB`);
      const d = imageDims(path);
      if (!d) bad(slug, `assets/${a.file}: not a readable JPEG, PNG or WebP`);
      else {
        if (d.width !== a.width || d.height !== a.height) bad(slug, `assets/${a.file}: the file is ${d.width}x${d.height}, the table says ${a.width}x${a.height}`);
        if (Math.min(d.width, d.height) < LIMITS.image.minShort) bad(slug, `assets/${a.file}: the short side must be at least ${LIMITS.image.minShort} px`);
        if (Math.max(d.width, d.height) > LIMITS.image.maxLong) bad(slug, `assets/${a.file}: the long side must be at most ${LIMITS.image.maxLong} px`);
        const ext = a.file.split('.').pop().replace('jpeg', 'jpg');
        if (d.type !== ext) bad(slug, `assets/${a.file}: the file is a ${d.type.toUpperCase()}, not .${ext}`);
      }
    } else if (a.kind === 'video') {
      if (bytes > LIMITS.video.bytes) bad(slug, `assets/${a.file}: ${(bytes / 1048576).toFixed(1)} MB, videos are at most 25 MB`);
      const info = mp4Info(path);
      if (!info.duration) bad(slug, `assets/${a.file}: not a readable MP4`);
      else {
        if (info.duration > LIMITS.video.maxSec + 0.5) bad(slug, `assets/${a.file}: ${info.duration.toFixed(1)} s, videos are at most ${LIMITS.video.maxSec} s`);
        if (Math.abs(info.duration - a.duration) > 1) bad(slug, `assets/${a.file}: the file is ${info.duration.toFixed(1)} s, the table says ${a.duration}`);
        if (info.width && (info.width !== a.width || info.height !== a.height)) bad(slug, `assets/${a.file}: the file is ${info.width}x${info.height}, the table says ${a.width}x${a.height}`);
        if (info.width && Math.min(info.width, info.height) < LIMITS.video.minShort) bad(slug, `assets/${a.file}: the short side must be at least ${LIMITS.video.minShort} px`);
        if (info.codecs.length && !info.codecs.some((c) => /avc1|avc3/.test(c))) bad(slug, `assets/${a.file}: video must be H.264 (found ${info.codecs.join(', ')})`);
        if (info.codecs.length && info.codecs.some((c) => /^(ac-3|ec-3|Opus|\.mp3)$/.test(c))) bad(slug, `assets/${a.file}: audio must be AAC (found ${info.codecs.join(', ')})`);
      }
    } else if (a.kind === 'audio') {
      if (bytes > LIMITS.audio.bytes) bad(slug, `assets/${a.file}: ${(bytes / 1048576).toFixed(1)} MB, audio is at most 5 MB`);
      const d = mp3Duration(path);
      if (!d) bad(slug, `assets/${a.file}: not a readable MP3`);
      else {
        if (d > LIMITS.audio.maxSec + 0.5) bad(slug, `assets/${a.file}: ${d.toFixed(1)} s, audio is at most ${LIMITS.audio.maxSec} s`);
        if (Math.abs(d - a.duration) > 1.5) bad(slug, `assets/${a.file}: the file is ${d.toFixed(1)} s, the table says ${a.duration}`);
      }
    }
  }
}

if (!checked) { console.log('No packs to check.'); process.exit(0); }
if (problems.length) {
  console.error(`✖ ${problems.length} problem${problems.length > 1 ? 's' : ''} in ${checked} pack${checked > 1 ? 's' : ''}:\n`);
  for (const p of problems) console.error('  - ' + p);
  console.error('\nSee content/README.md for the format and the rules.');
  process.exit(1);
}
console.log(`✓ ${checked} pack${checked > 1 ? 's' : ''} ok`);
