// Generates one StudyTok video for a unit at a level:
//   lesson (queued episode, or a Claude batch, or the offline bank)
//   -> in parallel: narration (Vidmoat speech + timings), ambient/beat media (stock + Commons),
//      sound-effects kit, music bed
//   -> commands (compose.js) -> POST /v1/projects (one call) -> GET ?view=document
//   -> stored and filed under the unit+level so every student on that unit can be served it.
// Nothing is rendered: the browser plays the document live in Vidmoat's /embed/player.
//
// startVideo() saves a "generating" record and returns it with a `done` promise. On Vercel the
// request handler passes `done` to waitUntil() so the function keeps running after the
// response; on a long-running server the promise simply runs in the background.

import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { topic as topicOf } from './topics.js';
import { nextLesson, lessonKey } from './lessons/index.js';
import { interestUnit } from './curriculum.js';
import { resolveLessonMedia, resolveMusic } from './media.js';
import { soundKit } from './sfx.js';
import { narrate } from './voice.js';
import { composeLesson } from './compose.js';
import { format as formatOf } from './formats.js';
import { createProject, getDocument as fetchDocument, deleteProject, fileProject } from './vidmoat.js';
import { saveVideo, updateVideo, setDocument, markReady } from './db.js';

// ---- A small promise queue so a burst of scrolling cannot fire unbounded API work
// (per process / serverless instance).
const queue = [];
let running = 0;
function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}
function pump() {
  while (running < config.generation.concurrency && queue.length) {
    const { task, resolve, reject } = queue.shift();
    running++;
    task().then(resolve, reject).finally(() => { running--; pump(); });
  }
}
export const queueStats = () => ({ running, waiting: queue.length });

/** Videos are filed by lesson key plus the preferences that change the video itself. */
export const readyKeyFor = (unitId, audience) => `${lessonKey(unitId, audience)}${audience.prefs?.voice === 'off' ? '|novoice' : ''}`;

/**
 * Registers a new video as "generating" and starts building it.
 * @param unit      { id, title, topic, ... }
 * @param audience  { level, levelLabel, audience, country, institution, exam }
 * @returns {Promise<{video: object, done: Promise<void>}>}  `done` never rejects.
 */
export async function startVideo(unit, audience, { requestedBy } = {}) {
  const video = {
    id: randomUUID(), unitId: unit.id, unitTitle: unit.title, topic: unit.topic, level: audience.level,
    readyKey: readyKeyFor(unit.id, audience), status: 'generating',
    createdAt: new Date().toISOString(), requestedBy: requestedBy || null,
  };
  await saveVideo(video);
  const done = enqueue(() => buildWithRetry(video, unit, audience)).catch(async (err) => {
    console.error(`[generator] ${video.id} failed:`, err);
    await updateVideo(video.id, { status: 'failed', error: String(err.message || err) }).catch(() => {});
  });
  return { video, done };
}

async function buildWithRetry(video, unit, audience) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await buildVideo(video, unit, audience);
    } catch (err) {
      if (attempt >= config.generation.retries) throw err;
      console.warn(`[generator] ${video.id} attempt ${attempt + 1} failed (${err.message}); retrying`);
      await updateVideo(video.id, { createdAt: new Date().toISOString(), lastError: String(err.message || err) });
    }
  }
}

async function buildVideo(video, unit, audience) {
  const started = Date.now();
  const look = topicOf(unit.topic);

  // Sound effects do not depend on the lesson: start them now (music does: its mood follows the format).
  const sfxP = config.generation.sfx ? soundKit().catch(() => ({})) : Promise.resolve({});

  const { lesson, source } = await nextLesson(unit, audience);
  // An offline-bank lesson is about the unit's broad topic, not the unit itself: label and file
  // it under the topic so it never claims to teach (or counts towards) that unit.
  if (source === 'bank' && !unit.open) {
    const topicUnit = interestUnit(unit.topic);
    if (topicUnit) {
      unit = topicUnit;
      await updateVideo(video.id, { unitId: unit.id, unitTitle: unit.title, readyKey: readyKeyFor(unit.id, audience) });
    }
  }
  await updateVideo(video.id, { lesson, lessonSource: source, format: lesson.format });
  const lessonMs = Date.now() - started;
  const skin = formatOf(lesson.format).skin;

  const [voice, media, music, sfx] = await Promise.all([
    audience.prefs?.voice === 'off' ? Promise.resolve(null) : narrate(lesson),
    resolveLessonMedia(lesson, look.fallbackVisual),
    config.generation.music ? resolveMusic(skin.music).catch(() => null) : null,
    sfxP,
  ]);

  const chip = unit.open ? look.label : unit.title;
  const { commands, duration, quiz } = composeLesson({ ...lesson, topic: unit.topic, chip }, { ...media, music, sfx, voice });
  const created = await createProject(`StudyTok · ${lesson.title}`, commands);
  const projectId = created.project.id;
  const failed = (created.results || []).filter((r) => !r.ok);
  if (failed.length) console.warn(`[generator] ${video.id}: ${failed.length}/${commands.length} commands failed`, failed.slice(0, 3));
  if (failed.length > commands.length / 3) throw new Error(`Too many commands failed (${failed.length}/${commands.length})`);

  if (config.vidmoat.workspaceId) await fileProject(projectId, config.vidmoat.workspaceId).catch(() => {});

  const document = await fetchDocument(projectId);
  assertPlayable(document);
  await setDocument(video.id, document);

  if (config.vidmoat.deleteProjectsAfterCache) await deleteProject(projectId).catch((e) => console.warn('[generator] delete failed', e.message));

  const credits = [media.ambient, ...media.beatMedia, ...(media.itemMedia || []), music].filter(Boolean).map((m) => ({ by: m.credit, source: m.sourceUrl, provider: m.provider }));
  const ready = await updateVideo(video.id, {
    status: 'ready',
    projectId: config.vidmoat.deleteProjectsAfterCache ? null : projectId,
    duration,
    poster: media.ambient?.thumbnailUrl || media.beatMedia.find(Boolean)?.thumbnailUrl || null,
    credits,
    format: lesson.format,
    narrated: Boolean(voice),
    voice: voice ? { mode: voice.mode, credits: voice.credits, voiceId: voice.voiceId } : null,
    quiz: lesson.quiz && quiz ? { ...lesson.quiz, ...quiz } : null,
    lint: (created.verification?.layout || []).filter((l) => l.severity === 'warn'),
    timings: { lessonMs, totalMs: Date.now() - started },
    readyAt: new Date().toISOString(),
  });
  await markReady(ready);
}


// The embed player only sees the document we send it: every media URL must be absolute and
// reachable from the viewer's browser, and the document must stay under the 8 MB player limit.
function assertPlayable(document) {
  const size = Buffer.byteLength(JSON.stringify(document));
  if (size > 8 * 1024 * 1024) throw new Error(`Document is ${size} bytes, over the player's 8 MB limit`);
  for (const clip of document.clips || []) {
    if (clip.src && !/^https:\/\//.test(clip.src)) throw new Error(`Clip ${clip.id} has a non-absolute src: ${clip.src}`);
  }
}
