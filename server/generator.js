// Generates one StudyTok video:
//   lesson (Claude or bank) -> stock b-roll + music (Vidmoat stock search + import)
//   -> commands (compose.js) -> POST /v1/projects with those commands (one call)
//   -> GET /v1/projects/{id}?view=document -> cached locally and served to the embed player.
// Nothing is rendered: the browser plays the document live in Vidmoat's /embed/player.

import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { topic as topicOf } from './topics.js';
import { writeLesson } from './lessons/index.js';
import { resolveBroll, resolveMusic } from './media.js';
import { composeLesson } from './compose.js';
import { createProject, getDocument, deleteProject, fileProject } from './vidmoat.js';
import { videos } from './store.js';

// ---- A small promise queue so a burst of scrolling cannot fire unbounded API work. ----------
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

/** Titles/subtopics already in the library for a topic, so new lessons do not repeat them. */
export function coveredFor(topicId) {
  return videos.all().filter((v) => v.topic === topicId && v.lesson).flatMap((v) => [v.lesson.title, v.lesson.subtopic]);
}

/**
 * Registers a new video as "generating" and returns it immediately; the work runs in the queue.
 * Poll the record (GET /api/videos/:id) until status is "ready" or "failed".
 */
export function startVideo(topicId, { requestedBy } = {}) {
  const id = randomUUID();
  const record = videos.set(id, {
    id, topic: topicId, status: 'generating', createdAt: new Date().toISOString(), requestedBy: requestedBy || null,
    stats: { views: 0, completes: 0, likes: 0, skips: 0, watchSec: 0 },
  });
  enqueue(() => buildVideo(id)).catch((err) => {
    console.error(`[generator] ${id} failed:`, err);
    videos.update(id, (v) => ({ ...v, status: 'failed', error: String(err.message || err) }));
  });
  return record;
}

async function buildVideo(id) {
  const started = Date.now();
  const rec = videos.get(id);
  const look = topicOf(rec.topic);

  const { lesson, source } = await writeLesson(look, coveredFor(rec.topic));
  videos.update(id, (v) => ({ ...v, lesson, lessonSource: source }));

  // One clip for the hook and one per beat. The hook reuses the first beat's visual, with
  // the topic's generic query as a fallback.
  const queries = [lesson.beats[0].visual, ...lesson.beats.map((b) => b.visual)];
  const [broll, music] = await Promise.all([
    resolveBroll(queries, look.fallbackVisual),
    config.generation.music ? resolveMusic() : Promise.resolve(null),
  ]);

  const { commands, duration } = composeLesson({ ...lesson, topicLabel: look.label }, { broll, music });
  const created = await createProject(`StudyTok · ${lesson.title}`, commands);
  const projectId = created.project.id;
  const failed = (created.results || []).filter((r) => !r.ok);
  if (failed.length) console.warn(`[generator] ${id}: ${failed.length}/${commands.length} commands failed`, failed.slice(0, 3));
  if (failed.length > commands.length / 3) throw new Error(`Too many commands failed (${failed.length}/${commands.length})`);

  if (config.vidmoat.workspaceId) await fileProject(projectId, config.vidmoat.workspaceId).catch(() => {});

  const document = await getDocument(projectId);
  assertPlayable(document);

  if (config.vidmoat.deleteProjectsAfterCache) await deleteProject(projectId).catch((e) => console.warn('[generator] delete failed', e.message));

  return videos.update(id, (v) => ({
    ...v,
    status: 'ready',
    projectId: config.vidmoat.deleteProjectsAfterCache ? null : projectId,
    document,
    duration,
    poster: broll[0]?.thumbnailUrl || null,
    credits: [...broll, music].filter(Boolean).map((m) => ({ by: m.credit, source: m.sourceUrl, provider: m.provider })),
    lint: (created.verification?.layout || []).filter((l) => l.severity === 'warn'),
    buildMs: Date.now() - started,
    readyAt: new Date().toISOString(),
  }));
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
