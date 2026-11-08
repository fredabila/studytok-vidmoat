// Key-value storage with two interchangeable backends:
//  - Upstash Redis (production / Vercel): used when UPSTASH_REDIS_REST_URL + _TOKEN, or the
//    KV_REST_API_URL + _TOKEN pair that Vercel's Upstash integration sets, are present.
//  - A local in-memory store persisted to data/kv.json (development, tests), which mimics the
//    handful of Redis commands StudyTok uses, with the same return shapes as @upstash/redis.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Redis } from '@upstash/redis';
import { config } from './config.js';

// Find Upstash REST credentials under any prefix. The Vercel Marketplace integration sets
// KV_REST_API_URL / KV_REST_API_TOKEN by default, but lets you pick a custom prefix
// (e.g. STORAGE_KV_REST_API_URL), and Upstash's own docs use UPSTASH_REDIS_REST_URL / _TOKEN.
export function findRedisCredentials(env = process.env) {
  const pairs = [
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ];
  for (const name of Object.keys(env).sort()) {
    const m = /^(.*?)(KV_REST_API_URL|REDIS_REST_URL|REST_API_URL)$/.exec(name);
    if (m && !pairs.some(([u]) => u === name)) pairs.push([name, `${m[1]}${m[2].replace(/URL$/, 'TOKEN')}`]);
  }
  for (const [urlVar, tokenVar] of pairs) {
    const url = env[urlVar], token = env[tokenVar];
    if (url && token && /^https:\/\//.test(url)) return { url, token, urlVar, tokenVar };
  }
  return null;
}

/** Names (never values) of environment variables that look like Redis settings, for /api/health. */
export const redisLikeVarNames = (env = process.env) =>
  Object.keys(env).filter((k) => /REDIS|KV_|UPSTASH/i.test(k)).sort();

const redisCreds = findRedisCredentials();
export const usingRedis = Boolean(redisCreds);
export const redisSource = redisCreds ? redisCreds.urlVar : null;

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
  #expired(k) {
    const at = this.expiry?.get(k);
    if (at && Date.now() >= at) { this.data.delete(k); this.expiry.delete(k); return true; }
    return false;
  }
  async get(k) { this.#expired(k); return this.clone(this.data.get(k)); }
  /** Supports the Upstash options used here: { nx: true } (only if absent) and { ex: seconds }. */
  async set(k, v, opts = {}) {
    this.#expired(k);
    if (opts.nx && this.data.has(k)) return null;
    this.data.set(k, this.clone(v));
    this.expiry ??= new Map();
    if (opts.ex) this.expiry.set(k, Date.now() + opts.ex * 1000); else this.expiry.delete(k);
    this.persist();
    return 'OK';
  }
  async del(...ks) { let n = 0; for (const k of ks) n += this.data.delete(k) ? 1 : 0; this.persist(); return n; }
  #set(k) { if (!this.data.has(k)) this.data.set(k, new Set()); return this.data.get(k); }
  async sadd(k, ...ms) { const s = this.#set(k); let n = 0; for (const m of ms) if (!s.has(m)) { s.add(m); n++; } this.persist(); return n; }
  async srem(k, ...ms) { const s = this.#set(k); let n = 0; for (const m of ms) n += s.delete(m) ? 1 : 0; this.persist(); return n; }
  async sismember(k, m) { return this.data.get(k)?.has(m) ? 1 : 0; }
  async smismember(k, ms) { const s = this.data.get(k); return ms.map((m) => (s?.has(m) ? 1 : 0)); }
  async scard(k) { return this.data.get(k)?.size || 0; }
  async smembers(k) { return [...(this.data.get(k) || [])]; }
  async zadd(k, ...entries) {
    if (!this.data.has(k)) this.data.set(k, new Map());
    const z = this.data.get(k);
    for (const { score, member } of entries) z.set(member, score);
    this.persist();
    return entries.length;
  }
  async zincrby(k, by, m) { if (!this.data.has(k)) this.data.set(k, new Map()); const z = this.data.get(k); z.set(m, (z.get(m) || 0) + by); this.persist(); return z.get(m); }
  async zrem(k, ...ms) { const z = this.data.get(k); let n = 0; for (const m of ms) n += z?.delete(m) ? 1 : 0; this.persist(); return n; }
  async scan(cursor, opts = {}) {
    const re = new RegExp('^' + String(opts.match || '*').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return ['0', [...this.data.keys()].filter((k) => re.test(k))];
  }
  async zcount(k, min, max) { let n = 0; for (const s of (this.data.get(k) || new Map()).values()) if (s >= min && s <= max) n++; return n; }
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
  async rpush(k, ...vs) { const l = this.data.get(k) || []; l.push(...vs.map((v) => this.clone(v))); this.data.set(k, l); this.persist(); return l.length; }
  async lpop(k) { const l = this.data.get(k); if (!l?.length) return null; const v = l.shift(); this.persist(); return v; }
  async llen(k) { return (this.data.get(k) || []).length; }
  async lrange(k, start, stop) { return (this.data.get(k) || []).slice(start, stop === -1 ? undefined : stop + 1); }
}

if (process.env.VERCEL && !usingRedis) {
  console.warn('[kv] Upstash Redis is not configured: data is kept in /tmp and will be lost. Connect Upstash for Redis to this Vercel project.');
}

export const kv = usingRedis
  ? new Redis({ url: redisCreds.url, token: redisCreds.token })
  : new LocalKV(process.env.STUDYTOK_KV_FILE === 'memory' ? null : join(config.dataDir, 'kv.json'));

/** Every key matching a glob pattern (SCAN; admin jobs only, never on a request path). */
export async function scanKeys(pattern, limit = 10000) {
  const out = [];
  let cursor = '0';
  do {
    const [next, keys] = await kv.scan(cursor, { match: pattern, count: 1000 });
    out.push(...keys);
    cursor = String(next);
  } while (cursor !== '0' && out.length < limit);
  return out;
}

/** Write pending local changes to disk (no-op for Redis). */
export function flushKv() { if (kv instanceof LocalKV) kv.flush(); }
