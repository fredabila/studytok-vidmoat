// The lesson search index (search:lessons): one hash entry per ready lesson with the text it is
// found by and what a search result shows. Filed by db.markReady; feed/discover.js reads it and
// backfills lessons made before it existed.
import { kv } from './kv.js';
import { TOPIC_BY_ID } from '../curriculum/topics.js';

const clean = (s, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** What a lesson is found by: its title, hook, unit, subtopic, topic and key terms. */
export const searchText = (v) => clean([v.lesson?.title, v.lesson?.hook, v.unitTitle, v.lesson?.subtopic, TOPIC_BY_ID[v.topic]?.label, ...(v.lesson?.concept?.keyTerms || [])].filter(Boolean).join(' ')).toLowerCase();

export const indexLesson = (v) => kv.hset('search:lessons', { [v.id]: { s: searchText(v), t: v.lesson?.title || v.unitTitle || 'Lesson', p: v.poster || null, d: v.duration || null, f: v.format || 'explain', tp: v.topic || null, lv: v.level || null, loc: v.loc || null, u: v.unitId || null, ut: v.unitTitle || null, at: Date.parse(v.createdAt) || 0 } });
