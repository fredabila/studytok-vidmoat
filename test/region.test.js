// Region-aware lessons: lessons use everyday examples from the student's country, so a lesson
// made for Ghana (trotro, cedis) is never served in the UK. Lessons made with no country suit
// everyone. Covers the key, the pools, the starters and the migration of older lessons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-region-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
process.env.STUDYTOK_EXPERIMENTS = 'off';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const { regionOf, lessonKey } = await import('../server/lessons/index.js');
const { readyKeyFor } = await import('../server/video/generator.js');
const { saveProfile, nextItems, audienceFor, poolKeys, fitsRegion } = await import('../server/feed/index.js');
const { migrateRegions } = await import('../server/feed/regions.js');
const { CATALOG } = await import('../server/curriculum/catalog.js');

const bio = CATALOG.find((p) => p.id === 'hs-biology');
const unit = bio.units[0].id;
const base = { level: 'high-school', program: 'Biology', age: 21 };
const gh = audienceFor({ profile: { ...base, country: 'Ghana' } });
const uk = audienceFor({ profile: { ...base, country: 'UK' } });
const none = audienceFor({ profile: { ...base, country: '' } });

async function seed(audience, n, extra = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const v = { id: crypto.randomUUID(), unitId: unit, unitTitle: 'Cells', topic: 'biology', level: 'high-school', readyKey: readyKeyFor(unit, audience), loc: regionOf(audience.country) || null,
      status: 'ready', createdAt: new Date(Date.now() - i * 1000).toISOString(), lesson: { title: `${audience.country || 'anywhere'} ${i}`, hook: 'h' }, duration: 20, ...extra };
    await db.saveVideo(v); await db.setDocument(v.id, { version: 1, clips: [] }); await db.markReady(v);
    ids.push(v.id);
  }
  return ids;
}

test('countries become keys; aliases agree', () => {
  assert.equal(regionOf('Ghana'), 'ghana');
  assert.equal(regionOf(' UK '), 'united-kingdom');
  assert.equal(regionOf('England'), 'united-kingdom');
  assert.equal(regionOf('United States of America'), 'united-states');
  assert.equal(regionOf("Côte d'Ivoire"), 'cote-d-ivoire');
  assert.equal(regionOf(''), '');
  assert.ok(lessonKey(unit, gh).endsWith('|loc:ghana'));
  assert.notEqual(lessonKey(unit, gh), lessonKey(unit, uk));
  assert.equal(lessonKey(unit, none).includes('loc:'), false);
});

test('a student is served their country and neutral lessons, never another country', async () => {
  const ghIds = await seed(gh, 2);
  const ukIds = await seed(uk, 2);
  const anyIds = await seed(none, 2);
  assert.deepEqual(poolKeys(unit, uk), [readyKeyFor(unit, uk), readyKeyFor(unit, none)]);
  assert.deepEqual(poolKeys(unit, none), [readyKeyFor(unit, none)]);
  const student = await saveProfile(null, { profile: { ...base, country: 'United Kingdom', managedBy: 'self' }, programKeys: [`cat:${bio.id}`], units: [unit], interests: [] });
  const served = [];
  for (let i = 0; i < 4; i++) {
    const { items } = await nextItems(student.id, 1);
    for (const it of items) if (it.video) { served.push(it.video.id); await db.addToSet(student.id, 'seen', it.video.id); }
  }
  assert.ok(served.length >= 3);
  assert.equal(served.some((id) => ghIds.includes(id)), false, 'no Ghana lessons in the UK');
  assert.ok(served.every((id) => ukIds.includes(id) || anyIds.includes(id)));
  assert.equal(fitsRegion({ loc: 'ghana' }, uk), false);
  assert.equal(fitsRegion({ loc: null }, uk), true);
  assert.equal(fitsRegion({ loc: 'united-kingdom' }, uk), true);
});

test('older lessons are re-filed under the country of the student they were made for', async () => {
  const oldKey = `${bio.units[1].id}|high-school|`;
  const owner = await saveProfile(null, { profile: { ...base, country: 'Ghana', managedBy: 'self' }, units: [], interests: ['space'] });
  const v1 = { id: crypto.randomUUID(), unitId: bio.units[1].id, topic: 'biology', level: 'high-school', readyKey: oldKey, status: 'ready', createdAt: new Date().toISOString(), requestedBy: owner.id, lesson: { title: 'trotro' } };
  const v2 = { id: crypto.randomUUID(), unitId: bio.units[1].id, topic: 'biology', level: 'high-school', readyKey: `${oldKey}|novoice`, status: 'ready', createdAt: new Date().toISOString(), requestedBy: owner.id, lesson: { title: 'trotro2' } };
  const v3 = { id: crypto.randomUUID(), unitId: bio.units[1].id, topic: 'biology', level: 'high-school', readyKey: oldKey, status: 'ready', createdAt: new Date().toISOString(), requestedBy: null, lesson: { title: 'anywhere' } };
  for (const v of [v1, v2, v3]) { await db.saveVideo(v); await db.markReady(v); }
  await kv.lpush(`covered:${oldKey}`, 'Cell walls');
  const r = await migrateRegions({ force: true });
  assert.ok(r.moved >= 2);
  const m1 = await db.getVideo(v1.id);
  assert.equal(m1.readyKey, `${oldKey}|loc:ghana`);
  assert.equal(m1.loc, 'ghana');
  assert.equal((await db.getVideo(v2.id)).readyKey, `${oldKey}|loc:ghana|novoice`);
  assert.equal((await db.getVideo(v3.id)).readyKey, oldKey, 'unknown country: stays neutral');
  assert.deepEqual(await kv.zrange(`ready:${oldKey}|loc:ghana`, 0, -1), [v1.id]);
  assert.deepEqual(await kv.zrange(`ready:${oldKey}`, 0, -1), [v3.id]);
  assert.deepEqual(await kv.lrange(`covered:${oldKey}|loc:ghana`, 0, -1), ['Cell walls'], 'what was covered carries over');
  assert.equal((await migrateRegions()).skipped, true, 'runs once');
});
