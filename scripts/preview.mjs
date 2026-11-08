// QA tool: build a lesson from the offline bank into a real Vidmoat project and save exact
// frames (the same pipeline as an export) to data/frames/. Preview frames are free but
// limited to 10 a minute per key.
// Usage: npm run preview -- <topicId> [lessonIndex=0] [times...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../server/config.js';
import { BANK } from '../server/lessons/bank.js';
import { sanitizeLesson } from '../server/lessons/schema.js';
import { topic as topicOf } from '../server/topics.js';
import { composeLesson } from '../server/compose.js';
import { resolveBroll, resolveMusic } from '../server/media.js';
import { createProject, previewFrame } from '../server/vidmoat.js';
import { flushKv } from '../server/kv.js';

const [topicId = 'biology', idx = '0', ...rest] = process.argv.slice(2);
const look = topicOf(topicId);
const lesson = sanitizeLesson(BANK[look.id][Number(idx)], look.id);
const queries = [lesson.beats[0].visual, ...lesson.beats.map((b) => b.visual)];
const [broll, music] = await Promise.all([resolveBroll(queries, look.fallbackVisual), resolveMusic()]);
flushKv();
const { commands, segments, duration } = composeLesson({ ...lesson, topicLabel: look.label }, { broll, music });
const res = await createProject(`StudyTok preview · ${lesson.title}`, commands);
const failed = res.results.filter((r) => !r.ok);
console.log(`project ${res.project.id}: ${commands.length - failed.length}/${commands.length} commands applied, ${duration}s`);
for (const f of failed) console.log('  failed:', f.op, f.error);
for (const l of res.verification?.layout || []) console.log(`  lint ${l.severity} @${l.time}s: ${l.message}`);

const times = rest.length ? rest.map(Number) : segments.map((s) => Math.round((s.start + Math.min(1.5, s.duration / 2)) * 10) / 10);
const dir = join(config.dataDir, 'frames');
mkdirSync(dir, { recursive: true });
for (const t of times) {
  const file = join(dir, `${res.project.id}-${t}.jpg`);
  writeFileSync(file, await previewFrame(res.project.id, t));
  console.log('  frame', file);
}
