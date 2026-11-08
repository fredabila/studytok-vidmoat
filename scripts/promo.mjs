// Builds the StudyTok launch promo (9:16, ~45 s) as a real Vidmoat project, using the same
// helpers the lesson composer uses: Vidmoat speech + transcription for a narrator with word
// timings, stock footage, a CC0 music bed, SFX, and the app's own card builders. Prints the
// project id; render it from the Vidmoat editor or with the MCP render tool.
//
// Usage: npm run promo            (needs VIDMOAT_API_KEY; spends ~25 credits on the voice)
//        npm run promo -- --frames  also saves preview frames to data/frames/
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../server/core/config.js';
import { createProject, createSpeech, transcribe, importMedia, previewFrame, searchStock } from '../server/core/vidmoat.js';
import { resolveMusic } from '../server/video/media.js';
import { soundKit } from '../server/video/sfx.js';
import { alignParts } from '../server/video/voice.js';
import { coverScale } from '../server/video/compose.js';
import { teachingVisual, recapCard, stampCard } from '../server/video/visuals.js';
import { flushKv } from '../server/core/kv.js';

const W = 1080, H = 1920;
const HL = '#ffd93d', INK = '#0b0b0b', DARK = '#0d0d0e';
const SERIF = "'DM Serif Display', 'Playfair Display', Georgia, serif";
const SANS = "'Montserrat', 'Inter', sans-serif";
const MONO = "'JetBrains Mono', 'Courier New', monospace";
const RAW = 'https://raw.githubusercontent.com/fredabila/studytok-vidmoat/main/docs/promo/';
const r2 = (n) => Math.round(n * 100) / 100;
const SHADOW = { shadow: true, shadowColor: '#000000', shadowBlur: 18, shadowDistance: 0 };
const T = { footage: 0, image: 1, scrim: 3, card: 4, dim: 5, captions: 6, text: 7, text2: 8, chrome: 12, voice: 15, sfx: 16, music: 17 };

// ---- 1. The narration: one speech call, transcribed for word timings, cut into parts.
const PARTS = [
  { id: 'hook', text: "You can't stop scrolling." },
  { id: 'turn', text: 'So we made the feed teach your course.' },
  { id: 'how1', text: 'StudyTok writes a short video for your exact syllabus, while you scroll.' },
  { id: 'how2', text: 'An AI drafts the lesson, a narrator reads it, real footage and diagrams are cut under it, and it plays about a minute later.' },
  { id: 'formats', text: 'Thirty-two formats, so it never feels the same twice.' },
  { id: 'quiz', text: 'And every video holds at a quick check until you answer.' },
  { id: 'deal', text: "It runs on Vidmoat. It's open source. Your first fifteen lessons are free." },
  { id: 'cta', text: 'Member number one was first. What number will you be? Study Tok dot vidmoat dot com.' },
];
const text = PARTS.map((p) => p.text).join(' ');
console.log('narrating…');
const speech = await createSpeech({ text, provider: 'openai', voiceId: 'marin', maxCredits: 25, instructions: 'A founder launching something they love: warm, confident, energetic, brisk but clear. Tiny pause after each sentence.' });
const tr = await transcribe({ src: speech.url, language: 'en' });
const BRAND = [[/^stardy ?talk|^study ?tok|^studytalk/i, 'StudyTok'], [/^vid ?mo(a|)te?\.?$/i, 'Vidmoat.'], [/^vidmote$/i, 'Vidmoat']];
const words = (tr.words || []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).map((w) => { const fix = BRAND.find(([re]) => re.test(w.text)); return fix ? { ...w, text: /[.,]$/.test(w.text) && !/[.,]$/.test(fix[1]) ? fix[1] + w.text.slice(-1) : fix[1] } : w; });
const voiceDur = tr.mediaSeconds || words.at(-1)?.end;
const { parts } = alignParts(PARTS.map((p) => ({ ...p, pauseBefore: 0 })), voiceDur, words);
const at = Object.fromEntries(parts.map((p) => [p.id, p]));
const TAIL = 2.2;
const duration = r2(voiceDur + TAIL);
at.cta.end = duration; // the last card stays through the tail
console.log(`voice ${voiceDur}s, ${words.length} words →`, parts.map((p) => `${p.id}@${p.start}`).join(' '));

// ---- 2. Media: footage, the app's own screenshots and frames, music, sfx.
async function stock(query, want) {
  const results = await searchStock(query, 'video', 12);
  const pick = results.find((r) => (want ? want(r) : true)) || results[0];
  const media = await importMedia(pick.downloadUrl);
  return { src: media.url, width: pick.width, height: pick.height, mediaDuration: pick.duration, credit: pick.photographer };
}
async function image(name, width, height) {
  const media = await importMedia(RAW + name);
  return { src: media.url, width, height };
}
console.log('media…');
const [scrolling, campus, students, music, sfx] = await Promise.all([
  stock('young man using phone while studying', (r) => r.height > r.width),
  stock('university of ghana legon drone'),
  stock('students walking university campus africa', (r) => r.duration >= 12),
  resolveMusic(['upbeat', 'funky', 'energetic']),
  soundKit(),
]);
const shots = {};
for (const [k, name, w, h] of [['feed', 'app-feed.png', 780, 1328], ['quiz', 'app-quiz.png', 780, 1328], ['profile', 'app-profile.png', 780, 1328]]) shots[k] = await image(name, w, h);
// Five frames over ~3.5 s of narration: 0.7 s cuts read as a montage; 0.5 s reads as flicker.
const FRAMES = ['fmt-wow.jpg', 'fmt-mnemonic.jpg', 'fmt-beforeafter.jpg', 'fmt-realworld.jpg', 'fmt-truefalse.jpg'];
const frames = [];
for (const f of FRAMES) frames.push(await image(f, 1080, 1920));
flushKv();

// ---- 3. Commands.
const cmds = [{ op: 'setProjectSettings', aspectRatio: '9:16', fps: 30, background: DARK }];
let n = 0;
const uid = (p) => `${p}${++n}`;
const footage = (m, start, dur, { zoom = 1.06, filter = 'Cinematic', opacity = 1 } = {}) => {
  const id = uid('ftg');
  const scale = coverScale(m.width, m.height);
  cmds.push({ op: 'addClip', clipId: id, type: 'video', src: m.src, start: r2(start), duration: r2(dur), trackIndex: T.footage, mediaStart: 0, mediaDuration: m.mediaDuration, patch: { scale, volume: 0, muted: true, opacity, ...(m.mediaDuration < dur ? { loop: true } : {}) } },
    { op: 'addKeyframe', clipId: id, prop: 'scale', time: 0, value: scale, easing: 'linear' },
    { op: 'addKeyframe', clipId: id, prop: 'scale', time: r2(dur), value: r2(scale * zoom), easing: 'linear' });
  if (filter) cmds.push({ op: 'applyFilterPreset', clipId: id, preset: filter });
  return id;
};
const picture = (m, start, dur, { scale = 1, y = 0, x = 0, zoom = 1, motion } = {}) => {
  const id = uid('img');
  cmds.push({ op: 'addClip', clipId: id, type: 'image', src: m.src, start: r2(start), duration: r2(dur), trackIndex: T.image, patch: { scale, y, x } });
  if (zoom !== 1) cmds.push({ op: 'addKeyframe', clipId: id, prop: 'scale', time: 0, value: scale, easing: 'linear' }, { op: 'addKeyframe', clipId: id, prop: 'scale', time: r2(dur), value: r2(scale * zoom), easing: 'linear' });
  if (motion) cmds.push({ op: 'applyMotionPreset', clipId: id, preset: motion });
  return id;
};
const dim = (start, dur, opacity, track = T.scrim) => cmds.push({ op: 'addShapeClip', clipId: uid('dim'), kind: 'rectangle', start: r2(start), duration: r2(dur), trackIndex: track, style: { fill: '#000000', fillOpacity: opacity, width: W * 1.3, height: H * 1.3 } });
const label = (txt, start, dur, style, y, track = T.text) => cmds.push({ op: 'addTextClip', clipId: uid('t'), text: txt, start: r2(start), duration: r2(dur), trackIndex: track, style: { fontWeight: 900, color: '#ffffff', ...SHADOW, ...style }, patch: { y } });
const whoosh = (t, vol = 0.4) => sfx.whoosh?.src && cmds.push({ op: 'addClip', clipId: uid('sfx'), type: 'audio', src: sfx.whoosh.src, start: r2(Math.max(0, t)), duration: r2(Math.min(sfx.whoosh.mediaDuration || 1, 1.4)), mediaStart: 0, mediaDuration: sfx.whoosh.mediaDuration, trackIndex: T.sfx, patch: { volume: vol } });
const ding = (t, vol = 0.5) => sfx.ding?.src && cmds.push({ op: 'addClip', clipId: uid('sfx'), type: 'audio', src: sfx.ding.src, start: r2(t), duration: r2(Math.min(sfx.ding.mediaDuration || 1, 1.6)), mediaStart: 0, mediaDuration: sfx.ding.mediaDuration, trackIndex: T.sfx, patch: { volume: vol } });
const captions = (part, y = 600) => {
  const ws = words.filter((w) => w.start >= part.start - 0.05 && w.start < part.end);
  if (ws.length) cmds.push({ op: 'addCaptions', words: ws, keepExisting: true, preset: 'Karaoke', maxWordsPerLine: 4, maxLineDuration: 2.6, trackIndex: T.captions, y });
};
const span = (p) => [at[p].start, at[p].end - at[p].start];

// Pin the composite order: footage, image, scrim, card, dim, captions, text…
for (const [id, track] of [['pinImg', T.image], ['pinScrim', T.scrim], ['pinCard', T.card], ['pinDim', T.dim]]) {
  cmds.push({ op: 'addShapeClip', clipId: id, kind: 'rectangle', start: 0, duration: 0.1, trackIndex: track, style: { fill: '#000000', fillOpacity: 0, width: 4, height: 4 }, patch: { y: 1000 } });
}

// hook: a student scrolling, the line slams in.
{
  const [s, d] = span('hook');
  footage(scrolling, s, d + 0.3, { filter: 'Moody' });
  dim(s, d + 0.3, 0.5);
  label("YOU CAN'T STOP\nSCROLLING.", s + 0.1, d + 0.2, { fontFamily: 'Anton', fontWeight: 400, fontSize: 190, maxWidth: 0.9, lineHeight: 1.02, animIn: 'word-slam', animInDuration: 0.6, outline: '#000000', outlineWidth: 6 }, -80);
}
// turn: the campus, the brand, the promise.
{
  const [s, d] = span('turn');
  footage(campus, s, d, { filter: 'Cinematic', zoom: 1.1 });
  dim(s, d, 0.55);
  whoosh(s - 0.1);
  cmds.push({ op: 'addShapeClip', clipId: uid('cap'), kind: 'capsule', start: r2(s + 0.1), duration: r2(d - 0.1), trackIndex: T.chrome, style: { fill: HL, width: 760, height: 150 }, patch: { y: -520 } });
  label('StudyTok', s + 0.1, d - 0.1, { fontFamily: SERIF, fontWeight: 700, fontSize: 118, color: INK, shadow: false, animIn: 'pop', animInDuration: 0.4 }, -520, T.chrome + 1);
  label('So we made the feed\nteach your course.', s + 0.5, d - 0.5, { fontFamily: SANS, fontWeight: 900, fontSize: 112, maxWidth: 0.9, lineHeight: 1.1, animIn: 'word-pop', animInDuration: 0.6, spans: [{ from: 5, to: 7, color: HL }] }, 60);
}
// how1: the app itself.
{
  const [s, d] = span('how1');
  dim(s, d, 0);
  picture(shots.feed, s, d, { scale: 0.72, y: -40, zoom: 1.03, motion: 'slide-up' });
  whoosh(s - 0.1);
  label('MADE FOR YOUR SYLLABUS', s + 0.3, d - 0.3, { fontFamily: SANS, fontWeight: 800, fontSize: 52, letterSpacing: 8, color: HL, animIn: 'fade-in' }, -860);
  captions(at.how1, 740);
}
// how2: how it is made, as a steps card over the dimmed app.
{
  const [s, d] = span('how2');
  picture(shots.feed, s, d, { scale: 0.72, y: -40 });
  dim(s, d, 0.6, T.dim);
  whoosh(s - 0.1);
  cmds.push(...teachingVisual({ kind: 'steps', title: 'While you scroll', items: ['An AI writes the lesson', 'A narrator reads it', 'Real footage and diagrams', 'Plays about a minute later'], query: '', value: 0, unit: '', svg: '' }, { id: 'steps', start: s + 0.1, duration: d - 0.1, track: T.card, accent: HL, theme: 'paper' }));
  captions(at.how2, 740);
}
// formats: a fast montage of real frames.
{
  const [s, d] = span('formats');
  // Back to back with no overlap (an overlap bumps the next frame onto another layer, and a dim
  // layer in between would then light every other frame differently), and no dim: the frames are dark already.
  const each = r2(d / frames.length);
  frames.forEach((f, i) => { picture(f, s + i * each, i === frames.length - 1 ? d - i * each : each, { scale: coverScale(1080, 1920), zoom: 1.03 }); whoosh(s + i * each - 0.08, 0.3); });
  cmds.push({ op: 'addShapeClip', clipId: uid('cap'), kind: 'capsule', start: r2(s + 0.2), duration: r2(d - 0.2), trackIndex: T.chrome, style: { fill: HL, width: 820, height: 140 }, patch: { y: -835 } });
  label('32 FORMATS', s + 0.2, d - 0.2, { fontFamily: 'Bungee', fontWeight: 400, fontSize: 92, color: INK, shadow: false, animIn: 'bounce', animInDuration: 0.5 }, -835, T.chrome + 1);
  // no captions here: the frames carry their own and the capsule says it
}
// quiz: the hold.
{
  const [s, d] = span('quiz');
  dim(s, d, 0);
  picture(shots.quiz, s, d, { scale: 0.72, y: -40, zoom: 1.03, motion: 'slide-up' });
  ding(s + 0.4);
  label('HOLDS UNTIL YOU ANSWER', s + 0.3, d - 0.3, { fontFamily: 'Anton', fontWeight: 400, fontSize: 96, color: HL, animIn: 'word-slam', animInDuration: 0.5, outline: '#000000', outlineWidth: 6 }, -860);
  captions(at.quiz, 740);
}
// deal: three ticks over the students.
{
  const [s, d] = span('deal');
  footage(students, s, d, { filter: 'Cinematic', zoom: 1.08 });
  dim(s, d, 0.6);
  whoosh(s - 0.1);
  cmds.push(...recapCard({ id: 'deal', start: s + 0.1, duration: d - 0.1, track: T.card, accent: HL, theme: 'dark' }, { items: ['Runs on Vidmoat', 'Open source, MIT', 'First 15 lessons free'], title: 'The deal' }));
  captions(at.deal, 640);
}
// cta: member #1 and the URL.
{
  const [s, d] = span('cta');
  dim(s, d, 0);
  footage(campus, s, d, { filter: 'Cinematic', zoom: 1.08, opacity: 0.45 });
  whoosh(s - 0.1);
  label('StudyTok', s + 0.1, d - 0.1, { fontFamily: SERIF, fontWeight: 700, fontSize: 210, animIn: 'pop', animInDuration: 0.5 }, -700);
  cmds.push(...stampCard({ id: 'member', start: s + 0.6, duration: d - 0.6, track: T.card, accent: HL, theme: 'dark' }, { label: '#1', text: 'was first. What number will you be?', color: HL }));
  cmds.push({ op: 'addShapeClip', clipId: uid('cap'), kind: 'capsule', start: r2(s + 1.2), duration: r2(d - 1.2), trackIndex: T.chrome, style: { fill: HL, width: 940, height: 150 }, patch: { y: 660 } });
  label('studytok.vidmoat.com', s + 1.2, d - 1.2, { fontFamily: MONO, fontWeight: 700, fontSize: 72, color: INK, shadow: false, animIn: 'fade-in' }, 660, T.chrome + 1);
  label('Built by Vidmoat · a Buzz Innovations Ltd. company · free to start', s + 1.6, d - 1.6, { fontFamily: SANS, fontWeight: 600, fontSize: 34, color: 'rgba(255,255,255,.75)', shadow: false, animIn: 'fade-in' }, 820);
  ding(s + 0.6, 0.4);
}

// voice and music
cmds.push({ op: 'addClip', clipId: 'voice', type: 'audio', src: speech.url, start: 0, duration: r2(voiceDur), mediaStart: 0, mediaDuration: voiceDur, trackIndex: T.voice, patch: { volume: 1 } });
if (music?.src) cmds.push({ op: 'musicBed', clipId: 'music', src: music.src, volume: 0.2, fadeIn: 0.6, fadeOut: 1.8, duck: true, voiceClipIds: ['voice'], loop: true, start: 0, end: duration });

for (const c of cmds) if (c.style) for (const k of Object.keys(c.style)) if (c.style[k] === undefined) delete c.style[k];

// ---- 4. Build it.
const res = await createProject('StudyTok · launch promo', cmds);
const failed = res.results.map((r, i) => [r, cmds[i]]).filter(([r]) => !r.ok);
console.log(`project ${res.project.id}: ${cmds.length - failed.length}/${cmds.length} commands applied, ${duration}s, music "${music?.query || '?'}"`);
for (const [r, c] of failed) console.log('  failed:', c.op, c.clipId, r.error);
for (const l of res.verification?.layout || []) if (l.severity !== 'note') console.log(`  lint ${l.severity} @${l.time}s: ${l.message.slice(0, 160)}`);
if (process.argv.includes('--frames')) {
  const dir = join(config.dataDir, 'frames');
  mkdirSync(dir, { recursive: true });
  for (const t of [1.2, at.turn.start + 1.2, at.how1.start + 1.5, at.how2.start + 2.5, at.formats.start + 1.1, at.quiz.start + 1.5, at.deal.start + 2.5, at.cta.start + 2]) {
    writeFileSync(join(dir, `promo-${t.toFixed(1)}.jpg`), await previewFrame(res.project.id, r2(t)));
    console.log('  frame', `promo-${t.toFixed(1)}.jpg`);
  }
}
