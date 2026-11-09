// QA tool: build one offline-bank lesson into a real Vidmoat project and save exact frames
// (the same pipeline as an export) to data/frames/. Preview frames are free but limited to
// 10 a minute per key.
//
// Usage: npm run preview -- <topicId> [lessonIndex=0] [--format=<id>] [--voice=<audio url> <seconds>] [times...]
//   --format  build the hand-written sample for that video format (lessons/samples.js) instead
//   --voice   test the narrated timeline with any audio file standing in for speech
//             (word timings are estimated; costs no speech credits)
//   --narrate real narration through Vidmoat speech (spends credits: up to 20)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../server/core/config.js';
import { BANK } from '../server/lessons/bank.js';
import { SAMPLES } from '../server/lessons/samples.js';
import { format as formatOf } from '../server/video/formats.js';
import { sanitizeLesson } from '../server/lessons/schema.js';
import { topic as topicOf } from '../server/curriculum/topics.js';
import { composeLesson } from '../server/video/compose.js';
import { resolveLessonMedia, resolveMusic } from '../server/video/media.js';
import { soundKit } from '../server/video/sfx.js';
import { narrationParts, alignParts, narrate } from '../server/video/voice.js';
import { createProject, previewFrame } from '../server/core/vidmoat.js';
import { flushKv } from '../server/core/kv.js';

const args = process.argv.slice(2);
const voiceArg = args.findIndex((a) => a.startsWith('--voice='));
let voice = null;
const fmtArg = args.find((a) => a.startsWith('--format='))?.slice('--format='.length);
const rest = (voiceArg >= 0 ? args.filter((_, i) => i !== voiceArg && i !== voiceArg + 1) : args).filter((a) => a !== '--narrate' && !a.startsWith('--format='));
const [topicId = fmtArg ? 'physics' : 'biology', idx = '0', ...times] = rest;
const look = topicOf(topicId);
const lesson = sanitizeLesson(fmtArg ? SAMPLES[fmtArg] : BANK[look.id][Number(idx)], look.id);
const skin = formatOf(lesson.format).skin;

if (voiceArg >= 0) {
  const src = args[voiceArg].slice('--voice='.length);
  const duration = Number(args[voiceArg + 1]);
  const parts = narrationParts(lesson);
  const aligned = alignParts(parts, duration, []);
  const words = aligned.parts.flatMap((p) => {
    const ws = parts.find((x) => x.id === p.id).text.split(/\s+/);
    const step = (p.end - p.start) / ws.length;
    return ws.map((t, i) => ({ text: t, start: p.start + i * step, end: p.start + (i + 1) * step }));
  });
  voice = { src, duration, parts: aligned.parts, words };
}

if (args.includes('--narrate')) {
  voice = await narrate(lesson);
  console.log('narration:', voice ? `${voice.mode}, ${voice.duration}s, ${voice.words.length} words, voice ${voice.voiceId}, ~${voice.credits} credits` : 'FAILED (see warning above)');
}

const [media, music, sfx] = await Promise.all([resolveLessonMedia(lesson, look.fallbackVisual), resolveMusic(skin.music), soundKit()]);
flushKv();
const { commands, segments, duration, quiz } = composeLesson({ ...lesson, chip: look.label }, { ...media, music, sfx, voice });
const res = await createProject(`StudyGraph preview · ${lesson.title}`, commands);
const failed = res.results.map((r, i) => [r, commands[i]]).filter(([r]) => !r.ok);
console.log(`project ${res.project.id} (${lesson.format}): ${commands.length - failed.length}/${commands.length} commands applied, ${duration}s, music "${music?.query || '?'}"`);
console.log('segments', segments.map((s) => `${s.id}@${s.start}`).join(' '), quiz ? `quiz from ${quiz.from} hold ${quiz.hold} reveal ${quiz.reveal}` : '');
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
