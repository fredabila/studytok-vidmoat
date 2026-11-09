// One-off migration for region-aware lessons (lessons/index.js lessonKey): lessons made before
// the lesson key carried the country were filed under a key without it, so a lesson written for
// a student in Ghana sat in a pool shared with students everywhere. Each one is re-filed under
// the country of the student it was made for (`requestedBy`; for the nightly top-up, the
// audience it was made for). A lesson whose country cannot be known stays where it is, neutral.
// What each pool had covered, its recent formats and its study plan carry over to the new key.

import { kv } from '../core/kv.js';
import * as db from '../core/db.js';
import { regionOf } from '../lessons/index.js';

const FLAG = 'migr:regions:v1';

/** "u|high-school||l:deep" + "ghana" → "u|high-school||l:deep|loc:ghana" (before a |novoice suffix). */
export function withRegion(readyKey, loc) {
  if (!loc || readyKey.includes('|loc:')) return readyKey;
  return readyKey.endsWith('|novoice') ? `${readyKey.slice(0, -8)}|loc:${loc}|novoice` : `${readyKey}|loc:${loc}`;
}
const lessonKeyOf = (readyKey) => readyKey.replace(/\|novoice$/, '');

export async function migrateRegions({ force = false } = {}) {
  if (!force && await kv.get(FLAG)) return { skipped: true };
  if (!(await kv.set(`${FLAG}:lock`, 1, { nx: true, ex: 300 }))) return { busy: true };
  try {
    const ids = await kv.zrange('ready:any', 0, -1);
    const countryOf = new Map(); // user id → region
    const regionFor = async (v) => {
      if (v.requestedBy === 'cron') return regionOf((await kv.get(`popular:audience:${v.readyKey}`))?.audience?.country);
      if (!v.requestedBy) return '';
      if (!countryOf.has(v.requestedBy)) countryOf.set(v.requestedBy, regionOf((await db.getUser(v.requestedBy))?.profile?.country));
      return countryOf.get(v.requestedBy);
    };
    const keyMoves = new Map(); // old lesson key → set of new lesson keys
    let moved = 0;
    for (let i = 0; i < ids.length; i += 25) {
      const vids = await Promise.all(ids.slice(i, i + 25).map((id) => db.getVideo(id)));
      for (const v of vids) {
        if (!v?.readyKey || v.readyKey.includes('|loc:') || v.loc !== undefined) continue;
        const loc = await regionFor(v);
        if (!loc) { await db.updateVideo(v.id, { loc: null }); continue; }
        const next = withRegion(v.readyKey, loc);
        const at = Date.parse(v.createdAt) || Date.now();
        await Promise.all([kv.zadd(`ready:${next}`, { score: at, member: v.id }), kv.zrem(`ready:${v.readyKey}`, v.id), db.updateVideo(v.id, { readyKey: next, loc })]);
        const from = lessonKeyOf(v.readyKey);
        if (!keyMoves.has(from)) keyMoves.set(from, new Set());
        keyMoves.get(from).add(lessonKeyOf(next));
        moved++;
      }
    }
    // Carry what each pool had covered (so lessons are not repeated), its formats and its plan.
    for (const [from, targets] of keyMoves) {
      const [covered, formats, plan, cursor] = await Promise.all([kv.lrange(`covered:${from}`, 0, 199), kv.lrange(`formats:${from}`, 0, 19), kv.get(`plan:${from}`), kv.get(`plan:${from}:next`)]);
      for (const to of targets) {
        if (covered?.length && !(await kv.llen(`covered:${to}`))) await kv.rpush(`covered:${to}`, ...covered);
        if (formats?.length && !(await kv.llen(`formats:${to}`))) await kv.rpush(`formats:${to}`, ...formats);
        if (plan && !(await kv.get(`plan:${to}`))) await kv.set(`plan:${to}`, plan);
        if (cursor != null && (await kv.get(`plan:${to}:next`)) == null) await kv.set(`plan:${to}:next`, cursor);
      }
    }
    await kv.set(FLAG, { at: new Date().toISOString(), moved, keys: keyMoves.size });
    return { moved, keys: keyMoves.size };
  } finally {
    await kv.del(`${FLAG}:lock`);
  }
}
