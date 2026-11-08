// Pre-generates videos so the first viewers never wait for generation.
// Usage: npm run warm -- [perTopic=2] [topicId ...]
import { TOPICS } from '../server/topics.js';
import { startVideo } from '../server/generator.js';
import { videos, flushAll } from '../server/store.js';

const args = process.argv.slice(2);
const perTopic = Number(args.find((a) => /^\d+$/.test(a))) || 2;
const only = args.filter((a) => !/^\d+$/.test(a));
const topics = only.length ? TOPICS.filter((t) => only.includes(t.id)) : TOPICS;

const ids = [];
for (const t of topics) {
  const have = videos.all().filter((v) => v.topic === t.id && v.status === 'ready').length;
  for (let i = have; i < perTopic; i++) ids.push(startVideo(t.id).id);
}
console.log(`Generating ${ids.length} video(s)…`);
while (ids.some((id) => videos.get(id).status === 'generating')) {
  await new Promise((r) => setTimeout(r, 2000));
  const done = ids.filter((id) => videos.get(id).status !== 'generating').length;
  process.stdout.write(`\r${done}/${ids.length} done`);
}
const failed = ids.filter((id) => videos.get(id).status === 'failed');
console.log(`\nReady: ${ids.length - failed.length}, failed: ${failed.length}`);
for (const id of failed) console.log(`  ${id}: ${videos.get(id).error}`);
flushAll();
