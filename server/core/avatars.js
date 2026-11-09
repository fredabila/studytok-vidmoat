// Course pictures. The student who brought a course can give its profile a picture. The app crops
// and re-encodes it in the browser (a square, at most 320 px, which also drops EXIF data such as
// GPS location); the server checks it really is a small JPEG, PNG or WebP, and has Claude look
// at it before anyone else sees it. StudyGraph is used by children and teenagers, so the check
// is strict and fails closed: no faces or personal photos, nothing sexual, violent, hateful,
// frightening or drug-related, no text that bullies or advertises. Approved pictures are stored
// in KV and served from /a/<id> with a year-long cache (a new picture gets a new id).
//
// Storage:  avatar:<id>  JSON { type, b64, at }

import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { kv } from './kv.js';
import { claude } from './claude.js';
import { config } from './config.js';

export const AVATAR_MAX_BYTES = 200 * 1024;
const TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

/** A data URL from the app → { type, buf }. Throws (400) on anything else. */
export function decodeAvatar(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Send a JPEG, PNG or WebP picture.');
  const type = m[1];
  if (m[2].length > Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 4) throw bad('That picture is too large (200 KB at most).');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > AVATAR_MAX_BYTES) throw bad('That picture is too large (200 KB at most).');
  const magic = TYPES[type];
  if (!magic.every((b, i) => buf[i] === b) || (type === 'image/webp' && buf.subarray(8, 12).toString('ascii') !== 'WEBP')) throw bad('That file is not the picture it says it is.');
  return { type, buf };
}

const SYSTEM = `You check profile pictures for StudyGraph, a study-video app used by students aged 11 and up, including children. A picture is the avatar of a course (like "Chess openings" or "Organic chemistry"), shown publicly next to its lessons.

Approve only pictures that suit a school: a logo, icon, drawing, illustration, diagram, object, animal, plant, building, landscape or other scene. Reject a picture if any of these apply:
- it shows a real person's face or a recognisable person (privacy: course pictures must not be photos of people, including selfies), even a partial one;
- nudity, sexual content or suggestive poses;
- violence, gore, weapons used against people, self-harm;
- hate symbols, extremist imagery, slurs or bullying text;
- drugs, alcohol, smoking, gambling;
- frightening or disturbing imagery for a child;
- personal information (names with addresses, phone numbers, ID cards, school uniforms with names) or a QR code;
- advertising, a brand logo used as if it were the course's own, or a link.
When unsure, reject. The reason is shown to the student: one short, kind sentence saying what to change, never repeating anything offensive.`;

const VerdictSchema = z.object({
  ok: z.boolean().describe('true only if the picture is suitable under every rule'),
  reason: z.string().describe('one short, kind sentence for the student; when ok, ""'),
});

async function askClaude({ type, buf }) {
  const response = await claude().messages.parse({
    model: config.anthropic.reviewModel,
    max_tokens: 300,
    output_config: { effort: 'low', format: zodOutputFormat(VerdictSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: type, data: buf.toString('base64') } },
      { type: 'text', text: 'Is this picture suitable as a course picture under the rules?' },
    ] }],
  });
  return response.parsed_output;
}

/**
 * { ok, reason }. Fails closed: with no model configured, or if the check errors, the picture is
 * not approved.
 */
export async function moderateAvatar(image, { ask = askClaude } = {}) {
  if (ask === askClaude && !config.anthropic.enabled) return { ok: false, reason: 'Pictures cannot be checked right now, so they cannot be added. Try again later.' };
  try {
    const v = await ask(image);
    if (v?.ok === true) return { ok: true, reason: '' };
    return { ok: false, reason: String(v?.reason || 'This picture cannot be used. Try a logo, drawing or object instead.').slice(0, 200) };
  } catch (err) {
    console.warn('[avatar] check failed:', err.message);
    return { ok: false, reason: 'We could not check that picture. Please try again in a moment.' };
  }
}

/** Stores an approved picture; returns its id. */
export async function storeAvatar({ type, buf }) {
  const id = randomUUID().replace(/-/g, '');
  await kv.set(`avatar:${id}`, { type, b64: buf.toString('base64'), at: new Date().toISOString() });
  return id;
}
export const dropAvatar = (id) => (id ? kv.del(`avatar:${id}`) : 0);

/** { type, buf } or null. */
export async function getAvatar(id) {
  if (!/^[0-9a-f]{32}$/.test(String(id || ''))) return null;
  const rec = await kv.get(`avatar:${id}`);
  return rec?.b64 ? { type: rec.type, buf: Buffer.from(rec.b64, 'base64') } : null;
}
export const avatarPath = (avatar) => (avatar?.id ? `/a/${avatar.id}` : null);
