// Pre-generates videos so the first students never wait for generation, and warms the shared
// sound-effects kit and music pool. Works against whichever storage is configured: run
// `vercel env pull .env` first to warm the production Upstash Redis library from your machine.
//
// Usage: npm run warm -- [perUnit=1] [target ...] [--level=high-school] [--exam=WASSCE] [--country=Ghana]
//   target: a catalog program (cat:hs-biology), a researched program key (res:…), or topic:<id>
//   (default: every interest topic, for "just curious" viewers)
import { INTEREST_TOPICS } from '../server/topics.js';
import { startVideo } from '../server/generator.js';
import { readyIds, getVideo } from '../server/db.js';
import { getProgram, getUnit, interestUnit } from '../server/curriculum.js';
import { lessonKey } from '../server/lessons/index.js';
import { audienceFor } from '../server/feed.js';
import { soundKit } from '../server/sfx.js';
import { resolveMusic } from '../server/media.js';
import { usingRedis, flushKv } from '../server/kv.js';

const args = process.argv.slice(2);
const opt = (name, d = '') => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') || d;
const perUnit = Number(args.find((a) => /^\d+$/.test(a))) || 1;
const targets = args.filter((a) => !/^\d+$/.test(a) && !a.startsWith('--'));
const audience = audienceFor({ profile: { level: opt('level', targets.length ? 'high-school' : 'lifelong'), exam: opt('exam'), country: opt('country') } });

console.log(`Storage: ${usingRedis ? 'Upstash Redis' : 'local file'} · level ${audience.level}${audience.exam ? ` · ${audience.exam}` : ''}`);
const kit = await soundKit();
console.log(`Sound kit: ${Object.entries(kit).map(([k, v]) => `${k} ${v ? 'ok' : 'missing'}`).join(', ')}`);
for (let i = 0; i < 3; i++) await resolveMusic();

const units = [];
for (const t of targets.length ? targets : INTEREST_TOPICS.map((x) => `topic:${x.id}`)) {
  if (t.startsWith('topic:')) { const u = interestUnit(t.slice(6)); if (u) units.push(u); continue; }
  const program = await getProgram(t);
  if (!program?.units?.length) { console.warn(`Unknown or unfinished program: ${t}`); continue; }
  for (const u of program.units) units.push(await getUnit(u.id));
}

const started = [];
for (const unit of units.filter(Boolean)) {
  const have = (await readyIds(lessonKey(unit.id, audience), perUnit)).length;
  for (let i = have; i < perUnit; i++) started.push(await startVideo(unit, audience, { requestedBy: 'warm' }));
}
console.log(`Generating ${started.length} video(s) for ${units.length} unit(s)…`);
let done = 0;
await Promise.all(started.map((s) => s.done.then(() => process.stdout.write(`\r${++done}/${started.length} done`))));
const results = await Promise.all(started.map((s) => getVideo(s.video.id)));
const failed = results.filter((v) => v.status !== 'ready');
console.log(`\nReady: ${results.length - failed.length}, failed: ${failed.length}`);
for (const v of failed) console.log(`  ${v.id} (${v.unitTitle}): ${v.error}`);
flushKv();
