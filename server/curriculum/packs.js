// Community packs: Markdown files under content/<slug>/pack.md that anyone can submit (see
// content/README.md for the format and the rules). Each pack becomes a group of units a
// student can add to their course; lessons are written from the pack's own units and facts,
// and the pack's assets (images, clips) can appear in the videos. The pack's link and call to
// action are shown with every lesson made from it, so the author gets the promotion.
//
// This module is pure parsing and lookup: no network, no storage. It reads content/ once at
// startup (Vercel bundles the .md files via vercel.json includeFiles).

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPIC_BY_ID } from './topics.js';
import { LEVEL_BY_ID } from './levels.js';

export const CONTENT_DIR = process.env.STUDYTOK_CONTENT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../../content');
export const ASSET_BASE = (process.env.STUDYTOK_CONTENT_BASE || 'https://raw.githubusercontent.com/fredabila/studytok-vidmoat/main/content').replace(/\/$/, '');

export const PACK_KINDS = ['book', 'course', 'notes', 'project', 'creator', 'organisation', 'event', 'other'];
export const LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'];
export const ASSET_KINDS = ['image', 'video', 'audio'];
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ASSET_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(jpg|jpeg|png|webp|mp4|mp3)$/;
export const LIMITS = {
  slug: [3, 40], title: [4, 70], about: [60, 900], unitTitle: [4, 60], unitSummary: [40, 700], units: [2, 12], facts: 40, fact: [15, 200],
  quiz: 30, assets: 12, shows: [15, 160], cta: 30,
  image: { bytes: 2 * 1024 * 1024, minShort: 720, maxLong: 4000 }, video: { bytes: 25 * 1024 * 1024, maxSec: 20, minShort: 720 }, audio: { bytes: 5 * 1024 * 1024, maxSec: 30 },
};

const ok = (s, [min, max]) => typeof s === 'string' && s.length >= min && s.length <= max;

/** The minimal YAML this format uses: `key: value`, `key: [a, b]`, no nesting. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: null, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (!kv) { meta.__bad = (meta.__bad || []).concat(line); continue; }
    let v = kv[2].replace(/\s+#.*$/, '').trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, '');
    meta[kv[1]] = v;
  }
  return { meta, body: m[2] };
}

/** `## Heading` sections of the body, in order: { name, lines } with the heading lower-cased. */
export function sections(body) {
  const out = [];
  let cur = null;
  for (const raw of body.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(raw);
    if (h) { cur = { name: h[1].trim().toLowerCase().replace(/\s*\(.*\)$/, ''), lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(raw);
  }
  return out;
}
const bullets = (lines) => lines.filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);
const prose = (lines) => lines.filter((l) => !/^\s*[-*]\s+/.test(l) && !/^\s*\|/.test(l) && !/^###/.test(l)).join('\n').replace(/\n{2,}/g, '\n').trim();

/** `### Title` blocks inside the Units section: paragraph summary + optional fact bullets. */
function parseUnits(lines) {
  const units = [];
  let cur = null;
  for (const raw of lines) {
    const h = /^###\s+(.+?)\s*$/.exec(raw);
    if (h) { cur = { title: h[1].trim(), lines: [] }; units.push(cur); continue; }
    if (cur) cur.lines.push(raw);
  }
  return units.map((u) => ({ title: u.title, summary: prose(u.lines), facts: bullets(u.lines) }));
}

/** `- Q: question? | A: right | B: wrong | C: wrong` lines. The first option is the correct one. */
function parseQuiz(lines) {
  return bullets(lines).map((l) => {
    const parts = l.split('|').map((p) => p.trim());
    const q = /^Q:\s*(.+)$/i.exec(parts[0] || '')?.[1];
    const opts = parts.slice(1).map((p) => /^[A-C]:\s*(.+)$/i.exec(p)?.[1]).filter(Boolean);
    return q && opts.length === 3 ? { question: q.trim(), options: opts.map((o) => o.trim()) } : { bad: l };
  });
}

/** The Assets table: | file | kind | shows | credit | license | size | duration | */
function parseAssets(lines) {
  const rows = lines.filter((l) => /^\s*\|/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  return rows.slice(1).filter((r) => !r.every((c) => /^-*$/.test(c))).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] ?? ''; });
    const [w, h] = String(o.size || '').toLowerCase().split('x').map((n) => Number(n));
    return { file: o.file, kind: o.kind, shows: o.shows, credit: o.credit, license: o.license, width: w || null, height: h || null, duration: Number(o.duration) || null };
  });
}

/**
 * Parses one pack.md. Returns { pack, problems }: `problems` lists every rule the text breaks
 * (the validator prints them; the loader skips a pack with any). Asset files themselves are
 * checked by scripts/content-check.mjs, which has the folder.
 */
export function parsePack(slug, text) {
  const problems = [];
  const p = (msg) => problems.push(msg);
  if (!SLUG.test(slug) || !ok(slug, LIMITS.slug)) p(`folder name "${slug}" must be 3-40 lower-case letters, digits and single dashes`);
  const { meta, body } = parseFrontmatter(text);
  if (!meta) { p('missing the --- frontmatter block at the top'); return { pack: null, problems }; }
  if (meta.__bad) p(`frontmatter lines not understood: ${meta.__bad.join(' / ')}`);
  if (!ok(meta.title, LIMITS.title)) p(`title: ${LIMITS.title[0]}-${LIMITS.title[1]} characters`);
  if (!PACK_KINDS.includes(meta.kind)) p(`kind: one of ${PACK_KINDS.join(', ')}`);
  if (!TOPIC_BY_ID[meta.topic]) p(`topic: one of ${Object.keys(TOPIC_BY_ID).join(', ')}`);
  if (meta.level && !LEVEL_BY_ID[meta.level]) p(`level: one of ${Object.keys(LEVEL_BY_ID).join(', ')} (or leave it out)`);
  if (!ok(meta.by, [2, 80])) p('by: who wrote this pack (2-80 characters)');
  if (meta.link && !/^https:\/\/[^\s]+$/.test(meta.link)) p('link: an https:// URL');
  if (meta.cta && !ok(meta.cta, [2, LIMITS.cta])) p(`cta: 2-${LIMITS.cta} characters`);
  if (meta.cta && !meta.link) p('cta needs a link');
  if (!LICENSES.includes(meta.license)) p(`license: one of ${LICENSES.join(', ')} (for the text you wrote)`);
  if (meta.language && !/^[a-z]{2}(-[A-Z]{2})?$/.test(meta.language)) p('language: a code like en or fr');
  const tags = Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [];
  if (tags.length > 8 || tags.some((t) => !/^[a-z0-9-]{2,24}$/.test(t))) p('tags: up to 8, lower-case letters, digits and dashes');

  const secs = sections(body);
  const sec = (name) => secs.find((s) => s.name === name);
  const about = sec('about') ? prose(sec('about').lines) : '';
  if (!ok(about, LIMITS.about)) p(`## About: ${LIMITS.about[0]}-${LIMITS.about[1]} characters of plain text`);
  const units = sec('units') ? parseUnits(sec('units').lines) : [];
  if (units.length < LIMITS.units[0] || units.length > LIMITS.units[1]) p(`## Units: ${LIMITS.units[0]}-${LIMITS.units[1]} "### Unit title" blocks`);
  units.forEach((u, i) => {
    if (!ok(u.title, LIMITS.unitTitle)) p(`unit ${i + 1}: title ${LIMITS.unitTitle[0]}-${LIMITS.unitTitle[1]} characters`);
    if (!ok(u.summary, LIMITS.unitSummary)) p(`unit ${i + 1} "${u.title}": summary paragraph ${LIMITS.unitSummary[0]}-${LIMITS.unitSummary[1]} characters`);
    u.facts.forEach((f) => { if (!ok(f, LIMITS.fact)) p(`unit "${u.title}": fact "${f.slice(0, 30)}…" must be ${LIMITS.fact[0]}-${LIMITS.fact[1]} characters`); });
  });
  if (new Set(units.map((u) => u.title.toLowerCase())).size !== units.length) p('unit titles must be unique');
  const facts = sec('facts') ? bullets(sec('facts').lines) : [];
  if (facts.length > LIMITS.facts) p(`## Facts: at most ${LIMITS.facts} bullets`);
  facts.forEach((f) => { if (!ok(f, LIMITS.fact)) p(`fact "${f.slice(0, 30)}…" must be ${LIMITS.fact[0]}-${LIMITS.fact[1]} characters`); });
  const quizRaw = sec('quiz bank') ? parseQuiz(sec('quiz bank').lines) : [];
  quizRaw.forEach((q) => { if (q.bad) p(`quiz line not understood: "${q.bad.slice(0, 60)}" (use "- Q: …? | A: right | B: wrong | C: wrong")`); });
  const quiz = quizRaw.filter((q) => !q.bad);
  if (quiz.length > LIMITS.quiz) p(`## Quiz bank: at most ${LIMITS.quiz} questions`);
  quiz.forEach((q) => { if (q.question.length > 90 || q.options.some((o) => o.length > 32)) p(`quiz "${q.question.slice(0, 40)}": question ≤ 90 characters, options ≤ 32`); });
  const assets = sec('assets') ? parseAssets(sec('assets').lines) : [];
  if (assets.length > LIMITS.assets) p(`## Assets: at most ${LIMITS.assets} rows`);
  assets.forEach((a) => {
    if (!ASSET_NAME.test(a.file || '')) p(`asset "${a.file}": file names are lower-case letters, digits and dashes with .jpg/.png/.webp/.mp4/.mp3`);
    if (!ASSET_KINDS.includes(a.kind)) p(`asset "${a.file}": kind is image, video or audio`);
    const ext = (a.file || '').split('.').pop();
    if (a.kind === 'image' && !/^(jpg|jpeg|png|webp)$/.test(ext)) p(`asset "${a.file}": an image is .jpg, .png or .webp`);
    if (a.kind === 'video' && ext !== 'mp4') p(`asset "${a.file}": a video is .mp4`);
    if (a.kind === 'audio' && ext !== 'mp3') p(`asset "${a.file}": audio is .mp3`);
    if (!ok(a.shows, LIMITS.shows)) p(`asset "${a.file}": "shows" describes what is visible or audible (${LIMITS.shows[0]}-${LIMITS.shows[1]} characters)`);
    if (!ok(a.credit, [2, 80])) p(`asset "${a.file}": credit (who made it)`);
    if (!LICENSES.includes(a.license)) p(`asset "${a.file}": license one of ${LICENSES.join(', ')}`);
    if (a.kind !== 'audio' && !(a.width > 0 && a.height > 0)) p(`asset "${a.file}": size as WIDTHxHEIGHT`);
    if (a.kind !== 'image' && !(a.duration > 0)) p(`asset "${a.file}": duration in seconds`);
  });
  if (new Set(assets.map((a) => a.file)).size !== assets.length) p('asset file names must be unique');
  const unknown = secs.map((s) => s.name).filter((n) => !['about', 'units', 'facts', 'quiz bank', 'assets'].includes(n));
  if (unknown.length) p(`unknown sections: ${unknown.join(', ')} (use About, Units, Facts, Quiz bank, Assets)`);

  const pack = {
    slug, title: meta.title, kind: meta.kind, topic: meta.topic, level: meta.level || null, by: meta.by, link: meta.link || null, cta: meta.cta || null,
    license: meta.license, language: meta.language || 'en', tags, about,
    units: units.map((u, i) => ({ id: `pack:${slug}:${i + 1}`, title: u.title, summary: u.summary, facts: u.facts, topic: meta.topic, pack: slug, packTitle: meta.title, open: false })),
    facts, quiz,
    assets: assets.map((a) => ({ ...a, url: `${ASSET_BASE}/${slug}/assets/${a.file}` })),
  };
  return { pack: problems.length ? null : pack, problems, draft: pack };
}

/** Reads every content/<slug>/pack.md. Returns { packs, problems: { slug: [...] } }. */
export function loadPacks(dir = CONTENT_DIR) {
  const packs = [];
  const problems = {};
  if (!existsSync(dir)) return { packs, problems };
  for (const slug of readdirSync(dir).sort()) {
    if (slug.startsWith('_') || slug.startsWith('.') || slug.toUpperCase() === slug) continue; // _template, README.md
    const file = join(dir, slug, 'pack.md');
    if (!statSync(join(dir, slug)).isDirectory()) continue;
    if (!existsSync(file)) { problems[slug] = ['no pack.md in the folder']; continue; }
    const { pack, problems: ps } = parsePack(slug, readFileSync(file, 'utf8'));
    if (ps.length) problems[slug] = ps;
    if (pack) packs.push(pack);
  }
  return { packs, problems };
}

const loaded = loadPacks();
if (Object.keys(loaded.problems).length) console.warn('[packs] skipped packs with problems:', Object.keys(loaded.problems).join(', '));
export const PACKS = loaded.packs;
export const PACK_BY_SLUG = Object.fromEntries(PACKS.map((p) => [p.slug, p]));
const UNIT_BY_ID = Object.fromEntries(PACKS.flatMap((p) => p.units.map((u) => [u.id, u])));
export const packUnit = (id) => UNIT_BY_ID[id] || null;
export const isPackUnit = (id) => String(id || '').startsWith('pack:');
export const packOfUnit = (id) => (isPackUnit(id) ? PACK_BY_SLUG[String(id).split(':')[1]] || null : null);

/** What the app lists: no unit bodies. */
export const publicPack = (p) => ({ slug: p.slug, title: p.title, kind: p.kind, topic: p.topic, level: p.level, by: p.by, link: p.link, cta: p.cta, about: p.about, tags: p.tags, units: p.units.map((u) => ({ id: u.id, title: u.title })), assets: p.assets.length });
