// Community packs: the pack.md format, the loader, and how a pack joins a student's course.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-packs-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { parsePack, loadPacks, PACKS, PACK_BY_SLUG, packUnit, isPackUnit, packOfUnit, publicPack, ASSET_BASE } = await import('../server/curriculum/packs.js');
const { getUnit } = await import('../server/curriculum/index.js');
const { saveProfile, editProfile, library, publicVideo, addPack } = await import('../server/feed/index.js');
const { packContext } = await import('../server/lessons/index.js');
const { EVENT_SPECS } = await import('../server/feed/events.js');

const example = readFileSync(new URL('../content/meditations-marcus-aurelius/pack.md', import.meta.url), 'utf8');

test('the example pack parses: frontmatter, units with facts, pack facts, quiz bank and assets', () => {
  const { pack, problems } = parsePack('meditations-marcus-aurelius', example);
  assert.deepEqual(problems, []);
  assert.equal(pack.kind, 'book'); assert.equal(pack.topic, 'psychology'); assert.equal(pack.license, 'CC-BY-4.0');
  assert.deepEqual(pack.tags, ['stoicism', 'philosophy', 'marcus-aurelius', 'habits']);
  assert.equal(pack.units.length, 5);
  assert.equal(pack.units[0].id, 'pack:meditations-marcus-aurelius:1');
  assert.match(pack.units[0].summary, /sorting exercise/); assert.equal(pack.units[0].facts.length, 2);
  assert.ok(pack.facts.length >= 4);
  assert.equal(pack.quiz.length, 4); assert.equal(pack.quiz[1].options[0], 'Greek');
  assert.equal(pack.assets.length, 1); assert.equal(pack.assets[0].width, 1080); assert.equal(pack.assets[0].url, `${ASSET_BASE}/meditations-marcus-aurelius/assets/cover.png`);
  assert.ok(PACK_BY_SLUG['meditations-marcus-aurelius'], 'loaded at startup');
  assert.equal(publicPack(pack).units[0].title, 'What you control and what you do not');
  assert.equal(publicPack(pack).assets, 1);
});

test('the rules: every broken field is named', () => {
  const bad = `---
title: Hi
kind: advert
topic: cooking
by:
link: http://insecure.example
cta: This call to action is far too long for the chip
license: proprietary
tags: [Bad Tag]
---
## About
Short.
## Units
### A
Tiny.
## Quiz bank
- Q: no options
## Assets
| file | kind | shows | credit | license | size | duration |
| --- | --- | --- | --- | --- | --- | --- |
| Cover Image.JPG | picture | x | | MIT | big | |
## Extra
text`;
  const { pack, problems } = parsePack('Bad_Slug', bad);
  assert.equal(pack, null);
  const text = problems.join('\n');
  for (const needle of ['folder name', 'title:', 'kind:', 'topic:', 'by:', 'link:', 'cta:', 'license:', 'tags:', '## About', '## Units', 'summary paragraph', 'quiz line not understood', 'file names', 'kind is image', '"shows"', 'credit', 'size as WIDTHxHEIGHT', 'unknown sections: extra']) {
    assert.ok(text.includes(needle), `mentions ${needle}: ${text}`);
  }
  assert.equal(parsePack('no-frontmatter', '## About\nx').pack, null);
  assert.ok(parsePack('dup-units', example.replace('### The obstacle becomes the way', '### What you control and what you do not')).problems.some((m) => /unique/.test(m)));
});

test('the loader skips folders with problems and ignores _template and README', () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-'));
  mkdirSync(join(dir, '_template')); writeFileSync(join(dir, '_template', 'pack.md'), 'x');
  writeFileSync(join(dir, 'README.md'), '# readme');
  mkdirSync(join(dir, 'good-pack')); writeFileSync(join(dir, 'good-pack', 'pack.md'), example);
  mkdirSync(join(dir, 'broken')); writeFileSync(join(dir, 'broken', 'pack.md'), '---\ntitle: x\n---\n');
  mkdirSync(join(dir, 'empty'));
  const { packs, problems } = loadPacks(dir);
  assert.deepEqual(packs.map((p) => p.slug), ['good-pack']);
  assert.ok(problems.broken.length > 0); assert.deepEqual(problems.empty, ['no pack.md in the folder']);
});

test('a pack joins a course: units resolve, the library lists it as a course, lessons get the pack context, videos carry the credit', async () => {
  const slug = 'meditations-marcus-aurelius';
  const unitId = `pack:${slug}:2`;
  assert.ok(isPackUnit(unitId)); assert.equal((await getUnit(unitId)).title, 'The obstacle becomes the way'); assert.equal(packUnit('pack:nope:1'), null);
  assert.equal(packOfUnit(unitId).slug, slug); assert.equal(packOfUnit('hs-biology-u1'), null);
  // via the ?pack= link at setup
  const user = await saveProfile(null, { profile: { level: 'lifelong' }, units: [], interests: ['history'], pack: slug });
  assert.deepEqual(user.packs, [slug]); assert.equal(user.units.filter((id) => id.startsWith(`pack:${slug}:`)).length, 5);
  // idempotent; unknown packs ignored
  assert.equal(addPack(user, slug), true); assert.equal(user.units.length, 5); assert.equal(addPack(user, 'nope'), false);
  const lib = await library(user.id);
  const course = lib.programs.find((p) => p.key === `pack:${slug}`);
  assert.ok(course, 'listed as a course'); assert.equal(course.pack.by, 'StudyGraph examples'); assert.match(course.basis, /community pack/);
  assert.equal(lib.units.filter((u) => u.programKey === `pack:${slug}`).length, 5);
  assert.equal(lib.packs.find((p) => p.slug === slug).added, true);
  // the writer's context
  const ctx = packContext(await getUnit(unitId));
  assert.match(ctx[0], /SOURCE PACK: this unit comes from "Meditations, the ideas" \(book\) by StudyGraph examples/);
  assert.ok(ctx.some((l) => /asset:cover\.png \(image\)/.test(l)), 'assets offered by file name');
  assert.ok(ctx.some((l) => /Quiz bank/.test(l) && /Greek/.test(l)));
  assert.deepEqual(packContext({ id: 'hs-biology-u1' }), []);
  // the video says where it came from
  const pub = await publicVideo({ id: 'v', status: 'generating', topic: 'psychology', unitId, unitTitle: 'x' }, null, {});
  assert.equal(pub.pack.title, 'Meditations, the ideas'); assert.equal(pub.pack.cta, 'Read it free on Gutenberg'); assert.equal(pub.pack.link, 'https://www.gutenberg.org/ebooks/2680');
  // remove
  const { user: after } = await editProfile(user.id, { removePack: slug });
  assert.deepEqual(after.packs, []); assert.equal(after.units.length, 0);
  const { added } = await editProfile(user.id, { addPack: slug });
  assert.equal(added.pack.slug, slug);
  assert.ok(EVENT_SPECS.pack_add && EVENT_SPECS.pack_remove && EVENT_SPECS.pack_link);
});
