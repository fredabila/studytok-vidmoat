// Comments under a lesson, TikTok-style: top-level comments (most liked first, then newest), one
// level of replies, likes. For adults only (core/safety.js capabilitiesOf: minors neither read nor
// post). Every comment is checked before anyone sees it:
//   - no links, email addresses or phone numbers (the commonest ways to pull someone off-platform);
//   - a model reads it and must say it is a respectful, on-topic study comment (fails closed);
//   - at most COMMENTS_PER_DAY per student and one every MIN_GAP_MS;
//   - REPORTS_TO_HIDE reports from different students hide it until someone reviews it.
// Questions get a public reply from the StudyGraph Tutor, written with the lesson in front of it
// (feed/ask.js tutorAnswer), so everyone who watches the lesson later sees the answer too.
// Names show as first name and initial ("Ama K."), never the email. Students delete their own.

import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { kv } from '../core/kv.js';
import { claude } from '../core/claude.js';
import { config } from '../core/config.js';
import { tutorAnswer } from './ask.js';

export const MAX_LEN = 300;
export const COMMENTS_PER_DAY = 20;
export const MIN_GAP_MS = 15_000;
export const REPORTS_TO_HIDE = 3;
export const TUTOR_REPLIES_PER_LESSON_DAY = 40;
export const TUTOR_NAME = 'StudyGraph Tutor';
const KEEP = 500;
const REPLIES_SHOWN = 30;

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|me|ly|gg|app|co|xyz|info|link|tv)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /(\+?\d[\d\s().-]{6,}\d)/;
const CONTACT = /\b(whats\s*app|telegram|snap(chat)?|insta(gram)?|dm me|text me|call me|my number)\b/i;
// A question the tutor should answer: a question mark, or a question word up front.
const QUESTION = /\?\s*$|^(how|why|what|when|where|which|who|is|are|can|could|does|do|did|should|would|will|explain)\b/i;

const VerdictSchema = z.object({
  ok: z.boolean().describe('true only for a respectful comment about the lesson or studying, fit for a public study app'),
  reason: z.string().describe('when not ok: a short, kind reason for the author (e.g. "Keep it about the lesson"); else ""'),
});
const SYSTEM = `You moderate comments under short study videos on StudyGraph, an education app. Approve (ok) questions, explanations, corrections, study tips, thanks and friendly reactions about the lesson. Reject: insults, harassment, hate, sexual content, violence, self-harm, drugs, spam or ads, requests to move to another app or meet up, personal information (names of others, schools, addresses, contacts), cheating services, and anything you are unsure about.`;

async function moderateClaude(text) {
  const response = await claude().messages.parse({
    model: config.anthropic.reviewModel,
    max_tokens: 150,
    output_config: { effort: 'low', format: zodOutputFormat(VerdictSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Comment: "${text}"` }],
  });
  return response.parsed_output;
}

/** { ok, reason }: rules first, then the model; no model or an error means no. */
export async function checkComment(text, { moderate = moderateClaude } = {}) {
  if (LINK.test(text) || EMAIL.test(text)) return { ok: false, reason: 'Links and email addresses are not allowed in comments.' };
  if (PHONE.test(text) || CONTACT.test(text)) return { ok: false, reason: 'Keep contact details and other apps out of comments.' };
  if (moderate === moderateClaude && !config.anthropic.enabled) return { ok: false, reason: 'Comments are paused right now.' };
  try {
    const v = await moderate(text);
    return v?.ok === true ? { ok: true, reason: '' } : { ok: false, reason: String(v?.reason || 'Keep it about the lesson.').slice(0, 120) };
  } catch (err) {
    console.warn('[comments] moderation failed:', err.message);
    return { ok: false, reason: "Couldn't check that comment. Try again in a moment." };
  }
}

export const isQuestion = (text) => QUESTION.test(String(text || '').trim());

/** "Ama K." from the Vidmoat account name; "A student" without one. */
export function displayName(user) {
  const parts = String(user?.vidmoat?.name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A student';
  return parts.length > 1 ? `${parts[0].slice(0, 20)} ${parts.at(-1)[0].toUpperCase()}.` : parts[0].slice(0, 20);
}

const visible = (c) => c && !c.hidden && !c.deleted;
async function view(c, userId) {
  return {
    id: c.id, name: c.name, text: c.text, at: c.at, mine: c.userId === userId, ai: Boolean(c.ai),
    likes: c.likes || 0, liked: userId ? (await kv.sismember(`comment:${c.id}:likes`, userId)) === 1 : false,
    tutorPending: Boolean(c.tutorPending),
  };
}

/** Comments on a lesson: { comments: [{ ..., replies: [...] }], count }. Most liked first, then newest. */
export async function listComments(videoId, userId, { limit = 50 } = {}) {
  const ids = await kv.lrange(`comments:${videoId}`, 0, KEEP - 1);
  const top = (await Promise.all(ids.map((id) => kv.get(`comment:${id}`)))).filter(visible);
  top.sort((a, b) => (b.likes || 0) - (a.likes || 0) || Date.parse(b.at) - Date.parse(a.at));
  let count = top.length;
  const comments = await Promise.all(top.slice(0, limit).map(async (c) => {
    const rids = await kv.lrange(`comment:${c.id}:replies`, 0, REPLIES_SHOWN - 1);
    const replies = (await Promise.all(rids.map((id) => kv.get(`comment:${id}`)))).filter(visible);
    count += replies.length;
    // The tutor's answer first, then the students' replies oldest first (a conversation).
    replies.sort((a, b) => Number(Boolean(b.ai)) - Number(Boolean(a.ai)) || Date.parse(a.at) - Date.parse(b.at));
    return { ...(await view(c, userId)), replies: await Promise.all(replies.map((r) => view(r, userId))) };
  }));
  return { comments, count };
}

/**
 * Posts a comment (or, with parentId, a reply) after the checks; throws 400/429 with a message for
 * the author. Returns the comment and `tutor`: true when the tutor will answer it.
 */
export async function postComment({ user, videoId, text, parentId = null, moderate, now = Date.now() }) {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  if (body.length < 2) throw Object.assign(new Error('Write something first.'), { status: 400 });
  if (body.length > MAX_LEN) throw Object.assign(new Error(`Keep it under ${MAX_LEN} characters.`), { status: 400 });
  let parent = null;
  if (parentId) {
    parent = await kv.get(`comment:${parentId}`);
    if (!visible(parent) || parent.videoId !== videoId) throw Object.assign(new Error('That comment is gone.'), { status: 404 });
    if (parent.parentId) parent = await kv.get(`comment:${parent.parentId}`); // one level of replies
  }
  const last = Number(await kv.get(`comments:last:${user.id}`)) || 0;
  if (now - last < MIN_GAP_MS) throw Object.assign(new Error('Wait a few seconds before commenting again.'), { status: 429 });
  const day = new Date(now).toISOString().slice(0, 10);
  if ((await kv.hincrby('comments:counts', `${user.id}:${day}`, 1)) > COMMENTS_PER_DAY) throw Object.assign(new Error('That is a lot of comments for one day. Try again tomorrow.'), { status: 429 });
  await kv.set(`comments:last:${user.id}`, now, { ex: 60 });
  const verdict = await checkComment(body, moderate ? { moderate } : {});
  if (!verdict.ok) {
    await kv.hincrby(`events:day:${day}`, 'comment_blocked', 1);
    throw Object.assign(new Error(verdict.reason), { status: 400, code: 'moderated' });
  }
  const tutor = !parent && isQuestion(body);
  const c = { id: randomUUID(), videoId, parentId: parent?.id || null, userId: user.id, name: displayName(user), text: body, at: new Date(now).toISOString(), reports: 0, likes: 0, tutorPending: tutor };
  await kv.set(`comment:${c.id}`, c);
  if (parent) await kv.rpush(`comment:${parent.id}:replies`, c.id);
  else { await kv.lpush(`comments:${videoId}`, c.id); await kv.ltrim(`comments:${videoId}`, 0, KEEP - 1); }
  await kv.hincrby(`events:day:${day}`, parent ? 'comment_reply' : 'comment', 1);
  return { comment: { ...(await view(c, user.id)), replies: [] }, tutor };
}

/**
 * The tutor answers a question comment in public, under it. Called after the response
 * (waitUntil); a failure just clears the pending mark. Capped per lesson per day.
 */
export async function tutorReply({ commentId, video, answer = tutorAnswer, now = Date.now() }) {
  const c = await kv.get(`comment:${commentId}`);
  if (!visible(c)) return null;
  const day = new Date(now).toISOString().slice(0, 10);
  let reply = null;
  try {
    if ((await kv.hincrby('comments:tutor', `${video.id}:${day}`, 1)) > TUTOR_REPLIES_PER_LESSON_DAY) throw new Error('daily cap');
    const r = await answer({ video, question: c.text, audience: {}, publicReply: true });
    if (r.onTopic !== false && r.answer) {
      reply = { id: randomUUID(), videoId: c.videoId, parentId: c.id, userId: null, ai: true, name: TUTOR_NAME, text: r.answer.slice(0, 900), at: new Date(now).toISOString(), reports: 0, likes: 0 };
      await kv.set(`comment:${reply.id}`, reply);
      await kv.rpush(`comment:${c.id}:replies`, reply.id);
      await kv.hincrby(`events:day:${day}`, 'comment_tutor', 1);
    }
  } catch (err) {
    console.warn('[comments] tutor reply skipped:', err.message);
  }
  await kv.set(`comment:${c.id}`, { ...(await kv.get(`comment:${c.id}`)), tutorPending: false });
  return reply;
}

/** Likes or unlikes a comment: { liked, likes }. */
export async function likeComment({ userId, id, on = true }) {
  const c = await kv.get(`comment:${id}`);
  if (!visible(c)) throw Object.assign(new Error('Comment not found'), { status: 404 });
  const changed = on ? await kv.sadd(`comment:${id}:likes`, userId) : await kv.srem(`comment:${id}:likes`, userId);
  const likes = Math.max(0, (c.likes || 0) + (changed ? (on ? 1 : -1) : 0));
  if (changed) await kv.set(`comment:${id}`, { ...c, likes });
  return { liked: on, likes };
}

export async function deleteComment({ userId, id }) {
  const c = await kv.get(`comment:${id}`);
  if (!c || c.deleted) throw Object.assign(new Error('Comment not found'), { status: 404 });
  if (c.userId !== userId) throw Object.assign(new Error('You can only delete your own comments.'), { status: 403 });
  await kv.set(`comment:${id}`, { ...c, deleted: true, text: '' });
  return { ok: true };
}

/** One report per student; REPORTS_TO_HIDE hide the comment. */
export async function reportComment({ userId, id }) {
  const c = await kv.get(`comment:${id}`);
  if (!c || c.deleted) throw Object.assign(new Error('Comment not found'), { status: 404 });
  if (c.userId === userId) return { ok: true, hidden: Boolean(c.hidden) };
  const added = await kv.sadd(`comment:${id}:reports`, userId);
  if (!added) return { ok: true, hidden: Boolean(c.hidden) };
  const reports = (c.reports || 0) + 1;
  const hidden = reports >= REPORTS_TO_HIDE;
  await kv.set(`comment:${id}`, { ...c, reports, hidden });
  await kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, hidden ? 'comment_hidden' : 'comment_report', 1);
  return { ok: true, hidden };
}
