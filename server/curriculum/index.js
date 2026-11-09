// Resolves a student's profile to a program (an ordered list of units) and looks units up.
//   - catalog match  -> ready immediately (server/catalog.js)
//   - otherwise      -> researched with Claude + web search (server/research.js), cached under
//                       a key derived from level/country/institution/program/exam, so every
//                       student on the same course shares the research and the videos.
// Interest topics (for "just curious" learners, or extras) are open-ended units: Claude picks a
// fresh subtopic each episode.

import { createHash } from 'node:crypto';
import { packUnit, isPackUnit } from './packs.js';
import { config } from '../core/config.js';
import { kv } from '../core/kv.js';
import { CATALOG, matchProgram, normalize } from './catalog.js';
import { TOPIC_BY_ID, guessTopic } from './topics.js';
import { researchProgram } from './research.js';
import { breatherUnit } from '../feed/breathers.js';

const STALE_RESEARCH_MS = 5 * 60 * 1000;

export const interestUnit = (topicId) => {
  const t = TOPIC_BY_ID[topicId];
  return t ? { id: `topic:${t.id}`, title: t.label, summary: `Surprising, accurate ideas from ${t.label.toLowerCase()}`, topic: t.id, open: true } : null;
};

const catalogUnits = new Map(CATALOG.flatMap((p) => p.units.map((u) => [u.id, { ...u, programKey: `cat:${p.id}`, programName: p.name }])));

/** A unit by id: catalog, interest topic, custom, or researched (stored in KV). */
export async function getUnit(id) {
  if (catalogUnits.has(id)) return catalogUnits.get(id);
  if (isPackUnit(id)) return packUnit(id);
  if (id.startsWith('topic:')) return interestUnit(id.slice(6));
  if (id.startsWith('fun:')) return breatherUnit(id);
  return kv.get(`unit:${id}`);
}

/**
 * A custom topic typed by a student ("Python decorators", "The Ashanti Empire"). Open-ended:
 * Claude picks a fresh subtopic each episode. Shared by everyone who adds the same title, so
 * lessons and videos are reused. Returns null for an empty title.
 */
/** The id a custom topic title gets (the same title always gets the same id), or null. */
export function customUnitId(title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return clean.length < 2 ? null : `cu:${createHash('sha1').update(normalize(clean)).digest('hex').slice(0, 12)}`;
}

export async function customUnit(title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (clean.length < 2) return null;
  const id = customUnitId(clean);
  const existing = await kv.get(`unit:${id}`);
  if (existing) return existing;
  const unit = { id, title: clean, summary: '', topic: guessTopic(clean), open: true, custom: true, createdAt: new Date().toISOString() };
  await kv.set(`unit:${id}`, unit);
  return unit;
}

export function researchKey(profile) {
  const parts = [profile.level, profile.country, profile.institution, profile.program, profile.exam].map(normalize).join('|');
  return `res:${createHash('sha1').update(parts).digest('hex').slice(0, 16)}`;
}

function catalogProgram(p, profile) {
  return {
    key: `cat:${p.id}`, status: 'ready', source: 'catalog', name: p.name, level: profile.level,
    basis: profile.exam ? `Core ${p.name} units (lessons pitched at ${profile.exam})` : `Core ${p.name} units`,
    units: p.units.map(({ id, title, summary, topic }) => ({ id, title, summary, topic })), sources: [],
  };
}

export async function getProgram(key) {
  if (key.startsWith('cat:')) {
    const p = CATALOG.find((c) => `cat:${c.id}` === key);
    return p ? catalogProgram(p, { level: p.levels[0] }) : null;
  }
  const rec = await kv.get(`program:${key}`);
  if (rec?.status === 'researching' && Date.now() - Date.parse(rec.startedAt) > STALE_RESEARCH_MS) {
    return { ...rec, status: 'failed', error: 'Research timed out' };
  }
  return rec;
}

/**
 * @param profile { level, country, institution, program, exam }
 * @param opts.tailor  research the institution even when the catalog has a match
 * @returns {Promise<{ program: object|null, pending: Promise|null }>}  pass `pending` to waitUntil
 */
export async function resolveProgram(profile, { tailor = false } = {}) {
  if (!profile.program && !profile.institution) return { program: null, pending: null };
  const match = matchProgram(profile.program || '', profile.level);
  const wantsResearch = tailor || !match;
  if (!wantsResearch || !config.anthropic.enabled) {
    return { program: match ? catalogProgram(match, profile) : null, pending: null, researchUnavailable: wantsResearch && !config.anthropic.enabled };
  }

  const key = researchKey(profile);
  const existing = await getProgram(key);
  if (existing && (existing.status === 'ready' || existing.status === 'researching')) return { program: existing, pending: null };

  const rec = {
    key, status: 'researching', source: 'research', startedAt: new Date().toISOString(),
    name: profile.program || profile.institution, level: profile.level,
    country: profile.country || '', institution: profile.institution || '', exam: profile.exam || '',
    fallback: match ? catalogProgram(match, profile) : null, units: [], sources: [],
  };
  await kv.set(`program:${key}`, rec);

  const pending = researchProgram(profile).then(async (found) => {
    const units = found.units.map((u, i) => ({ id: `${key.slice(4)}-u${i + 1}`, title: u.title, summary: u.summary, topic: u.topic, stage: u.stage }));
    for (const u of units) await kv.set(`unit:${u.id}`, { ...u, programKey: key, programName: found.name });
    await kv.set(`program:${key}`, { ...rec, status: 'ready', name: found.name, basis: found.basis, institutionMatched: found.institutionMatched, units, sources: found.sources, readyAt: new Date().toISOString() });
  }).catch(async (err) => {
    console.error('[curriculum] research failed:', err.message);
    await kv.set(`program:${key}`, { ...rec, status: 'failed', error: String(err.message || err) });
  });
  return { program: rec, pending };
}
