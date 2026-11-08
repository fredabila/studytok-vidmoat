// Key-value storage with two interchangeable backends:
//  - Upstash Redis (production / Vercel): used when UPSTASH_REDIS_REST_URL + _TOKEN, or the
//    KV_REST_API_URL + _TOKEN pair that Vercel's Upstash integration sets, are present.
//  - A local in-memory store persisted to data/kv.json (development, tests), which mimics the
//    handful of Redis commands StudyTok uses, with the same return shapes as @upstash/redis.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Redis } from '@upstash/redis';
import { config } from './config.js';

export const usingRedis = Boolean(
  (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
  (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
);

class LocalKV {
  constructor(file) {
    this.file = file;
    this.data = new Map();
    if (file && existsSync(file)) {
      for (const [k, { t, v }] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) {
        this.data.set(k, t === 'set' ? new Set(v) : t === 'zset' ? new Map(v) : v);
      }
    }
  }
  persist() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }
  flush() {
    if (!this.file) return;
    clearTimeout(this.timer);
    const out = {};
    for (const [k, v] of this.data) {
      out[k] = v instanceof Set ? { t: 'set', v: [...v] } : v instanceof Map ? { t: 'zset', v: [...v] } : { t: 'val', v };
    }
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(out));
    renameSync(`${this.file}.tmp`, this.file);
  }
  clone(v) { return v == null ? null : structuredClone(v); }
  async get(k) { return this.clone(this.data.get(k)); }
  async set(k, v) { this.data.set(k, this.clone(v)); this.persist(); return 'OK'; }
  async del(...ks) { let n = 0; for (const k of ks) n += this.data.delete(k) ? 1 : 0; this.persist(); return n; }
  #set(k) { if (!this.data.has(k)) this.data.set(k, new Set()); return this.data.get(k); }
  async sadd(k, ...ms) { const s = this.#set(k); let n = 0; for (const m of ms) if (!s.has(m)) { s.add(m); n++; } this.persist(); return n; }
  async srem(k, ...ms) { const s = this.#set(k); let n = 0; for (const m of ms) n += s.delete(m) ? 1 : 0; this.persist(); return n; }
  async sismember(k, m) { return this.data.get(k)?.has(m) ? 1 : 0; }
  async smismember(k, ms) { const s = this.data.get(k); return ms.map((m) => (s?.has(m) ? 1 : 0)); }
  async scard(k) { return this.data.get(k)?.size || 0; }
  async zadd(k, ...entries) {
    if (!this.data.has(k)) this.data.set(k, new Map());
    const z = this.data.get(k);
    for (const { score, member } of entries) z.set(member, score);
    this.persist();
    return entries.length;
  }
  async zrem(k, ...ms) { const z = this.data.get(k); let n = 0; for (const m of ms) n += z?.delete(m) ? 1 : 0; this.persist(); return n; }
  async zrange(k, start, stop, opts = {}) {
    const z = this.data.get(k);
    if (!z) return [];
    const sorted = [...z].sort((a, b) => (opts.rev ? b[1] - a[1] : a[1] - b[1])).map(([m]) => m);
    return sorted.slice(start, stop === -1 ? undefined : stop + 1);
  }
  async hincrby(k, f, n) { const h = this.data.get(k) || {}; h[f] = (h[f] || 0) + n; this.data.set(k, h); this.persist(); return h[f]; }
  async hgetall(k) { const h = this.data.get(k); return h && Object.keys(h).length ? { ...h } : null; }
  async lpush(k, ...vs) { const l = this.data.get(k) || []; l.unshift(...vs.reverse()); this.data.set(k, l); this.persist(); return l.length; }
  async ltrim(k, start, stop) { const l = this.data.get(k) || []; this.data.set(k, l.slice(start, stop === -1 ? undefined : stop + 1)); this.persist(); return 'OK'; }
  async lrange(k, start, stop) { return (this.data.get(k) || []).slice(start, stop === -1 ? undefined : stop + 1); }
}

if (process.env.VERCEL && !usingRedis) {
  console.warn('[kv] Upstash Redis is not configured: data is kept in /tmp and will be lost. Connect Upstash for Redis to this Vercel project.');
}

export const kv = usingRedis
  ? Redis.fromEnv()
  : new LocalKV(process.env.STUDYTOK_KV_FILE === 'memory' ? null : join(config.dataDir, 'kv.json'));

/** Write pending local changes to disk (no-op for Redis). */
export function flushKv() { if (kv instanceof LocalKV) kv.flush(); }
