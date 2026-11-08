// StudyTok client.
//  - Onboarding: level -> studies -> syllabus (catalog match or live course research).
//  - Feed: a paging controller (drag/flick, wheel/trackpad, keys, buttons) over a track of
//    slides; live Vidmoat players only for the active slide ±1; ready videos are moved ahead of
//    ones still being made; tap = pause, double-tap = like; tap-to-answer quizzes.
//  - Library (course progress, saved, history) and Profile (Sign in with Vidmoat, install).
//  - PWA: service worker + install prompt.

import { VidmoatPlayer } from './player.js';
import { track, flush, WatchTracker } from './telemetry.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP_SEC = 2;
const SCHOOL_LEVELS = new Set(['middle-school', 'high-school']);
const LEVEL_INFO = {
  'middle-school': 'Junior high, ages 11–14',
  'high-school': 'Senior high & national exams',
  university: 'Undergraduate courses',
  postgraduate: "Master's & PhD",
  professional: 'Certifications & licensing',
  lifelong: 'No course: just learn',
};
const COUNTRIES = ['Ghana', 'Nigeria', 'Kenya', 'South Africa', 'Uganda', 'Tanzania', 'Rwanda', 'Ethiopia', 'Egypt', 'Morocco', 'Cameroon', "Côte d'Ivoire", 'Senegal', 'Zambia', 'Zimbabwe', 'Botswana', 'Malawi', 'United States', 'Canada', 'United Kingdom', 'Ireland', 'Germany', 'France', 'Spain', 'Italy', 'Netherlands', 'Sweden', 'Poland', 'Turkey', 'India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal', 'China', 'Japan', 'South Korea', 'Singapore', 'Malaysia', 'Indonesia', 'Philippines', 'Vietnam', 'Thailand', 'Australia', 'New Zealand', 'Brazil', 'Mexico', 'Argentina', 'Colombia', 'Chile', 'Peru', 'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Jamaica', 'Trinidad and Tobago'];

let cfg;
let me = null;               // the signed-in StudyTok user (from /api/me)
let view = 'feed';
let installPrompt = null;     // deferred beforeinstallprompt event

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ============================================================================ utilities
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/me') && path !== '/api/profile') sessionLost();
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}
let recovering = false;
function sessionLost() {
  if (recovering) return;
  recovering = true;
  toast('Your session expired. Please sign in again.');
  setTimeout(() => location.replace('/'), 1200);
}
const sendEvent = (videoId, type, extra = {}) => track(type, { videoId, ...extra });
let nthVideo = 0; // videos viewed this page load
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v; // CSSOM: allowed by the CSP (style attributes are not)
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ============================================================================ onboarding
const ob = { level: null, step: 1, profile: {}, interests: new Set(), programs: [], selected: new Set(), who: 'self' };
const ageOf = () => { const n = Number($('#ob-age').value); return Number.isInteger(n) && n >= 5 && n <= 120 ? n : null; };
const ageBand = (age) => (age == null ? '' : age < 13 ? 'under13' : age < 18 ? '13-17' : '18+');
/** Who the profile is for, and the rules: under-18s are set up by a parent or guardian on the adult's Vidmoat account. */
function wireWho() {
  const draw = () => {
    $$('#ob-who [data-who]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.who === ob.who)));
    $('#ob-age-label').textContent = ob.who === 'child' ? "Your child's age" : 'Your age';
    $('#ob-consent').hidden = ob.who !== 'child';
    $('#ob-minor-note').hidden = true;
  };
  $$('#ob-who [data-who]').forEach((b) => { b.onclick = () => { ob.who = b.dataset.who; draw(); }; });
  draw();
}
function validateWho() {
  const age = ageOf();
  if (age == null) { toast('Please enter an age (5 to 120).'); $('#ob-age').focus(); return false; }
  if (ob.who === 'self' && age < 18) { $('#ob-minor-note').hidden = false; toast('A parent or guardian needs to set this up.'); return false; }
  if (ob.who === 'child' && !$('#ob-consent-box').checked) { toast('Please confirm you are the parent or guardian.'); return false; }
  return true;
}

function showStep(n) {
  if (n === 2 && ob.step === 1 && !validateWho()) return;
  ob.step = n;
  $$('#onboard .step').forEach((s) => { s.hidden = s.dataset.step !== String(n); });
  $$('#onboard [data-step-action]').forEach((b) => { b.hidden = b.dataset.stepAction !== String(n); });
  $('.ob-progress i').style.width = `${(n / 3) * 100}%`;
  $('.ob-progress').setAttribute('aria-valuenow', String(n));
  $('.ob-back').hidden = n === 1;
  $('.ob-body').scrollTo(0, 0);
}

function renderLevels() {
  $('#levels').replaceChildren(...cfg.levels.map((l) => el('button', {
    type: 'button', class: 'level-card', role: 'radio', 'aria-checked': String(ob.level === l.id), onclick: () => chooseLevel(l.id),
  }, el('span', { class: 'emoji', 'aria-hidden': 'true' }, l.emoji), el('strong', {}, l.label), el('small', {}, LEVEL_INFO[l.id] || ''))));
}

function renderTopics() {
  $('#topics').replaceChildren(...cfg.topics.map((t) => {
    const b = el('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(ob.interests.has(t.id)) }, `${t.emoji} ${t.label}`);
    b.style.setProperty('--accent', t.accent);
    b.onclick = () => {
      ob.interests.has(t.id) ? ob.interests.delete(t.id) : ob.interests.add(t.id);
      b.setAttribute('aria-pressed', String(ob.interests.has(t.id)));
      updateStart();
    };
    return b;
  }));
}

async function chooseLevel(id) {
  ob.level = id;
  renderLevels();
  const form = $('#details');
  $$('[data-hide-for]', form).forEach((f) => { f.hidden = f.dataset.hideFor.split(' ').includes(id); });
  const school = SCHOOL_LEVELS.has(id);
  $('[data-label-program]').textContent = school ? 'Subjects' : 'Course or program';
  form.program.placeholder = school ? 'e.g. Biology, Chemistry, Core Mathematics' : id === 'professional' ? 'e.g. ACCA, CFA Level 1' : 'e.g. BSc Computer Science';
  api('GET', `/api/catalog?level=${encodeURIComponent(id)}`)
    .then(({ programs }) => $('#programs').replaceChildren(...programs.map((p) => el('option', { value: p.name }))))
    .catch(() => {});
  showStep(2);
}

function updateStart() { $('#start').disabled = ob.selected.size === 0 && ob.interests.size === 0; }

function programBlock(part) {
  const box = el('div', { class: 'program' });
  const block = { box, render: null };
  block.render = (p) => {
    box.replaceChildren();
    if (p?.status === 'loading' || p?.status === 'researching') {
      const what = p.status === 'loading' ? `Looking up ${part || ob.profile.institution}…` : `Researching ${p.institution || p.name}…`;
      box.append(el('div', { class: 'researching' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }),
        el('div', {}, el('strong', {}, what), p.status === 'researching' ? el('p', {}, 'Reading the official course list or syllabus. Usually under a minute.') : null)));
      return;
    }
    if (!p || p.status === 'failed') {
      box.append(el('p', { class: 'muted' }, p?.error
        ? `We couldn't research "${part}" (${p.error}). Pick interests on the previous step, or try a simpler course name.`
        : `We couldn't find "${part || ob.profile.institution}". Pick interests on the previous step, or edit your course.`));
      return;
    }
    const allOn = () => p.units.every((u) => ob.selected.has(u.id));
    box.append(el('div', { class: 'program-head' },
      el('div', {}, el('h3', {}, p.name), el('p', {}, p.note || p.basis || '')),
      el('button', { type: 'button', class: 'btn ghost small', onclick: () => {
        const on = !allOn();
        p.units.forEach((u) => (on ? ob.selected.add(u.id) : ob.selected.delete(u.id)));
        block.render(p); updateStart();
      } }, allOn() ? 'Untick all' : 'Tick all')));
    const list = el('div', { class: 'unit-list' });
    for (const u of p.units) {
      const b = el('button', { type: 'button', class: 'unit', 'aria-pressed': String(ob.selected.has(u.id)) },
        el('strong', {}, u.title), u.summary ? el('span', {}, u.summary) : null, el('i', { class: 'tick', 'aria-hidden': 'true' }));
      b.onclick = () => {
        ob.selected.has(u.id) ? ob.selected.delete(u.id) : ob.selected.add(u.id);
        b.setAttribute('aria-pressed', String(ob.selected.has(u.id)));
        updateStart();
      };
      list.append(b);
    }
    box.append(list);
    if (p.sources?.length) {
      box.append(el('p', { class: 'sources' }, 'Sources: ', ...p.sources.slice(0, 4).flatMap((s, i) => [i ? ' · ' : '',
        el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title.slice(0, 48))])));
    }
    if (p.source === 'catalog' && cfg.research && ob.profile.institution) {
      box.append(el('p', { class: 'sources' }, el('button', { type: 'button', class: 'link', onclick: () => resolvePart(part, block, true) },
        `Match ${ob.profile.institution}'s actual course instead →`)));
    }
  };
  return block;
}

async function resolvePart(part, existing, tailor = false) {
  const block = existing || programBlock(part);
  if (!existing) $('#syllabus').append(block.box);
  block.render({ status: 'loading' });
  const previous = ob.programs.find((p) => p.part === part);
  if (previous) { previous.program.units.forEach((u) => ob.selected.delete(u.id)); ob.programs = ob.programs.filter((p) => p !== previous); }
  try {
    let { program, researchUnavailable } = await api('POST', '/api/programs/resolve', { profile: { ...ob.profile, level: ob.level, program: part }, tailor });
    if (researchUnavailable && !program) toast('Researching courses needs the Anthropic key on the server.');
    while (program?.status === 'researching') {
      block.render(program);
      await sleep(3000);
      program = (await api('GET', `/api/programs/${encodeURIComponent(program.key)}`)).program;
    }
    let shown = program;
    if (program?.status === 'failed' && program.fallback) shown = { ...program.fallback, note: "Research didn't finish, so here are the core units instead." };
    if (shown?.units?.length && shown.status !== 'failed') {
      ob.programs.push({ part, program: shown });
      shown.units.forEach((u) => ob.selected.add(u.id));
    }
    block.render(shown);
  } catch (err) {
    block.render(null);
    toast(`Couldn't look up "${part}": ${err.message}`);
  }
  updateStart();
}

async function buildSyllabus() {
  ob.programs = [];
  ob.selected = new Set();
  const p = ob.profile;
  const parts = !p.program ? (p.institution ? [''] : [])
    : SCHOOL_LEVELS.has(ob.level) ? p.program.split(/\s*(?:,|;|\band\b|&)\s*/i).filter(Boolean).slice(0, 6) : [p.program];
  $('#syllabus').replaceChildren();
  $('#syllabus-lead').textContent = parts.length
    ? "Untick anything you've already mastered. Your feed follows what stays ticked, in order."
    : 'No course to follow, so your feed will follow your interests. Pick some on the previous step, or start with these.';
  if (!parts.length && !ob.interests.size) cfg.topics.slice(0, 4).forEach((t) => ob.interests.add(t.id));
  updateStart();
  await Promise.all(parts.map((part) => resolvePart(part)));
  if (!ob.selected.size && !ob.interests.size) cfg.topics.slice(0, 4).forEach((t) => ob.interests.add(t.id));
  updateStart();
  // Save a draft now so the first videos start generating while the student reads the list.
  api('POST', '/api/profile', { ...profileBody(), draft: true }).catch(() => {});
}

function profileBody() {
  const units = ob.programs.flatMap((p) => p.program.units.map((u) => u.id)).filter((id) => ob.selected.has(id));
  return { profile: { ...ob.profile, level: ob.level, age: ageOf(), managedBy: ob.who === 'child' ? 'guardian' : 'self' }, guardianConsent: ob.who === 'child' && $('#ob-consent-box').checked, programKeys: ob.programs.map((p) => p.program.key), units, interests: [...ob.interests] };
}

async function runOnboarding(prefill) {
  if (prefill?.profile) {
    ob.level = prefill.profile.level || null;
    ob.profile = { ...prefill.profile };
    ob.interests = new Set(prefill.interests || []);
    const form = $('#details');
    for (const k of ['country', 'institution', 'program', 'exam']) form[k].value = prefill.profile[k] || '';
    ob.who = prefill.profile.managedBy === 'guardian' ? 'child' : 'self';
    $('#ob-age').value = prefill.profile.age || '';
    if (ob.who === 'child') $('#ob-consent-box').checked = true;
  }
  wireWho();
  renderLevels();
  renderTopics();
  $('#countries').replaceChildren(...COUNTRIES.map((c) => el('option', { value: c })));
  $('#ob-signin-hint').hidden = !cfg.vidmoatSignIn || Boolean(me?.vidmoat);
  $('#onboard').hidden = false;
  $('#app').hidden = true;
  document.body.classList.add('onboarding');
  showStep(1);

  $('.ob-back').onclick = () => showStep(Math.max(1, ob.step - 1));
  $('#details').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    ob.profile = { level: ob.level, country: f.country.value.trim(), institution: f.institution.value.trim(), program: f.program.value.trim(), exam: f.exam.value.trim() };
    if (ob.level === 'lifelong') ob.profile.institution = ob.profile.program = ob.profile.exam = '';
    showStep(3);
    buildSyllabus();
  };

  await new Promise((resolve) => { $('#start').onclick = resolve; });
  try {
    await api('POST', '/api/profile', profileBody());
  } catch (err) {
    toast(err.message || "Couldn't save your profile.");
    showStep(1);
    return runOnboarding({ ...(prefill || {}), profile: profileBody().profile, interests: [...ob.interests] });
  }
  me = (await api('GET', '/api/me')).user;
  $('#onboard').hidden = true;
  $('#app').hidden = false;
  document.body.classList.remove('onboarding');
}

// ============================================================================ feed: state
const feed = {
  items: [],        // { data, el, player, polling, viewSent, completed, watched, lastTime, answered }
  active: -1,       // index into items; items.length = the "finding your next lesson" slide
  loading: false,
  paused: false,
  endEl: null,
};
const trackEl = () => $('#track');
const feedEl = () => $('#feed');
const slideHeight = () => feedEl().clientHeight || window.innerHeight;

function layout(animate = false) {
  const h = slideHeight();
  feed.items.forEach((it, i) => { it.el.style.top = `${i * h}px`; it.el.dataset.index = String(i); });
  if (feed.endEl) feed.endEl.style.top = `${feed.items.length * h}px`;
  setOffset(0, animate);
  const prev = $('.pager [data-go="-1"]'), next = $('.pager [data-go="1"]');
  if (prev) prev.disabled = feed.active <= 0;
  if (next) next.disabled = feed.active >= feed.items.length;
}
function setOffset(px, animate) {
  const t = trackEl();
  t.classList.toggle('animating', Boolean(animate));
  t.style.transform = `translate3d(0, ${-Math.max(0, feed.active) * slideHeight() + px}px, 0)`;
}

function ensureEndSlide() {
  if (feed.endEl) return;
  feed.endEl = el('article', { class: 'slide end-slide' },
    el('div', { class: 'stage' }, el('div', {}, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('p', {}, 'Finding your next lesson…'))));
  trackEl().append(feed.endEl);
}
/** The server could not start a new video for this student: say why on the end slide, once as a toast. */
let creditsNoted = null;
function noteCredits(credits) {
  if (!credits?.needed) return;
  const reason = credits.reason;
  const copy = {
    allowance: ['Your free lessons are used up', `Connect your Vidmoat account to keep new lessons coming${credits.unit ? ` (next up: ${credits.unit})` : ''}. Lessons already in the library stay free.`],
    exhausted: ["You're out of Vidmoat credits", 'Top up or upgrade on Vidmoat and new lessons resume automatically.'],
    plan: ['Your Vidmoat plan needs an upgrade', 'AI narration needs a Creator plan or above. Upgrade on Vidmoat to keep making lessons.'],
    reconnect: ['Reconnect your Vidmoat account', 'StudyTok lost access to your account. Connect it again from your Profile.'],
  }[reason] || ['New lessons are paused', 'Check Credits on your Profile.'];
  const action = reason === 'allowance' || reason === 'reconnect'
    ? el('a', { class: 'btn vidmoat', href: '/api/auth/vidmoat/connect', onclick: () => { track('signin_click', { where: 'feed_connect' }); flush(true); } }, el('img', { class: 'vm-logo', src: 'https://www.vidmoat.com/logo-512.png', alt: '', width: '22', height: '22' }), reason === 'reconnect' ? 'Reconnect' : 'Use my Vidmoat account')
    : el('a', { class: 'btn primary', href: cfg.billingUrl, target: '_blank', rel: 'noopener noreferrer', onclick: () => track('signin_click', { where: 'feed_buy' }) }, 'Buy credits or upgrade');
  $('.stage', feed.endEl).replaceChildren(el('div', { class: 'credits-box' }, el('h3', {}, copy[0]), el('p', {}, copy[1]), action,
    el('button', { type: 'button', class: 'btn ghost', onclick: () => showView('profile') }, 'See Credits in Profile')));
  if (creditsNoted !== reason) { creditsNoted = reason; toast(copy[0]); }
}

// ============================================================================ feed: navigation
function go(delta) { goTo(feed.active + delta); }
function goTo(index, { animate = true } = {}) {
  const max = feed.items.length; // the end slide
  const target = Math.max(0, Math.min(max, index));
  if (target === feed.active) { setOffset(0, animate); return; }
  activate(target);
  layout(animate);
  if (target >= feed.items.length - 2) loadMore();
}

function wireGestures() {
  const f = feedEl();
  let start = null;
  let lastTap = 0;
  let tapTimer = null;

  f.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button > 0 || e.target.closest('button, a, input, .quiz')) return;
    start = { x: e.clientX, y: e.clientY, t: performance.now(), dy: 0, moved: false, id: e.pointerId, samples: [{ y: e.clientY, t: performance.now() }] };
    f.setPointerCapture(e.pointerId);
  });
  f.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    let dy = e.clientY - start.y;
    start.samples.push({ y: e.clientY, t: performance.now() });
    if (start.samples.length > 12) start.samples.shift();
    if (!start.moved && Math.abs(dy) < 8) return;
    if (!start.moved && Math.abs(e.clientX - start.x) > Math.abs(dy)) return; // horizontal: ignore
    start.moved = true;
    const atTop = feed.active <= 0 && dy > 0;
    const atEnd = feed.active >= feed.items.length && dy < 0;
    if (atTop || atEnd) dy *= 0.3; // rubber band
    start.dy = dy;
    setOffset(dy, false);
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const s = start;
    start = null;
    if (!s.moved) {
      // Tap: single = pause/play, double = like (with a heart where you tapped).
      const now = performance.now();
      if (now - lastTap < 280) {
        clearTimeout(tapTimer);
        lastTap = 0;
        doubleTapLike(e);
      } else {
        lastTap = now;
        tapTimer = setTimeout(() => togglePause(), 260);
      }
      return;
    }
    // Flick velocity from the last ~100 ms of movement (px/ms), like native scrolling.
    const h = slideHeight();
    const now = performance.now();
    const recent = s.samples.filter((p) => now - p.t <= 120);
    const first = recent[0] || s.samples[0];
    const v = (e.clientY - first.y) / Math.max(16, now - first.t);
    const flick = Math.abs(s.dy) > 24 && Math.abs(v) > 0.35;
    if (s.dy < -h * 0.18 || (flick && v < 0)) go(1);
    else if (s.dy > h * 0.18 || (flick && v > 0)) go(-1);
    else setOffset(0, true);
  };
  f.addEventListener('pointerup', end);
  f.addEventListener('pointercancel', (e) => { if (start && e.pointerId === start.id) { start = null; setOffset(0, true); } });

  // Wheel / trackpad: exactly one slide per gesture; the gesture's trailing momentum is swallowed.
  let acc = 0, lockUntil = 0, lastWheel = 0;
  f.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = performance.now();
    const gap = now - lastWheel;
    lastWheel = now;
    // While events keep arriving (gaps under 250 ms) it is the same gesture or its momentum.
    if (now < lockUntil) { if (gap < 250) lockUntil = Math.max(lockUntil, now + 250); return; }
    if (gap > 250) acc = 0;
    acc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (Math.abs(acc) >= 35) {
      go(acc > 0 ? 1 : -1);
      acc = 0;
      lockUntil = now + 500;
    }
  }, { passive: false });

  $$('.pager-btn').forEach((b) => { b.onclick = () => go(Number(b.dataset.go)); });
  window.addEventListener('resize', () => layout(false));
  document.addEventListener('keydown', (e) => {
    if ($('#app').hidden || view !== 'feed' || e.target.closest('input, textarea') || !$('#sheet').hidden) return;
    if (['ArrowDown', 'PageDown', 'j'].includes(e.key)) { e.preventDefault(); go(1); }
    if (['ArrowUp', 'PageUp', 'k'].includes(e.key)) { e.preventDefault(); go(-1); }
    if (e.key === ' ') { e.preventDefault(); togglePause(); }
    if (e.key === 'l') toggleFlag(feed.items[feed.active], 'liked', 'like', 'unlike');
  });
}

// ============================================================================ feed: slides
function addSlide(data, { at } = {}) {
  const node = $('#slide-tpl').content.firstElementChild.cloneNode(true);
  const item = { data, el: node, player: null, polling: false, viewSent: false, completed: false, watched: 0, lastTime: 0, answered: false, watch: null, shownAt: 0 };
  ensureEndSlide();
  track('impression', { videoId: data.id, slot: at ?? feed.items.length, nth: nthVideo, status: data.status, format: data.format?.id });
  if (at == null || at >= feed.items.length) { feed.items.push(item); trackEl().insertBefore(node, feed.endEl); }
  else { feed.items.splice(at, 0, item); trackEl().insertBefore(node, feed.items[at + 1].el); }
  renderSlide(item);
  $('.like', node).onclick = () => toggleFlag(item, 'liked', 'like', 'unlike');
  $('.save', node).onclick = () => toggleFlag(item, 'saved', 'save', 'unsave');
  $('.why', node).onclick = () => { sendEvent(item.data.id, 'why_open'); openWhy(item); };
  $('.tune', node).onclick = () => { track('tune_open'); openTune(); };
  $('.less', node).onclick = () => {
    sendEvent(item.data.id, 'less', { t: +(item.watch?.lastT || 0).toFixed(1) });
    toast(`Got it: less of ${item.data.unit?.title || item.data.topic.label}`);
    if (feed.items[feed.active] === item) go(1);
  };
  if (data.status === 'generating') poll(item);
  return item;
}

function unitLabel(d) {
  const name = d.unit?.title || d.topic.label;
  if (d.starter) return `${d.topic.emoji} ${name} · while you wait`;
  return d.position ? `Unit ${d.position.index} of ${d.position.total} · ${name}` : `${d.topic.emoji} ${name}`;
}

function renderSlide(item) {
  const { data: d, el: node } = item;
  node.style.setProperty('--accent', d.topic.accent);
  node.dataset.status = d.status;
  node.dataset.id = d.id;
  $('.making-topic', node).textContent = unitLabel(d);
  $('.making-hook', node).textContent = d.status === 'failed' ? "This one didn't work out. Swipe for the next lesson." : d.hook || '';
  const stage = d.status === 'ready' ? 3 : d.title ? 1 : 0;
  $$('.making-steps li', node).forEach((li, i) => { li.classList.toggle('done', i < stage); li.classList.toggle('on', i === stage && d.status === 'generating'); });
  $('.unit-text', node).textContent = unitLabel(d) + (d.subtopic ? ` · ${d.subtopic}` : '');
  $('.title', node).textContent = d.title || '';
  $('.fmt-badge', node).textContent = d.status === 'ready' && d.format?.tag ? d.format.tag : '';
  $('.like .count', node).textContent = String(d.likes || 0);
  $('.like', node).setAttribute('aria-pressed', String(!!d.liked));
  $('.save', node).setAttribute('aria-pressed', String(!!d.saved));
  $('.save .count', node).textContent = d.saved ? 'Saved' : 'Save';
  const credits = [...new Set((d.credits || []).map((c) => c.by).filter(Boolean))];
  $('.credits', node).textContent = credits.length ? `Stock: ${credits.slice(0, 3).join(', ')}` : '';
  const poster = $('.poster', node);
  if (d.poster && poster.getAttribute('src') !== d.poster) poster.src = d.poster;
  const note = $('.next-note', node);
  note.hidden = !d.queuedFor;
  note.textContent = d.queuedFor ? `Your lesson on ${d.queuedFor} is being made and will follow.` : '';
}

async function poll(item) {
  if (item.polling) return;
  item.polling = true;
  let delay = 1500;
  while (item.data.status === 'generating') {
    await sleep(delay);
    delay = Math.min(delay * 1.2, 4000);
    try {
      const { item: fresh } = await api('GET', `/api/videos/${item.data.id}`);
      item.data = { ...fresh, why: item.data.why, position: item.data.position };
      renderSlide(item);
    } catch { /* transient: keep polling */ }
  }
  item.polling = false;
  if (feed.items[feed.active] === item && item.shownAt) track('gen_wait', { videoId: item.data.id, ms: Date.now() - item.shownAt, outcome: item.data.status === 'ready' ? 'ready' : 'failed' });
  preferReady();
  syncPlayers();
}

/** Keep a ready video in the next slot when the one there is still being made. */
function preferReady() {
  const next = feed.active + 1;
  const slot = feed.items[next];
  if (!slot || slot.data.status === 'ready') return;
  const j = feed.items.findIndex((it, i) => i > next && it.data.status === 'ready' && !it.viewSent);
  if (j < 0) return;
  const [moved] = feed.items.splice(j, 1);
  feed.items.splice(next, 0, moved);
  trackEl().insertBefore(moved.el, feed.items[next + 1].el);
  layout(false);
  syncPlayers();
}

// ============================================================================ feed: players
function mountPlayer(item) {
  if (item.player || item.data.status !== 'ready') return;
  const duration = item.data.duration || 0;
  item.player = new VidmoatPlayer($('.player-host', item.el), cfg.playerOrigin, {
    onLoaded: () => {
      item.el.dataset.loaded = 'true';
      if (feed.items[feed.active] === item && !feed.paused && view === 'feed') item.player.play();
    },
    onState: ({ time, playing }) => onState(item, time, playing, duration),
    onError: (msg) => { item.el.dataset.status = 'failed'; $('.making-hook', item.el).textContent = msg; sendEvent(item.data.id, 'player_error', { msg: String(msg).slice(0, 80) }); },
  });
  item.player.load(item.data.document, 0);
}
function unmountPlayer(item) {
  if (!item.player) return;
  item.player.destroy();
  item.player = null;
  delete item.el.dataset.loaded;
}
// Playback performance: the embed player decodes every video layer of a document in the
// browser, so only the active lesson has a live player. The next one is mounted (paused, loading
// its document) once the viewer is halfway through the current lesson, or at once when the
// current slide has nothing to play; the previous one is unmounted immediately.
function syncPlayers() {
  const active = feed.items[feed.active];
  const preloadNext = !active || active.data.status !== 'ready' || active.preloadNext || !active.player;
  feed.items.forEach((item, i) => {
    const keep = feed.active >= 0 && (i === feed.active || (i === feed.active + 1 && preloadNext));
    if (keep) mountPlayer(item); else unmountPlayer(item);
    if (!item.player) return;
    if (i === feed.active && !feed.paused && view === 'feed' && !item.held) item.player.play(); else item.player.pause();
  });
}
function onState(item, time, playing, duration) {
  const isActive = feed.items[feed.active] === item;
  if (playing && isActive && time > item.lastTime) item.watched += Math.min(time - item.lastTime, 0.5);
  item.lastTime = time;
  if (isActive) {
    item.watch ||= new WatchTracker(item.data.id, { duration, scenes: item.data.scenes || [] });
    item.watch.tick(time, playing);
  }
  $('.bar', item.el).style.transform = `scaleX(${duration ? Math.min(1, time / duration) : 0})`;
  updateQuiz(item, time);
  if (isActive && !item.preloadNext && duration && time >= duration * 0.5) { item.preloadNext = true; syncPlayers(); }
  // Hold at the end of the question until the viewer answers (or skips): the answer is never
  // spoken before they have had the chance to try.
  const q = item.data.quiz;
  if (q?.hold != null && isActive && !item.answered && !item.held && time >= q.hold && time < q.reveal) {
    item.held = true;
    item.heldAt = Date.now();
    if (item.watch) item.watch.pauseBy = 'quiz';
    sendEvent(item.data.id, 'quiz_hold', { t: +time.toFixed(1) });
    item.player.pause();
    item.player.seek(q.hold);
    $('.quiz', item.el).dataset.held = 'true';
    return;
  }
  if (duration && time >= duration - 0.15 && isActive) {
    if (!item.completed) { item.completed = true; sendEvent(item.data.id, 'complete'); }
    item.lastTime = 0;
    item.player.seek(0);
    if (!feed.paused) item.player.play();
  }
  if (!isActive && playing) item.player.pause();
}

function togglePause() {
  const item = feed.items[feed.active];
  if (!item?.player) return;
  feed.paused = !feed.paused;
  if (item.watch && feed.paused) item.watch.pauseBy = 'tap';
  feed.paused ? item.player.pause() : item.player.play();
  item.el.dataset.paused = String(feed.paused);
}

function doubleTapLike(e) {
  const item = feed.items[feed.active];
  if (!item || item.data.status !== 'ready') return;
  const stage = $('.stage', item.el).getBoundingClientRect();
  const burst = $('.heart-burst', item.el);
  burst.style.left = `${e.clientX - stage.left}px`;
  burst.style.top = `${e.clientY - stage.top}px`;
  burst.classList.remove('go'); void burst.offsetWidth; burst.classList.add('go');
  if (!item.data.liked) toggleFlag(item, 'liked', 'like', 'unlike', 'double-tap');
}

function toggleFlag(item, field, onType, offType, by = 'button') {
  if (!item) return;
  const on = !item.data[field];
  item.data[field] = on;
  if (field === 'liked') item.data.likes = Math.max(0, (item.data.likes || 0) + (on ? 1 : -1));
  renderSlide(item);
  sendEvent(item.data.id, on ? onType : offType, on ? { t: +(item.watch?.lastT || 0).toFixed(1), by } : {});
  if (field === 'saved' && on) toast('Saved to your Library for revision');
}

// ---------------------------------------------------------------------------- quiz
function updateQuiz(item, time) {
  const q = item.data.quiz;
  const box = $('.quiz', item.el);
  if (!q || q.from == null || q.reveal == null) { box.hidden = true; return; }
  const open = time >= q.from && time < q.reveal + (item.answered ? 2.5 : 0);
  if (open && box.hidden) {
    box.hidden = false;
    box.dataset.held = 'false';
    if (!item.quizShownAt) { item.quizShownAt = Date.now(); sendEvent(item.data.id, 'quiz_shown', { t: +time.toFixed(1) }); }
    if (!$('.quiz-options', box).childElementCount) {
      $('.quiz-options', box).replaceChildren(...q.options.map((opt, i) =>
        el('button', { type: 'button', class: 'quiz-opt', onclick: () => answer(item, i) }, el('b', {}, 'ABC'[i]), opt)));
      $('.quiz-skip', box).onclick = () => { sendEvent(item.data.id, 'quiz_skip', { ms: Date.now() - (item.heldAt || item.quizShownAt || Date.now()) }); release(item); };
    }
  }
  if (!open && !box.hidden) box.hidden = true;
}
/** Let the video continue after the question (answered or skipped). */
function release(item) {
  item.answered = true;
  const wasHeld = item.held;
  item.held = false;
  const box = $('.quiz', item.el);
  box.dataset.held = 'false';
  if (wasHeld && feed.items[feed.active] === item && !feed.paused && view === 'feed') item.player?.play();
}
function answer(item, i) {
  if (item.answered) return;
  item.answered = true;
  const q = item.data.quiz;
  const correct = i === q.answerIndex;
  const box = $('.quiz', item.el);
  $$('.quiz-opt', box).forEach((b, k) => {
    b.disabled = true;
    b.classList.toggle('right', k === q.answerIndex);
    b.classList.toggle('wrong', k === i && !correct);
  });
  $('.quiz-feedback', box).textContent = correct ? 'Correct! 🎉' : `Not quite: it's ${'ABC'[q.answerIndex]}. We'll bring this back for review.`;
  sendEvent(item.data.id, 'quiz_answer', { correct, choice: i, ms: Date.now() - (item.heldAt || item.quizShownAt || Date.now()) });
  setTimeout(() => release(item), 700);
}

// ---------------------------------------------------------------------------- why sheet
function openWhy(item) {
  const d = item.data, w = d.why || {};
  const reasons = [];
  if (w.starter) reasons.push(['⏱️', `A ready lesson from the library while yours is being made${d.queuedFor ? ` (${d.queuedFor})` : ''}.`]);
  if (w.explored) reasons.push(['🧭', 'Something a little different. A small share of your feed explores, so it never gets stale.']);
  if (w.kind === 'course' && w.progress >= 0.7) reasons.push(['📚', d.position ? `Next up in your syllabus: unit ${d.position.index} of ${d.position.total}.` : 'Next up in your syllabus.']);
  else if (w.kind === 'course') reasons.push(['📚', 'Part of your course.']);
  if (w.kind === 'interest') reasons.push(['✨', `From your interests: ${d.topic.label}.`]);
  if (w.review > 0) reasons.push(['🔁', 'Due for review. Spaced repetition brings units back after 1, 3, 7 and 21 days, and sooner when a quiz goes wrong.']);
  if (w.affinity >= 0.6) reasons.push(['❤️', "You've been finishing and liking lessons like this."]);
  const v = w.video || {};
  if (v.formatAffinity >= 0.6) reasons.push(['🎬', `You tend to watch ${d.format?.name || 'this kind of'} videos through, so this one is a ${d.format?.name || 'match'}.`]);
  else if (v.diversity < 1) reasons.push(['🎬', `A ${d.format?.name || 'different'} video, to change the pace from the last one.`]);
  else if (d.format?.name) reasons.push(['🎬', `Format: ${d.format.name}. The feed rotates formats so it never feels the same.`]);
  if (v.quality >= 0.6) reasons.push(['⭐', 'Other students watched this one to the end.']);
  if (v.fatigue > 1.05) reasons.push(['☕', "You've watched a lot this session, so here is something lighter."]);
  if (v.difficulty < 1) reasons.push(['🧩', 'A gentler format after a couple of tricky questions.']);
  else if (v.difficulty > 1) reasons.push(['🏋️', "You're on a streak, so this one pushes a little harder."]);
  const p = me?.profile || {};
  const lvl = cfg.levels.find((l) => l.id === p.level);
  if (lvl) reasons.push(['🎓', `Pitched at ${lvl.label}${p.exam ? `, in ${p.exam} terms` : ''}.`]);
  if (!reasons.length) reasons.push(['🎯', 'Picked for you from your course and interests.']);
  openSheet("Why you're seeing this", el('ul', { class: 'why-list' }, ...reasons.map(([icon, text]) => el('li', {}, el('span', {}, icon), el('span', {}, text)))));
}
let sheetOnClose = null;
function openSheet(title, body, onClose = null) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').replaceChildren(body);
  $('#sheet').hidden = false;
  sheetOnClose = onClose;
  feed.items[feed.active]?.player?.pause();
}
async function closeSheet() {
  $('#sheet').hidden = true;
  const cb = sheetOnClose;
  sheetOnClose = null;
  if (cb) await cb();
  if (view === 'feed' && !feed.paused) feed.items[feed.active]?.player?.play();
}

// ---------------------------------------------------------------------------- activation & paging
function activate(index) {
  if (index === feed.active) return;
  const prev = feed.items[feed.active];
  const dir = index > feed.active ? 'next' : 'prev';
  if (prev) {
    if (prev.watch) prev.watch.leave(dir); else if (prev.data.status === 'generating' && prev.shownAt) track('gen_wait', { videoId: prev.data.id, ms: Date.now() - prev.shownAt, outcome: 'gave_up' });
    prev.watch = null;
    prev.el.dataset.paused = 'false';
  }
  feed.active = index;
  feed.paused = false;
  const item = feed.items[index];
  if (item) {
    item.watched = 0; item.lastTime = 0; item.completed = false; item.preloadNext = false;
    item.shownAt = Date.now();
    if (dir === 'prev' && item.viewSent) sendEvent(item.data.id, 'rewatch');
    if (item.player?.loaded) item.player.seek(0);
    if (view === 'feed') history.replaceState(null, '', `#v=${item.data.id}`);
    clearTimeout(activate.viewTimer);
    activate.viewTimer = setTimeout(() => {
      if (feed.items[feed.active] === item && !item.viewSent && item.data.status === 'ready') { item.viewSent = true; nthVideo++; sendEvent(item.data.id, 'view', { nth: nthVideo, format: item.data.format?.id, source: item.source || 'feed' }); }
    }, 1000);
    if (index > 0) { $('#swipe-hint').hidden = true; store.set('st_swiped', '1'); }
  }
  preferReady();
  syncPlayers();
}

async function loadMore(count = 3) {
  if (feed.loading) return;
  feed.loading = true;
  try {
    const before = feed.items.length;
    const wasOnEnd = feed.active === before;
    if (wasOnEnd && before > 0) track('end_reached');
    const t0 = Date.now();
    const { items, credits } = await api('GET', `/api/feed?count=${count}`);
    track('load_more', { count: items.length, ms: Date.now() - t0, ready: items.filter((d) => d.status === 'ready').length, generating: items.filter((d) => d.status === 'generating').length });
    items.filter((d) => !feed.items.some((it) => it.data.id === d.id)).forEach((d) => addSlide(d));
    noteCredits(credits);
    if (wasOnEnd && feed.items.length > before) { feed.active = -1; activate(before); }
    layout(false);
    preferReady();
    syncPlayers();
  } catch (err) {
    if (err.status !== 401) { toast("Couldn't load more lessons. Retrying…"); setTimeout(() => loadMore(count), 4000); }
  } finally {
    feed.loading = false;
  }
}

/** Opens a specific video (from the Library or a shared link) right after the current one. */
async function openVideo(id) {
  const existing = feed.items.findIndex((it) => it.data.id === id);
  showView('feed');
  if (existing >= 0) { goTo(existing); return; }
  try {
    const { item } = await api('GET', `/api/videos/${id}`);
    const at = feed.active < 0 ? 0 : feed.active + 1;
    addSlide(item, { at }).source = 'library';
    layout(false);
    goTo(at);
  } catch {
    toast('That video is no longer available.');
  }
}

// ============================================================================ tune sheet
const PREFS = [
  ['voice', 'Narration', [['on', 'On'], ['off', 'Off']]],
  ['length', 'Length', [['quick', 'Quick'], ['standard', 'Standard'], ['deep', 'Deep']]],
  ['visuals', 'Visuals', [['mixed', 'Mixed'], ['diagrams', 'Diagrams'], ['footage', 'Real footage']]],
  ['difficulty', 'Difficulty', [['easier', 'Easier'], ['standard', 'Standard'], ['harder', 'Harder']]],
];

async function patchMe(body) {
  const res = await api('PATCH', '/api/me', body);
  me = { ...res.user, billing: me?.billing };
  return res;
}

/** Topics, custom topics and lesson preferences. Changing a preference restarts the feed. */
async function openTune() {
  const lib = await api('GET', '/api/library').catch(() => null);
  if (!lib) return toast("Couldn't load your settings.");
  const prefsBefore = JSON.stringify(lib.prefs);
  const prefs = { ...lib.prefs };
  const interests = new Set(lib.interests);
  const body = el('div', { class: 'tune' });

  // Interests
  body.append(el('h4', {}, 'Topics you follow'));
  const chips = el('div', { class: 'chips' });
  for (const t of cfg.topics) {
    const b = el('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(interests.has(t.id)) }, `${t.emoji} ${t.label}`);
    b.onclick = async () => {
      interests.has(t.id) ? interests.delete(t.id) : interests.add(t.id);
      b.setAttribute('aria-pressed', String(interests.has(t.id)));
      track('interest_toggle', { topic: t.id, on: interests.has(t.id) });
      await patchMe({ interests: [...interests] }).catch(() => toast("Couldn't save that."));
    };
    chips.append(b);
  }
  body.append(chips);

  // Custom topics
  body.append(el('h4', {}, 'Your own topics'));
  const customList = el('div', { class: 'chips' });
  body.append(customList);
  const renderCustom = (units) => {
    customList.replaceChildren(...units.filter((u) => u.custom && u.active).map((u) => el('span', { class: 'chip-btn on' }, u.title,
      el('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove ${u.title}`, onclick: async () => {
        track('custom_remove', { unitId: u.id });
        await patchMe({ removeUnit: u.id }).catch(() => toast("Couldn't remove that."));
        renderCustom((await api('GET', '/api/library')).units);
      } }, '×'))));
    if (!customList.childElementCount) customList.append(el('span', { class: 'muted small' }, 'Anything you want to learn: "Python decorators", "The Ashanti Empire", "Chess openings"…'));
  };
  renderCustom(lib.units);
  const input = el('input', { type: 'text', maxlength: '60', placeholder: 'Add a topic…', 'aria-label': 'Add a topic' });
  const add = async () => {
    const title = input.value.trim();
    if (title.length < 2) return;
    input.value = '';
    const { added } = await patchMe({ addCustom: { title } }).catch(() => ({}));
    if (!added) return toast("Couldn't add that topic.");
    track('custom_add', { title: added.title });
    toast(`Added "${added.title}". Lessons are on their way.`);
    renderCustom((await api('GET', '/api/library')).units);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  body.append(el('div', { class: 'add-row' }, input, el('button', { type: 'button', class: 'btn small', onclick: add }, 'Add')));

  // Preferences
  body.append(el('h4', {}, 'How lessons are made'));
  for (const [key, label, options] of PREFS) {
    const seg = el('div', { class: 'segmented small', role: 'radiogroup', 'aria-label': label });
    const draw = () => seg.replaceChildren(...options.map(([v, text]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(prefs[key] === v), 'aria-selected': String(prefs[key] === v), onclick: () => { prefs[key] = v; track('pref_change', { key, value: v }); draw(); } }, text)));
    draw();
    body.append(el('div', { class: 'pref-row' }, el('span', {}, label), seg));
  }
  body.append(el('p', { class: 'fine' }, 'Narration and visuals change how videos are made. Length and difficulty change the lesson itself. New videos follow your settings; ones already made are kept.'));

  openSheet('Tune your feed', body, async () => {
    if (JSON.stringify(prefs) !== prefsBefore) {
      await patchMe({ prefs }).catch(() => toast("Couldn't save your preferences."));
      toast('Preferences saved. Loading lessons made your way…');
      await restartFeed();
    }
  });
}

async function restartFeed() {
  feed.items.splice(0).forEach((it) => { it.player?.destroy(); it.el.remove(); });
  feed.active = -1;
  showView('feed');
  await loadMore(3);
  goTo(0, { animate: false });
}

// ============================================================================ mascot & stickers
// "Noti", the sticky-note study buddy: a yellow note with a highlighter. Moods change the face.
function mascot(mood = 'happy', size = 96) {
  const face = {
    happy: '<path d="M38 44q3 4 6 0M60 44q3 4 6 0" stroke="#141414" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M42 58q10 9 20 0" stroke="#141414" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
    cheer: '<path d="M37 45q4-6 8 0M59 45q4-6 8 0" stroke="#141414" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M40 56q12 14 24 0z" fill="#141414"/><path d="M46 62q6 4 12 0" fill="#ff6b6b"/>',
    think: '<circle cx="42" cy="45" r="3" fill="#141414"/><circle cx="63" cy="45" r="3" fill="#141414"/><path d="M44 60h16" stroke="#141414" stroke-width="3.5" stroke-linecap="round"/><path d="M30 34q8-6 16-2M74 34q-8-6-16-2" stroke="#141414" stroke-width="3" fill="none" stroke-linecap="round"/>',
    sleepy: '<path d="M37 46q5 3 10 0M57 46q5 3 10 0" stroke="#141414" stroke-width="3.5" fill="none" stroke-linecap="round"/><ellipse cx="52" cy="60" rx="5" ry="4" fill="#141414"/><text x="74" y="26" font-family="var(--serif)" font-size="16" font-weight="700" fill="#141414">z</text><text x="84" y="16" font-family="var(--serif)" font-size="12" font-weight="700" fill="#141414">z</text>',
  }[mood] || '';
  const arms = mood === 'cheer' ? '<path d="M18 50l-10-16M86 50l10-16" stroke="#141414" stroke-width="5" stroke-linecap="round"/>' : '<path d="M18 56l-8 10M86 56l8 10" stroke="#141414" stroke-width="5" stroke-linecap="round"/>';
  return `<svg class="sticker mascot" viewBox="0 0 104 104" width="${size}" height="${size}" aria-hidden="true">
    <g transform="rotate(-4 52 52)">
      <path d="M22 18h60a4 4 0 0 1 4 4v52l-14 14H22a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>
      <path d="M22 18h60a4 4 0 0 1 4 4v52l-14 14H22a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4z" fill="#ffd93d" stroke="#141414" stroke-width="3" stroke-linejoin="round"/>
      <path d="M72 88V78a4 4 0 0 1 4-4h10z" fill="#f2c200" stroke="#141414" stroke-width="3" stroke-linejoin="round"/>
      <path d="M26 30h40" stroke="#141414" stroke-width="2" stroke-dasharray="3 5" opacity=".35"/>
      ${arms}${face}
      <path d="M88 8l8 8-26 26-11 3 3-11z" fill="#ff6b6b" stroke="#141414" stroke-width="3" stroke-linejoin="round"/>
      <path d="M62 48l3-11 8 8z" fill="#141414"/>
    </g>
  </svg>`;
}
const svgEl = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstElementChild; };
const sbadge = (text, { hot = false, r = -1 } = {}) => el('span', { class: `sbadge${hot ? ' hot' : ''}`, style: `--r:${r}deg` }, text);

/** A line from Noti for the student's current state. */
function buddyLine(stats) {
  if (!stats) return "Let's learn something today.";
  if (stats.streak >= 7) return `${stats.streak} days in a row. You're unstoppable.`;
  if (stats.streak >= 3) return `${stats.streak}-day streak. Keep it going!`;
  if (stats.quizN >= 5 && stats.quizRight / stats.quizN >= 0.8) return `${Math.round((stats.quizRight / stats.quizN) * 100)}% on quick checks. Show-off.`;
  if (stats.mastered >= 1) return `${stats.mastered} unit${stats.mastered > 1 ? 's' : ''} mastered. On to the next.`;
  if (stats.watched >= 5) return `${stats.watched} lessons in. It's sticking.`;
  if (stats.watched >= 1) return 'First lessons done. Swipe for more.';
  return "Your feed is ready. Let's go.";
}
function statTiles(stats) {
  const acc = stats?.quizN ? `${Math.round((stats.quizRight / stats.quizN) * 100)}%` : '—';
  return el('div', { class: 'tiles' },
    el('div', { class: `tile${stats?.streak >= 3 ? ' hl' : ''}` }, el('i', {}, '🔥'), el('b', {}, String(stats?.streak || 0)), el('span', {}, 'day streak')),
    el('div', { class: 'tile' }, el('i', {}, '🎬'), el('b', {}, String(stats?.watched || 0)), el('span', {}, 'lessons')),
    el('div', { class: 'tile' }, el('i', {}, '🎯'), el('b', {}, acc), el('span', {}, 'quiz score')),
    el('div', { class: 'tile' }, el('i', {}, '🏅'), el('b', {}, String(stats?.mastered || 0)), el('span', {}, 'mastered')));
}

// ============================================================================ library
async function showLibrary() {
  const lib = await api('GET', '/api/library');
  const byProgram = new Map();
  for (const u of lib.units) {
    const key = u.programKey || 'custom';
    if (!byProgram.has(key)) byProgram.set(key, []);
    byProgram.get(key).push(u);
  }
  const course = $('#lib-course');
  course.replaceChildren();
  const stats = me?.stats;
  const due = lib.units.filter((u) => u.active && u.dueForReview).length;
  course.append(el('div', { class: 'hero' }, svgEl(mascot(due ? 'think' : stats?.streak >= 3 ? 'cheer' : 'happy')),
    el('div', {}, el('h3', {}, due ? `${due} unit${due > 1 ? 's' : ''} due for review` : 'Your syllabus'),
      el('p', {}, due ? 'Spaced repetition says now is the moment. They are first in your feed.' : 'Untick what you have mastered; your feed follows what stays ticked.'),
      el('div', { class: 'bubble' }, buddyLine(stats)))));
  course.append(statTiles(stats));
  if (!lib.units.length) {
    course.append(el('div', { class: 'empty' }, svgEl(mascot('sleepy', 110)), el('b', {}, 'No course yet'), 'Add your course or subjects in Profile, or add your own topics below.'));
  }
  const activeIds = new Set(lib.units.filter((u) => u.active).map((u) => u.id));
  const saveUnits = () => patchMe({ units: lib.units.filter((u) => activeIds.has(u.id)).map((u) => u.id) }).catch(() => toast("Couldn't save that."));
  for (const [key, units] of byProgram) {
    const program = lib.programs.find((p) => p.key === key);
    const on = units.filter((u) => u.active);
    const pct = on.length ? Math.round((on.reduce((s, u) => s + u.mastery, 0) / on.length) * 100) : 0;
    const ring = el('div', { class: 'ring' }, el('span', {}, `${pct}%`));
    ring.style.setProperty('--p', String(pct));
    const rows = units.map((u) => {
      const box = el('input', { type: 'checkbox', class: 'unit-on', 'aria-label': `Include ${u.title}` });
      box.checked = u.active;
      box.onchange = async () => { box.checked ? activeIds.add(u.id) : activeIds.delete(u.id); u.active = box.checked; row.classList.toggle('off', !u.active); await saveUnits(); };
      const row = el('div', { class: `unit-row${u.active ? '' : ' off'}` },
        el('label', { class: 'unit-name' }, box, el('span', {}, u.title), u.custom ? el('span', { class: 'tag' }, 'yours') : null, u.dueForReview && u.active ? el('span', { class: 'due' }, 'Review due') : null),
        el('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(u.mastery * 100)), 'aria-label': `${u.title} mastery` },
          el('i', { style: `width:${Math.round(u.mastery * 100)}%` })),
        u.custom
          ? el('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove ${u.title}`, onclick: async () => { await patchMe({ removeUnit: u.id }).catch(() => {}); showLibrary(); } }, '×')
          : el('span', { class: 'pct' }, `${Math.round(u.mastery * 100)}%`));
      return row;
    });
    const input = el('input', { type: 'text', maxlength: '60', placeholder: key === 'custom' ? 'Add a topic…' : `Add a topic to ${program?.name || 'this course'}…`, 'aria-label': 'Add a topic' });
    const add = async () => {
      const title = input.value.trim();
      if (title.length < 2) return;
      input.value = '';
      const { added } = await patchMe({ addCustom: { title, programKey: key === 'custom' ? null : key } }).catch(() => ({}));
      if (!added) return toast("Couldn't add that topic.");
      toast(`Added "${added.title}". Lessons are on their way.`);
      showLibrary();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    const corner = pct >= 70 ? sbadge('🏅 mastered', { hot: true, r: 6 }) : pct >= 30 ? sbadge('📈 on it', { r: 6 }) : null;
    course.append(el('div', { class: 'course-card' }, corner ? Object.assign(corner, { className: corner.className + ' corner-badge' }) : null,
      el('div', { class: 'course-head' }, ring, el('div', {}, el('h3', {}, program?.name || (key === 'custom' ? 'My topics' : 'Your course')), el('p', {}, program?.basis || (key === 'custom' ? 'Topics you added' : `${units.length} units`)))),
      ...rows,
      el('div', { class: 'add-row' }, input, el('button', { type: 'button', class: 'btn small', onclick: add }, 'Add'))));
  }
  if (!byProgram.has('custom')) {
    const input = el('input', { type: 'text', maxlength: '60', placeholder: 'Add your own topic…', 'aria-label': 'Add a topic' });
    const add = async () => {
      const title = input.value.trim();
      if (title.length < 2) return;
      const { added } = await patchMe({ addCustom: { title } }).catch(() => ({}));
      if (!added) return toast("Couldn't add that topic.");
      toast(`Added "${added.title}". Lessons are on their way.`);
      showLibrary();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    course.append(el('div', { class: 'card' }, el('h3', {}, 'My topics'), el('p', { class: 'muted' }, 'Anything you want to learn, in your own words.'),
      el('div', { class: 'add-row' }, input, el('button', { type: 'button', class: 'btn small', onclick: add }, 'Add'))));
  }
  if (lib.interests?.length) {
    course.append(el('div', { class: 'card' }, el('h3', {}, 'Also following'),
      el('div', { class: 'chips' }, ...lib.interests.map((t) => { const topic = cfg.topics.find((x) => x.id === t); return topic ? el('span', { class: 'chip-btn' }, `${topic.emoji} ${topic.label}`) : null; }))));
  }
  const card = (v) => el('button', { type: 'button', class: 'vcard', onclick: () => openVideo(v.id) },
    v.poster ? el('img', { src: v.poster, alt: '', loading: 'lazy' }) : el('div', { class: 'ph' }), el('span', {}, v.title || 'Untitled'), el('small', {}, v.unit || ''));
  $('#lib-saved').replaceChildren(...(lib.saved.length ? lib.saved.map(card) : [el('div', { class: 'empty' }, svgEl(mascot('think', 110)), el('b', {}, 'Nothing saved yet'), 'Tap the bookmark on any lesson to keep it here for revision.')]));
  $('#lib-history').replaceChildren(...(lib.history.length ? lib.history.slice(0, 30).map(card) : [el('div', { class: 'empty' }, svgEl(mascot('sleepy', 110)), el('b', {}, 'No history yet'), 'Lessons you watch show up here.')]));
}

// ============================================================================ profile
function renderProfile() {
  const p = me?.profile || {};
  const lvl = cfg.levels.find((l) => l.id === p.level);
  const stats = me?.stats;
  const badges = [];
  if (stats?.streak >= 3) badges.push(sbadge(`🔥 ${stats.streak}-day streak`, { hot: true, r: -2 }));
  if (stats?.quizN >= 5 && stats.quizRight / stats.quizN >= 0.8) badges.push(sbadge('🎯 quiz ace', { r: 2 }));
  if (stats?.mastered >= 1) badges.push(sbadge(`🏅 ${stats.mastered} mastered`, { r: -1 }));
  if (stats?.watched >= 25) badges.push(sbadge('🎬 binge learner', { r: 1 }));
  if (me?.vidmoat) badges.push(sbadge(p.managedBy === 'guardian' ? '👪 set up by a guardian' : '✓ Vidmoat', { r: -1 }));
  $('#profile-card').className = 'hero';
  $('#profile-card').replaceChildren(svgEl(mascot(stats?.streak >= 3 ? 'cheer' : 'happy')),
    el('div', {}, el('h3', {}, me?.vidmoat?.name || 'Guest learner'), el('p', {}, [lvl?.label, p.institution, p.age ? `age ${p.age}` : null].filter(Boolean).join(' · ') || 'Exploring'),
      el('div', { class: 'bubble' }, buddyLine(stats)),
      badges.length ? el('div', { class: 'badges' }, ...badges) : null));
  $('#profile-tiles').replaceChildren(statTiles(stats));

  renderCredits();
  const account = $('#account-card');
  if (me?.vidmoat) {
    account.replaceChildren(el('h3', {}, 'Vidmoat account'),
      el('p', { class: 'muted' }, `Signed in as ${me.vidmoat.email || me.vidmoat.name}. Your course, progress and library follow you to any device where you sign in.`),
      el('ul', { class: 'reassure' }, el('li', {}, 'StudyTok never uses your Vidmoat credits'), el('li', {}, 'We only read your name and email')),
      el('button', { type: 'button', class: 'btn ghost', onclick: signOut }, 'Sign out on this device'));
  } else {
    account.replaceChildren(el('h3', {}, 'Keep your progress everywhere'),
      el('p', { class: 'muted' }, 'Sign in with your Vidmoat account to save your course, progress and library, and pick up on any device.'),
      el('ul', { class: 'reassure' },
        el('li', {}, 'We only read your name and email'),
        el('li', {}, 'StudyTok never uses your Vidmoat credits'),
        el('li', {}, 'Disconnect any time from your Vidmoat settings')),
      cfg.vidmoatSignIn
        ? el('a', { class: 'btn vidmoat', href: '/api/auth/vidmoat/start' }, el('img', { class: 'vm-logo', src: 'https://www.vidmoat.com/logo-512.png', alt: '', width: '22', height: '22' }), 'Sign in with Vidmoat')
        : el('p', { class: 'fine' }, 'Sign-in is not configured on this server yet.'));
  }

  const install = $('#install-card');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  install.hidden = Boolean(standalone) || (!installPrompt && !ios);
  if (!install.hidden) {
    install.replaceChildren(...[el('h3', {}, 'Install StudyTok'),
      el('p', { class: 'muted' }, installPrompt ? 'Add StudyTok to your home screen: it opens full screen, like an app.' : 'On iPhone or iPad: tap the Share button in Safari, then "Add to Home Screen".'),
      installPrompt ? el('button', { type: 'button', class: 'btn primary', onclick: doInstall }, 'Install app') : null].filter(Boolean));
  }

  $('#studies-summary').replaceChildren(el('p', {}, [p.program, p.institution, p.country].filter(Boolean).join(' · ') || 'No course set'),
    el('p', {}, [lvl?.label, p.exam && `Preparing for ${p.exam}`].filter(Boolean).join(' · ')));
}
/** Who pays for new videos: the free allowance on StudyTok's account, or the student's own Vidmoat credits. */
function renderCredits() {
  const card = $('#credits-card');
  const b = me?.billing;
  if (!b || !cfg.vidmoatSignIn) { card.hidden = true; return; }
  card.hidden = false;
  card.classList.toggle('warn', Boolean(b.problem) || (b.mode === 'house' && b.houseLeft === 0));
  const logo = () => el('img', { class: 'vm-logo', src: 'https://www.vidmoat.com/logo-512.png', alt: '', width: '22', height: '22' });
  const connect = (label = 'Use my Vidmoat account') => el('a', { class: 'btn vidmoat', href: '/api/auth/vidmoat/connect', onclick: () => { track('signin_click', { where: 'connect' }); flush(true); } }, logo(), label);
  const buy = (label = 'Buy credits or upgrade') => el('a', { class: 'btn primary', href: b.billingUrl, target: '_blank', rel: 'noopener noreferrer', onclick: () => track('signin_click', { where: 'buy_credits' }) }, label);
  const disconnect = el('button', { type: 'button', class: 'btn ghost', onclick: async () => {
    const r = await api('POST', '/api/billing/disconnect').catch(() => null);
    if (r) { me.billing = r.billing; toast('Disconnected. New videos use your free allowance.'); renderCredits(); }
  } }, 'Disconnect');
  const useHouse = el('button', { type: 'button', class: 'btn ghost', onclick: async () => {
    const r = await api('POST', '/api/billing/mode', { mode: 'house' }).catch(() => null);
    if (r) { me.billing = r.billing; renderCredits(); }
  } }, `Use free allowance (${b.houseLeft} left)`);
  const useOwn = el('button', { type: 'button', class: 'btn ghost', onclick: async () => {
    const r = await api('POST', '/api/billing/mode', { mode: 'own' }).catch(() => null);
    if (r) { me.billing = r.billing; renderCredits(); }
  } }, 'Use my Vidmoat credits');

  if (b.mode === 'own') {
    const problemText = { exhausted: "You're out of Vidmoat credits, so new lessons are paused. Top up and they resume on their own.", plan: 'Your Vidmoat plan does not include AI speech yet. Upgrade to keep making narrated lessons.', reconnect: 'StudyTok lost access to your account. Connect it again to keep going.' }[b.problem];
    card.replaceChildren(el('h3', {}, me?.profile?.managedBy === 'guardian' ? "Credits · the parent's Vidmoat account" : 'Credits · your Vidmoat account'),
      el('div', { class: 'credit-big' }, b.credits == null ? '—' : `${b.credits.toLocaleString()} credits`),
      el('p', { class: 'muted' }, problemText || `New lessons you trigger are made on your account (about 20 credits each)${b.plan ? ` · ${b.plan} plan` : ''}. Lessons already in the library are free to watch.`),
      el('div', { class: 'credit-actions' }, ...(b.problem === 'reconnect' ? [connect('Reconnect')] : [buy()]), ...(b.houseLeft > 0 ? [useHouse] : []), disconnect));
  } else {
    const pct = b.freeVideos ? Math.round((b.houseUsed / b.freeVideos) * 100) : 100;
    card.replaceChildren(el('h3', {}, 'Credits · free allowance'),
      el('div', { class: 'credit-meter' }, el('i', { style: `width:${pct}%` })),
      el('div', { class: 'credit-row' }, el('span', {}, `${b.houseUsed} of ${b.freeVideos} free lessons used`), el('span', {}, `${b.houseLeft} left`)),
      el('p', { class: 'muted' }, b.houseLeft === 0
        ? 'Your free lessons are used up. Connect your Vidmoat account to keep generating new lessons with your own credits; everything already made stays free to watch.'
        : 'Your first lessons are made on StudyTok’s Vidmoat account. Connect yours any time to make lessons with your own credits.'),
      el('ul', { class: 'reassure' }, el('li', {}, 'Only lessons you trigger spend credits (about 20 each)'), el('li', {}, 'Never renders, exports or your voices'), el('li', {}, 'Disconnect any time')),
      el('div', { class: 'credit-actions' }, b.connected ? useOwn : connect(), ...(b.houseLeft === 0 && !b.connected ? [buy('Get Vidmoat credits')] : [])));
  }
}
async function signOut() {
  await api('POST', '/api/auth/signout').catch(() => {});
  location.replace('/');
}
async function doInstall() {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice.catch(() => ({}));
  track('install', { outcome: outcome || 'dismissed' });
  installPrompt = null;
  if (outcome === 'accepted') toast('Installed! Find StudyTok on your home screen.');
  renderProfile();
}

// ============================================================================ views
function showView(next) {
  view = next;
  document.body.dataset.view = next;
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== next; });
  $$('.tabbtn').forEach((t, i) => { t.setAttribute('aria-current', t.dataset.tab === next ? 'page' : 'false'); if (t.dataset.tab === next) $('.tab-blob').style.setProperty('--tab', String(i)); });
  if (next === 'feed') {
    layout(false);
    syncPlayers();
    const item = feed.items[feed.active];
    history.replaceState(null, '', item ? `#v=${item.data.id}` : location.pathname);
  } else {
    feed.items[feed.active]?.player?.pause();
    history.replaceState(null, '', `#${next}`);
    // Fresh numbers for the stickers and tiles: send pending events, then re-read the profile.
    flush();
    const refresh = api('GET', '/api/me').then((r) => { me = { ...r.user, billing: r.user.billing || me?.billing }; }).catch(() => {});
    if (next === 'library') { track('library_open', { tab: 'course' }); refresh.then(() => showLibrary()).catch(() => toast("Couldn't load your library.")); }
    if (next === 'profile') { track('profile_open'); renderProfile(); refresh.then(renderProfile); }
  }
}

async function editStudies() {
  track('studies_edit');
  feed.items[feed.active]?.player?.pause();
  const user = await api('GET', '/api/me').then((r) => r.user, (err) => { if (err.status === 401) sessionLost(); throw err; });
  await runOnboarding(user);
  toast('Saved. New lessons will follow your updated course.');
  feed.items.splice(0).forEach((it) => { it.player?.destroy(); it.el.remove(); });
  feed.active = -1;
  showView('feed');
  await loadMore(3);
  goTo(0, { animate: false });
}

function wireChrome() {
  $$('.tabbtn').forEach((t) => { t.onclick = () => showView(t.dataset.tab); });
  $$('.segmented [data-seg]').forEach((b) => {
    b.onclick = () => {
      track('library_open', { tab: b.dataset.seg });
      $$('.segmented [data-seg]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $$('.seg-panel').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.seg; });
    };
  });
  $('#edit-studies').onclick = editStudies;
  $('#open-tune').onclick = openTune;
  $$('#sheet [data-close]').forEach((b) => { b.onclick = closeSheet; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
  $$('[data-signin]').forEach((b) => { b.onclick = () => { track('signin_click', { where: 'onboarding' }); flush(true); location.href = '/api/auth/vidmoat/start'; }; });
  document.addEventListener('visibilitychange', () => {
    const item = feed.items[feed.active];
    if (!item?.player) return;
    if (document.hidden) item.player.pause(); else if (!feed.paused && view === 'feed') item.player.play();
  });
}

// ============================================================================ landing
// Sample cards: one per format, so a new visitor sees how varied the feed is before signing in.
const SAMPLE_HOOKS = {
  explain: { topic: 'Biology', accent: '#34d399', hook: 'Why your cells never <em>run out</em> of energy', card: ['Diagram', 'Mitochondrion · ATP cycle'] },
  mythbust: { topic: 'Physics', accent: '#8fc1ff', hook: 'Drop a <em>hammer</em> and a feather', stamp: 'Myth', card: ['Everyone says', 'Heavier things fall faster'] },
  rapid: { topic: 'Economics', accent: '#f5b971', hook: '5 things that move <em>exchange rates</em>', card: ['03 / 05', 'Interest rates'] },
  examdrill: { topic: 'Maths', accent: '#f472b6', hook: 'This one costs <em>marks</em> every year', card: ['Exam question', 'Solve 2x² − 5x − 3 = 0'] },
  story: { topic: 'History', accent: '#fbbf24', hook: 'In 1665 a university <em>closed its doors</em>', card: ['Chapter 2', '1666 · The year of wonders'] },
  flashcards: { topic: 'Chemistry', accent: '#a78bfa', hook: 'Say it before it <em>appears</em>', card: ['Question 1 / 4', 'Unit of amount of substance?'] },
  why: { topic: 'Geography', accent: '#60a5fa', hook: 'Why does it rain <em>more</em> near the equator?', card: ['Because', 'Hot air rises and cools'] },
  chat: { topic: 'Computer science', accent: '#2dd4bf', hook: 'Is recursion just a <em>loop</em> in disguise?', card: ['Tutor Ama', 'Not quite. Every call gets its own frame…'] },
  levels: { topic: 'Chemistry', accent: '#a78bfa', hook: 'Entropy for a <em>kid</em>, a student, a professor', card: ['Level 2 · student', 'Disorder, measured in J/K'] },
  spotmistake: { topic: 'Maths', accent: '#f472b6', hook: 'One step here is <em>wrong</em>. Find it', card: ['Step 3', '= 2x − 5x = 3x'] },
  tierlist: { topic: 'History', accent: '#fbbf24', hook: 'Ranking the causes of <em>WW1</em>', card: ['S tier', 'Alliance system'] },
  thisorthat: { topic: 'Biology', accent: '#34d399', hook: 'Mitosis or <em>meiosis</em>?', card: ['This or that', 'Mitosis | Meiosis'] },
  pov: { topic: 'Biology', accent: '#2dd4bf', hook: 'POV: you are a <em>red blood cell</em>', card: ['You are here', 'Left ventricle → aorta'] },
  hottake: { topic: 'Economics', accent: '#f5b971', hook: 'GDP is a <em>terrible</em> measure. Hear me out', stamp: 'Hot take', card: ['The point', 'It counts output, not wellbeing'] },
  countdown: { topic: 'Physics', accent: '#8fc1ff', hook: '3 things that will be on your <em>exam</em>', card: ['03', 'Energy conservation'] },
  speedrun: { topic: 'Geography', accent: '#60a5fa', hook: 'Plate tectonics in <em>30 seconds</em>', card: ['06 / 06', 'Subduction'] },
  guess: { topic: 'Space', accent: '#8fc1ff', hook: 'Most students get this <em>wrong</em>', card: ['Guess first', 'Why is the sky dark at night?'] },
  wyr: { topic: 'Law', accent: '#f472b6', hook: 'Would you rather sue in <em>tort</em> or contract?', card: ['Would you rather', 'Tort · Contract · Depends'] },
};
function renderLanding(notice) {
  const wrap = $('#ld-samples');
  wrap.replaceChildren(...(cfg.formats || []).map((f, i) => {
    const s = SAMPLE_HOOKS[f.id] || { topic: 'Study', accent: '#ffd93d', hook: f.blurb, card: [f.tag, ''] };
    const card = el('article', { class: 'sample', 'data-f': f.id, style: `--accent:${s.accent};animation-delay:${i * 60}ms`, 'aria-label': `${f.name} sample` },
      el('span', { class: 's-chip' }, `${s.topic} · ${f.tag}`),
      el('div', { class: 's-hook' }, el('span', {})),
      s.stamp ? el('span', { class: 's-stamp' }, s.stamp) : null,
      el('div', { class: 's-card' }, el('b', {}, s.card[0]), s.card[1]),
      el('div', { class: 's-foot' }, el('span', {}, f.name), el('span', {}, '▶ 0:38')));
    $('.s-hook span', card).innerHTML = s.hook; // trusted static copy above
    return card;
  }));
  const install = $('#ld-install');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  install.hidden = Boolean(standalone) || (!installPrompt && !ios);
  install.onclick = () => (installPrompt ? doInstall() : toast('On iPhone or iPad: tap Share in Safari, then "Add to Home Screen".'));
  if (!cfg.vidmoatSignIn) $$('.ld-go, .ld-signin').forEach((a) => { a.setAttribute('aria-disabled', 'true'); a.onclick = (e) => { e.preventDefault(); toast('Sign-in is not configured on this server yet.'); }; });
  $('#landing').hidden = false;
  $('#onboard').hidden = true;
  $('#app').hidden = true;
  document.body.classList.add('landing-on');
  if (notice) toast(notice);
}

// ============================================================================ boot
function authNotice() {
  const auth = new URLSearchParams(location.search).get('auth');
  if (!auth) return null;
  history.replaceState(null, '', `/${location.hash || ''}`);
  return {
    linked: 'Signed in with Vidmoat. Your progress now follows you.',
    restored: 'Welcome back! Your course and progress are restored.',
    cancelled: 'Sign-in cancelled.',
    error: "Sign-in didn't work. Please try again.",
    unavailable: 'Sign-in is not configured on this server yet.',
    connected: 'Connected! New lessons now use your Vidmoat credits.',
    mismatch: 'That is a different Vidmoat account. Connect the one you signed in with.',
    scopes: 'Vidmoat did not grant the permissions StudyTok needs. Try again and allow all of them.',
  }[auth] || null;
}

async function boot() {
  if ('serviceWorker' in navigator) {
    // Check for a new worker on every open; when one takes over mid-session, reload once so the
    // page runs one deploy's HTML, JS and CSS together.
    navigator.serviceWorker.register('/sw.js').then((reg) => reg.update().catch(() => {})).catch(() => {});
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); hadController = true; });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (view === 'profile') renderProfile(); if (!$('#landing').hidden) $('#ld-install').hidden = false; });

  cfg = await api('GET', '/api/config');
  wireChrome();
  wireGestures();
  const notice = authNotice();
  const hash = location.hash;
  const linked = /#v=([0-9a-f-]{36})/.exec(hash)?.[1];

  let onboarded = false;
  try {
    me = (await api('GET', '/api/me')).user;
  } catch (err) {
    if (err.status !== 401) throw err;
  }
  // Sign in with Vidmoat is the way in: the landing page explains StudyTok and hands over to
  // Vidmoat; the callback brings the viewer back here signed in.
  if (cfg.signInRequired && !me?.vidmoat) {
    renderLanding(notice);
    return;
  }
  if (!me || !me.setupDone) {
    await runOnboarding(me);
    onboarded = true;
  }
  $('#onboard').hidden = true;
  $('#app').hidden = false;
  if (notice) toast(notice);

  // Browsers allow sound only after a tap on the page; onboarding (or sign-in) already gave one.
  if (!onboarded && !notice) {
    $('#sound-gate').hidden = false;
    await new Promise((r) => { $('#sound-go').onclick = r; });
    $('#sound-gate').hidden = true;
  }
  ensureEndSlide();
  track('session_start', { source: matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'app' : 'browser', entry: linked ? 'link' : hash ? hash.slice(1, 12) : 'feed', ageBand: ageBand(me?.profile?.age) });
  if (hash === '#library' || hash === '#profile') showView(hash.slice(1)); else showView('feed');
  if (linked) await openVideo(linked);
  await loadMore(3);
  if (feed.active < 0 && feed.items.length) goTo(0, { animate: false });
  if (!store.get('st_swiped')) {
    $('#swipe-hint').hidden = false;
    setTimeout(() => { $('#swipe-hint').hidden = true; }, 6000);
  }
}

boot().catch((err) => {
  console.error(err);
  toast('StudyTok could not start. Is the server running?');
});
