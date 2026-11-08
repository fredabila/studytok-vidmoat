// Pre-generates videos so the first viewers never wait for generation.
// Works against whichever storage is configured: run `vercel env pull .env` first to warm the
// production Upstash Redis library from your machine.
// Usage: npm run warm -- [perTopic=2] [topicId ...]
import { TOPICS } from '../server/topics.js';
import { startVideo } from '../server/generator.js';
import { readyIds, getVideo } from '../server/db.js';
import { usingRedis, flushKv } from '../server/kv.js';

const args = process.argv.slice(2);
const perTopic = Number(args.find((a) => /^\d+$/.test(a))) || 2;
const only = args.filter((a) => !/^\d+$/.test(a));
const topics = only.length ? TOPICS.filter((t) => only.includes(t.id)) : TOPICS;

console.log(`Storage: ${usingRedis ? 'Upstash Redis' : 'local file'}`);
const started = [];
for (const t of topics) {
  const have = (await readyIds(t.id, perTopic)).length;
  for (let i = have; i < perTopic; i++) started.push(await startVideo(t.id));
}
console.log(`Generating ${started.length} video(s)…`);
let done = 0;
await Promise.all(started.map((s) => s.done.then(() => process.stdout.write(`\r${++done}/${started.length} done`))));
const results = await Promise.all(started.map((s) => getVideo(s.video.id)));
const failed = results.filter((v) => v.status !== 'ready');
console.log(`\nReady: ${results.length - failed.length}, failed: ${failed.length}`);
for (const v of failed) console.log(`  ${v.id} (${v.topic}): ${v.error}`);
flushKv();
