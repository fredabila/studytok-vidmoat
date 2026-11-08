// StudyTok feed: vertical snap scrolling, a small window of live Vidmoat players around the
// active slide, on-the-fly generation (poll until ready), and engagement events.

import { VidmoatPlayer } from './player.js';

const $ = (s, el = document) => el.querySelector(s);
const PLAYER_WINDOW = 1;   // keep players mounted for active ±1
const LOAD_MORE_AT = 2;    // fetch more when this many slides remain below the active one
const SKIP_SEC = 2;        // leaving before this counts as a skip

let cfg;
const items = [];          // { data, el, player, polling, viewSent, completed, watched, lastTime }
let active = -1;
let loadingMore = false;
let userPaused = false;

// ---------------------------------------------------------------- API
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}
const sendEvent = (videoId, type, extra = {}) => api('POST', '/api/events', { videoId, type, ...extra }).catch(() => {});

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------- onboarding
async function showOnboarding(current = []) {
  const box = $('#topics');
  box.replaceChildren();
  const chosen = new Set(current);
  for (const t of cfg.topics) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'topic';
    b.style.setProperty('--accent', t.accent);
    b.setAttribute('aria-pressed', String(chosen.has(t.id)));
    b.innerHTML = `<span class="emoji" aria-hidden="true"></span><span class="label"></span>`;
    $('.emoji', b).textContent = t.emoji;
    $('.label', b).textContent = t.label;
    b.onclick = () => {
      chosen.has(t.id) ? chosen.delete(t.id) : chosen.add(t.id);
      b.setAttribute('aria-pressed', String(chosen.has(t.id)));
      $('#start').disabled = chosen.size === 0;
    };
    box.appendChild(b);
  }
  $('#start').disabled = chosen.size === 0;
  $('#start').textContent = current.length ? 'Save interests' : 'Start learning';
  $('#onboard').hidden = false;
  $('#app').hidden = true;

  await new Promise((resolve) => { $('#start').onclick = resolve; });
  await api('POST', '/api/session', { interests: [...chosen] });
  $('#onboard').hidden = true;
  $('#app').hidden = false;
}

// ---------------------------------------------------------------- slides
function addSlide(data) {
  const el = $('#slide-tpl').content.firstElementChild.cloneNode(true);
  const item = { data, el, player: null, polling: false, viewSent: false, completed: false, watched: 0, lastTime: 0, enteredAt: 0 };
  el.dataset.index = String(items.length);
  items.push(item);
  render(item);

  $('.tap', el).onclick = () => togglePause(item);
  $('.like', el).onclick = () => toggleLike(item);
  $('.less', el).onclick = () => {
    sendEvent(item.data.id, 'less');
    toast(`Got it: less ${item.data.topic.label}`);
    scrollToIndex(items.indexOf(item) + 1);
  };
  $('.replay', el).onclick = () => { if (item.player) { item.player.seek(0); item.player.play(); userPaused = false; setPaused(item, false); } };

  $('#feed').appendChild(el);
  observer.observe(el);
  if (data.status === 'generating') poll(item);
  return item;
}

function render(item) {
  const { data, el } = item;
  el.style.setProperty('--accent', data.topic.accent);
  $('.cover-topic', el).textContent = `${data.topic.emoji} ${data.topic.label}`;
  $('.cover-hook', el).textContent = data.hook || 'Finding something good to learn…';
  $('.chip', el).textContent = `${data.topic.emoji} ${data.topic.label}${data.subtopic ? ` · ${data.subtopic}` : ''}`;
  $('.title', el).textContent = data.title || '';
  $('.like .count', el).textContent = String(data.likes || 0);
  $('.like', el).setAttribute('aria-pressed', String(!!data.liked));
  const credits = [...new Set((data.credits || []).map((c) => c.by).filter(Boolean))];
  $('.credits', el).textContent = credits.length ? `Footage & music: ${credits.slice(0, 3).join(', ')} (stock)` : '';
  const poster = $('.poster', el);
  if (data.poster && poster.getAttribute('src') !== data.poster) poster.src = data.poster;
  el.dataset.status = data.status;
  $('.status-text', el).textContent =
    data.status === 'failed' ? 'This one did not work out. Swipe for the next.' :
    data.status === 'ready' ? 'Loading player…' : 'Generating your video…';
}

async function poll(item) {
  if (item.polling) return;
  item.polling = true;
  let delay = 1200;
  while (item.data.status === 'generating') {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.25, 4000);
    try {
      const { item: fresh } = await api('GET', `/api/videos/${item.data.id}`);
      item.data = fresh;
      render(item);
    } catch { /* transient: keep polling */ }
  }
  item.polling = false;
  syncPlayers();
}

// ---------------------------------------------------------------- players
function mountPlayer(item) {
  if (item.player || item.data.status !== 'ready') return;
  const host = $('.player-host', item.el);
  const duration = item.data.duration || 0;
  item.player = new VidmoatPlayer(host, cfg.playerOrigin, {
    onLoaded: () => {
      item.el.dataset.loaded = 'true';
      if (items[active] === item && !userPaused) item.player.play();
    },
    onState: ({ time, playing }) => onState(item, time, playing, duration),
    onError: (msg) => {
      item.el.dataset.status = 'failed';
      $('.status-text', item.el).textContent = msg;
    },
  });
  item.player.load(item.data.document, 0);
}

function unmountPlayer(item) {
  if (!item.player) return;
  item.player.destroy();
  item.player = null;
  delete item.el.dataset.loaded;
}

function onState(item, time, playing, duration) {
  const isActive = items[active] === item;
  if (playing && isActive && time > item.lastTime) item.watched += Math.min(time - item.lastTime, 0.5);
  item.lastTime = time;
  $('.bar', item.el).style.transform = `scaleX(${duration ? Math.min(1, time / duration) : 0})`;

  // Loop at the end, TikTok-style, and count a completion once.
  if (duration && time >= duration - 0.15 && isActive) {
    if (!item.completed) { item.completed = true; sendEvent(item.data.id, 'complete'); }
    item.lastTime = 0;
    item.player.seek(0);
    if (!userPaused) item.player.play();
  }
  // Players outside the active slot must stay silent.
  if (!isActive && playing) item.player.pause();
}

function syncPlayers() {
  items.forEach((item, i) => {
    const near = active >= 0 && Math.abs(i - active) <= PLAYER_WINDOW;
    if (near) mountPlayer(item); else unmountPlayer(item);
    if (item.player) {
      if (i === active && !userPaused) item.player.play();
      else item.player.pause();
    }
  });
}

function setPaused(item, paused) { item.el.dataset.paused = String(paused); }

function togglePause(item) {
  if (!item.player) return;
  userPaused = !userPaused;
  userPaused ? item.player.pause() : item.player.play();
  setPaused(item, userPaused);
}

async function toggleLike(item) {
  const liked = !item.data.liked;
  item.data.liked = liked;
  item.data.likes = Math.max(0, (item.data.likes || 0) + (liked ? 1 : -1));
  render(item);
  sendEvent(item.data.id, liked ? 'like' : 'unlike');
}

// ---------------------------------------------------------------- activation & paging
function activate(index) {
  if (index === active) return;
  const prev = items[active];
  if (prev) {
    const left = prev.watched;
    if (!prev.completed && left < SKIP_SEC && prev.data.status === 'ready') sendEvent(prev.data.id, 'skip');
    if (left > 0) sendEvent(prev.data.id, 'leave', { watchedSec: Math.round(left) });
    setPaused(prev, false);
  }
  active = index;
  userPaused = false;
  const item = items[index];
  item.watched = 0;
  item.lastTime = 0;
  item.completed = false;
  if (item.player?.loaded) item.player.seek(0);
  syncPlayers();

  // Count a view once the viewer has stayed a moment.
  clearTimeout(activate.viewTimer);
  activate.viewTimer = setTimeout(() => {
    if (items[active] === item && !item.viewSent && item.data.status === 'ready') { item.viewSent = true; sendEvent(item.data.id, 'view'); }
  }, 1000);

  if (items.length - 1 - index <= LOAD_MORE_AT) loadMore();
}

async function loadMore(count = 3) {
  if (loadingMore) return;
  loadingMore = true;
  try {
    const { items: next } = await api('GET', `/api/feed?count=${count}`);
    next.forEach(addSlide);
    syncPlayers();
  } catch (err) {
    if (err.status === 401) return location.reload();
    toast('Could not load more videos. Retrying…');
    setTimeout(() => loadMore(count), 3000);
  } finally {
    loadingMore = false;
  }
}

const observer = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) activate(Number(e.target.dataset.index));
}, { root: null, threshold: [0.6] });

function scrollToIndex(i) {
  const el = items[i]?.el;
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if ($('#app').hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); scrollToIndex(active + 1); }
    if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); scrollToIndex(Math.max(0, active - 1)); }
    if (e.key === ' ') { e.preventDefault(); if (items[active]) togglePause(items[active]); }
  });
  document.addEventListener('visibilitychange', () => {
    const item = items[active];
    if (!item?.player) return;
    if (document.hidden) item.player.pause(); else if (!userPaused) item.player.play();
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  cfg = await api('GET', '/api/config');
  wireKeys();
  $('#edit-interests').onclick = async () => {
    const { user } = await api('GET', '/api/me');
    items[active]?.player?.pause();
    await showOnboarding(Object.keys(user.interests).filter((k) => user.interests[k] > 0));
    toast('Interests saved. New videos will follow them.');
    if (items[active]?.player && !userPaused) items[active].player.play();
  };

  try {
    await api('GET', '/api/me');
  } catch (err) {
    if (err.status !== 401) throw err;
    await showOnboarding();
  }
  $('#onboard').hidden = true;
  $('#app').hidden = false;
  await loadMore(3);
}

boot().catch((err) => {
  console.error(err);
  toast('StudyTok could not start. Is the server running?');
});
