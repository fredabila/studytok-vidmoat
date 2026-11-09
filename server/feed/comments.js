// Comments under a lesson: for adults only (core/safety.js capabilitiesOf: minors neither read
// nor post). Every comment is checked before anyone sees it:
//   - no links, email addresses or phone numbers (the commonest ways to pull someone off-platform);
//   - a model reads it and must say it is a respectful, on-topic study comment (fails closed);
//   - at most COMMENTS_PER_DAY per student and one every MIN_GAP_MS;
//   - REPORTS_TO_HIDE reports from different students hide it until someone reviews it.
// Names show as first name and initial ("Ama K."), never the email. Students delete their own.

import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { kv } from '../core/kv.js';
import { claude } from '../core/claude.js';
import { config } from '../core/config.js';

export const MAX_LEN = 300;
export const COMMENTS_PER_DAY = 20;
export const MIN_GAP_MS = 15_000;
export const REPORTS_TO_HIDE = 3;
const KEEP = 500;

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|me|ly|gg|app|co|xyz|info|link|tv)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /(\+?\d[\d\s().-]{6,}\d)/;
const CONTACT = /\b(whats\s*app|telegram|snap(chat)?|insta(gram)?|dm me|text me|call me|my number)\b/i;

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

/** "Ama K." from the Vidmoat account name; "A student" without one. */
export function displayName(user) {
  const parts = String(user?.vidmoat?.name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'A student';
  return parts.length > 1 ? `${parts[0].slice(0, 20)} ${parts.at(-1)[0].toUpperCase()}.` : parts[0].slice(0, 20);
}

const view = (c, userId) => ({ id: c.id, name: c.name, text: c.text, at: c.at, mine: c.userId === userId });

/** Visible comments on a lesson, newest first: { comments, count }. */
export async function listComments(videoId, userId, { limit = 50 } = {}) {
  const ids = await kv.lrange(`comments:${videoId}`, 0, KEEP - 1);
  const all = (await Promise.all(ids.map((id) => kv.get(`comment:${id}`)))).filter((c) => c && !c.hidden && !c.deleted);
  return { comments: all.slice(0, limit).map((c) => view(c, userId)), count: all.length };
}

/** Posts a comment after the checks; throws 400/429 with a message for the author. */
export async function postComment({ user, videoId, text, moderate, now = Date.now() }) {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  if (body.length < 2) throw Object.assign(new Error('Write something first.'), { status: 400 });
  if (body.length > MAX_LEN) throw Object.assign(new Error(`Keep it under ${MAX_LEN} characters.`), { status: 400 });
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
  const c = { id: randomUUID(), videoId, userId: user.id, name: displayName(user), text: body, at: new Date(now).toISOString(), reports: 0 };
  await kv.set(`comment:${c.id}`, c);
  await kv.lpush(`comments:${videoId}`, c.id);
  await kv.ltrim(`comments:${videoId}`, 0, KEEP - 1);
  await kv.hincrby(`events:day:${day}`, 'comment', 1);
  return view(c, user.id);
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
