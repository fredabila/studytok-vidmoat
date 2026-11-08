// A tiny JSON-file store. Good enough for a prototype and a single process; swap for a real
// database (Postgres, SQLite, Redis) before running more than one server instance.

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

mkdirSync(config.dataDir, { recursive: true });

class Collection {
  constructor(name) {
    this.file = join(config.dataDir, `${name}.json`);
    this.items = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
    this.timer = null;
  }
  get(id) { return this.items[id]; }
  all() { return Object.values(this.items); }
  set(id, value) { this.items[id] = value; this.save(); return value; }
  update(id, fn) { const next = fn(this.items[id]); return this.set(id, next); }
  delete(id) { delete this.items[id]; this.save(); }
  // Debounced, atomic write (write to temp file, then rename).
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }
  flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.items));
    renameSync(tmp, this.file);
  }
}

export const videos = new Collection('videos');   // generated videos (lesson + cached Vidmoat document)
export const users = new Collection('users');     // anonymous viewers: interests, history
export const mediaCache = new Collection('media'); // stock downloadUrl -> imported Vidmoat media

export function flushAll() { for (const c of [videos, users, mediaCache]) c.flush(); }
