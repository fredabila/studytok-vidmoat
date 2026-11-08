// QA tool: build one offline-bank lesson into a real Vidmoat project and save exact frames
// (the same pipeline as an export) to data/frames/. Preview frames are free but limited to
// 10 a minute per key.
//
// Usage: npm run preview -- <topicId> [lessonIndex=0] [--voice=<audio url> <seconds>] [times...]
//   --voice   test the narrated timeline with any audio file standing in for speech
//             (word timings are estimated; costs no speech credits)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../server/config.js';
import { BANK } from '../server/lessons/bank.js';
import { sanitizeLesson } from '../server/lessons/schema.js';
import { topic as topicOf } from '../server/topics.js';
import { composeLesson } from '../server/compose.js';
import { resolveLessonMedia, resolveMusic } from '../server/media.js';
import { soundKit } from '../server/sfx.js';
import { narrationParts, alignParts } from '../server/voice.js';
import { createProject, previewFrame } from '../server/vidmoat.js';
import { flushKv } from '../server/kv.js';

const args = process.argv.slice(2);
const voiceArg = args.findIndex((a) => a.startsWith('--voice='));
let voice = null;
const rest = voiceArg >= 0 ? args.filter((_, i) => i !== voiceArg && i !== voiceArg + 1) : args;
const [topicId = 'biology', idx = '0', ...times] = rest;
const look = topicOf(topicId);
const lesson = sanitizeLesson(BANK[look.id][Number(idx)], look.id);

if (voiceArg >= 0) {
  const src = args[voiceArg].slice('--voice='.length);
  const duration = Number(args[voiceArg + 1]);
  const parts = narrationParts(lesson);
  const aligned = alignParts(parts, duration, []);
  const words = aligned.parts.flatMap((p) => {
    const ws = parts.find((x) => x.kind === p.kind && x.index === p.index).text.split(/\s+/);
    const step = (p.end - p.start) / ws.length;
    return ws.map((t, i) => ({ text: t, start: p.start + i * step, end: p.start + (i + 1) * step }));
  });
  const reveal = aligned.parts.findIndex((p) => p.kind === 'reveal');
  voice = { src, duration, split: reveal > 0 ? aligned.cuts[reveal] : null, parts: aligned.parts, words };
}

const [media, music, sfx] = await Promise.all([resolveLessonMedia(lesson, look.fallbackVisual), resolveMusic(), soundKit()]);
flushKv();
const { commands, segments, duration } = composeLesson({ ...lesson, chip: look.label }, { ...media, music, sfx, voice });
const res = await createProject(`StudyTok preview · ${lesson.title}`, commands);
const failed = res.results.map((r, i) => [r, commands[i]]).filter(([r]) => !r.ok);
console.log(`project ${res.project.id}: ${commands.length - failed.length}/${commands.length} commands applied, ${duration}s`);
console.log('segments', segments.map((s) => `${s.kind}${s.index ?? ''}@${s.start}`).join(' '));
for (const [r, c] of failed) console.log('  failed:', c.op, c.clipId, r.error);
for (const l of res.verification?.layout || []) console.log(`  lint ${l.severity} @${l.time}s: ${l.message.slice(0, 160)}`);

const at = times.length ? times.map(Number) : segments.map((s) => Math.round((s.start + Math.min(1.6, s.duration * 0.6)) * 10) / 10);
const dir = join(config.dataDir, 'frames');
mkdirSync(dir, { recursive: true });
for (const t of at.slice(0, 9)) {
  const file = join(dir, `${res.project.id}-${t}.jpg`);
  writeFileSync(file, await previewFrame(res.project.id, t));
  console.log('  frame', file);
}
