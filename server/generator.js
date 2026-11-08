// Generates one StudyTok video:
//   lesson (Claude or bank) -> stock b-roll + music (Vidmoat stock search + import)
//   -> commands (compose.js) -> POST /v1/projects with those commands (one call)
//   -> GET /v1/projects/{id}?view=document -> stored and served to the embed player.
// Nothing is rendered: the browser plays the document live in Vidmoat's /embed/player.
//
// startVideo() saves a "generating" record and returns it with a `done` promise. On Vercel the
// request handler passes `done` to waitUntil() so the function keeps running after the
// response; on a long-running server the promise simply runs in the background.

import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { topic as topicOf } from './topics.js';
import { writeLesson } from './lessons/index.js';
import { resolveBroll, resolveMusic } from './media.js';
import { composeLesson } from './compose.js';
import { createProject, getDocument as fetchDocument, deleteProject, fileProject } from './vidmoat.js';
import { saveVideo, updateVideo, setDocument, markReady, addCovered, getCovered } from './db.js';

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

/**
 * Registers a new video as "generating" and starts building it.
 * @returns {Promise<{video: object, done: Promise<void>}>}  `done` never rejects.
 */
export async function startVideo(topicId, { requestedBy } = {}) {
  const video = {
    id: randomUUID(), topic: topicId, status: 'generating',
    createdAt: new Date().toISOString(), requestedBy: requestedBy || null,
  };
  await saveVideo(video);
  const done = enqueue(() => buildVideo(video)).catch(async (err) => {
    console.error(`[generator] ${video.id} failed:`, err);
    await updateVideo(video.id, { status: 'failed', error: String(err.message || err) }).catch(() => {});
  });
  return { video, done };
}

async function buildVideo(video) {
  const started = Date.now();
  const look = topicOf(video.topic);

  const { lesson, source } = await writeLesson(look, await getCovered(video.topic));
  await addCovered(video.topic, lesson.title, lesson.subtopic);
  await updateVideo(video.id, { lesson, lessonSource: source });

  // One clip for the hook and one per beat. The hook reuses the first beat's visual, with the
  // topic's generic query as a fallback.
  const queries = [lesson.beats[0].visual, ...lesson.beats.map((b) => b.visual)];
  const [broll, music] = await Promise.all([
    resolveBroll(queries, look.fallbackVisual),
    config.generation.music ? resolveMusic() : Promise.resolve(null),
  ]);

  const { commands, duration } = composeLesson({ ...lesson, topicLabel: look.label }, { broll, music });
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

  const ready = await updateVideo(video.id, {
    status: 'ready',
    projectId: config.vidmoat.deleteProjectsAfterCache ? null : projectId,
    duration,
    poster: broll[0]?.thumbnailUrl || null,
    credits: [...broll, music].filter(Boolean).map((m) => ({ by: m.credit, source: m.sourceUrl, provider: m.provider })),
    lint: (created.verification?.layout || []).filter((l) => l.severity === 'warn'),
    buildMs: Date.now() - started,
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
