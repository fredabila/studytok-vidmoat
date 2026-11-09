// StudyGraph client.
//  - Onboarding: level -> studies -> syllabus (catalog match or live course research).
//  - Feed: a paging controller (drag/flick, wheel/trackpad, keys, buttons) over a track of
//    slides; live Vidmoat players only for the active slide ±1; ready videos are moved ahead of
//    ones still being made; tap = pause, double-tap = like; tap-to-answer quizzes.
//  - Library (course progress, saved, history) and Profile (Sign in with Vidmoat, install).
//  - PWA: service worker + install prompt.

import { VidmoatPlayer } from './player.js';
import { retimeClips, SPEEDS } from './retime.js';
import { haptic, pushLayer, dragToDismiss, setStatusBar, setBadge, standalone } from './native.js';
import { track, flush, WatchTracker } from './telemetry.js';
import * as sensors from './sensors.js';
import { renderCard, shareCard } from './share.js';

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
let me = null;               // the signed-in StudyGraph user (from /api/me)
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
const ob = { level: null, step: 1, profile: {}, interests: new Set(), programs: [], selected: new Set(), who: 'self', styles: new Set(), handles: {} };
// StudyGraph's four learning styles, in StudyGraph's words.
const LEARN_STYLES = [['visual', '👀', 'Seeing it', 'diagrams, cards, timelines'], ['listening', '🎧', 'Hearing it explained', 'stories, analogies'], ['reading', '📖', 'Reading it', 'flashcards, notes'], ['handson', '🧩', 'Doing it', 'guessing first, games']];
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

function renderStyles(box = $('#ob-styles'), chosen = ob.styles, onChange = () => {}) {
  box.replaceChildren(...LEARN_STYLES.map(([id, emoji, label, hint]) => {
    const b = el('button', { type: 'button', class: 'chip-btn style-chip', 'aria-pressed': String(chosen.has(id)), title: hint }, `${emoji} ${label}`);
    b.onclick = () => { chosen.has(id) ? chosen.delete(id) : chosen.add(id); b.setAttribute('aria-pressed', String(chosen.has(id))); onChange(); };
    return b;
  }));
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
    const list = el('div', { class: `unit-list${p.units.length > 8 ? ' scroll-box' : ''}` });
    if (p.units.length > 8) {
      const filter = el('input', { type: 'search', class: 'unit-filter', placeholder: `Find a unit (${p.units.length})…`, 'aria-label': 'Find a unit', autocomplete: 'off' });
      filter.oninput = () => { const q = filter.value.trim().toLowerCase(); $$('.unit', list).forEach((b) => { b.classList.toggle('off', Boolean(q) && !b.dataset.search.includes(q)); }); };
      box.append(filter);
    }
    for (const u of p.units) {
      const b = el('button', { type: 'button', class: 'unit', 'aria-pressed': String(ob.selected.has(u.id)), 'data-search': `${u.title} ${u.summary || ''}`.toLowerCase() },
        el('strong', {}, u.title), u.summary ? el('span', {}, u.summary) : null, el('i', { class: 'tick', 'aria-hidden': 'true' }));
      b.onclick = () => {
        ob.selected.has(u.id) ? ob.selected.delete(u.id) : ob.selected.add(u.id);
        b.setAttribute('aria-pressed', String(ob.selected.has(u.id)));
        updateStart();
      };
      list.append(b);
    }
    box.append(list);
    requestAnimationFrame(markOverflow); // the 'scroll for more' hint, once the list has a height
    if (p.sources?.length) {
      box.append(el('p', { class: 'sources' }, 'Sources: ', ...p.sources.slice(0, 4).flatMap((s, i) => [i ? ' · ' : '',
        el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title.slice(0, 48))])));
    }
    if (p.key) box.append(courseHandleBox(p));
    if (p.source === 'catalog' && cfg.research && ob.profile.institution) {
      box.append(el('p', { class: 'sources' }, el('button', { type: 'button', class: 'link', onclick: () => resolvePart(part, block, true) },
        `Match ${ob.profile.institution}'s actual course instead →`)));
    }
  };
  return block;
}

/**
 * Under a course at onboarding: its profile. A course already on StudyGraph is followed as it is
 * (no duplicate); a catalog course has its official handle; a newly researched course is named
 * here by the student who brought it.
 */
function courseHandleBox(p) {
  const box = el('div', { class: 'course-handle' }, el('span', { class: 'spinner small' }));
  api('GET', `/api/channels/for?ref=${encodeURIComponent(p.key)}`).then(({ channel, suggestion }) => {
    if (channel) {
      box.replaceChildren(el('p', {}, '✓ Already on StudyGraph as ', el('strong', {}, `@${channel.handle}`), ` · ${fmtCount(channel.followers)} follower${channel.followers === 1 ? '' : 's'} · ${fmtCount(channel.lessons)} lessons. You'll follow it and share its lessons.`));
      return;
    }
    if (p.source === 'catalog') { box.replaceChildren(el('p', {}, "You'll follow ", el('strong', {}, `@${suggestion}`), ', the official profile for this course.')); return; }
    const start = ob.handles[p.key] || suggestion; // keep what the student typed when the list re-renders
    ob.handles[p.key] = start;
    box.replaceChildren(el('p', {}, "You're the first to bring this course to StudyGraph. Name its profile: classmates who pick the same course will find and follow it."),
      handleField(start, (h) => { if (h) ob.handles[p.key] = h; }));
    // Close matches (the same course researched with a different exam or spelling): follow instead of duplicating.
    api('GET', `/api/channels?q=${encodeURIComponent(p.name)}`).then(({ channels }) => {
      const similar = channels.filter((c) => c.kind === 'course' && !c.official).slice(0, 3);
      if (similar.length) box.append(el('p', { class: 'similar-note' }, 'Similar courses already on StudyGraph. Follow one to share its lessons:'), el('div', { class: 'xch-list' }, ...similar.map((c) => channelCard(c))));
    }).catch(() => {});
  }).catch(() => box.replaceChildren());
  return box;
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
  return { handles: { ...ob.handles }, profile: { ...ob.profile, level: ob.level, age: ageOf(), managedBy: ob.who === 'child' ? 'guardian' : 'self' }, guardianConsent: ob.who === 'child' && $('#ob-consent-box').checked, programKeys: ob.programs.map((p) => p.program.key), units, interests: [...ob.interests], ref: captureRef() || undefined, pack: store.get('st_pack') || undefined, styles: [...ob.styles] };
}

async function runOnboarding(prefill) {
  if (prefill?.profile) {
    ob.level = prefill.profile.level || null;
    ob.profile = { ...prefill.profile };
    ob.interests = new Set(prefill.interests || []);
    ob.styles = new Set(prefill.styles || []);
    const form = $('#details');
    for (const k of ['country', 'institution', 'program', 'exam', 'examDate']) form[k].value = prefill.profile[k] || '';
    ob.who = prefill.profile.managedBy === 'guardian' ? 'child' : 'self';
    $('#ob-age').value = prefill.profile.age || '';
    if (ob.who === 'child') $('#ob-consent-box').checked = true;
  }
  wireWho();
  renderLevels();
  renderTopics();
  renderStyles();
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
    ob.profile = { level: ob.level, country: f.country.value.trim(), institution: f.institution.value.trim(), program: f.program.value.trim(), exam: f.exam.value.trim(), examDate: f.examDate.value || null };
    if (ob.level === 'lifelong') { ob.profile.institution = ob.profile.program = ob.profile.exam = ''; ob.profile.examDate = null; }
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
  // Once per visit, after five in the afternoon: a streak about to lapse gets one gentle nudge.
  try {
    const s = me?.stats;
    if (s && s.streak >= 2 && !s.today && new Date().getHours() >= 17 && !sessionStorage.getItem('st_nudged')) { sessionStorage.setItem('st_nudged', '1'); setTimeout(() => toast(`Your ${s.streak}-day streak ends tonight. One lesson keeps it.`), 1500); }
  } catch { /* fine */ }
  $('#onboard').hidden = true;
  $('#app').hidden = false;
  document.body.classList.remove('onboarding');
}

// ============================================================================ feed: state
const feed = {
  animUntil: 0,     // a slide transition is in flight until then (ms, performance.now())
  dragDy: null,     // the finger's offset while dragging, so a re-layout never snaps it back
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
  // While the finger is down the track follows it exactly; a re-layout keeps that offset.
  if (feed.dragDy != null && !animate) px = feed.dragDy;
  // A re-layout during a slide transition (a lesson swapped in, more lessons arrived) keeps
  // animating towards the new target instead of snapping to it.
  const anim = Boolean(animate) || (feed.dragDy == null && performance.now() < feed.animUntil);
  if (animate) feed.animUntil = performance.now() + 460;
  t.classList.toggle('animating', anim);
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
    reconnect: ['Reconnect your Vidmoat account', 'StudyGraph lost access to your account. Connect it again from your Profile.'],
  }[reason] || ['New lessons are paused', 'Check Credits on your Profile.'];
  const action = reason === 'allowance' || reason === 'reconnect'
    ? el('a', { class: 'btn vidmoat', href: '/api/auth/vidmoat/connect', onclick: () => { track('signin_click', { where: 'feed_connect' }); flush(true); } }, el('img', { class: 'vm-logo', src: 'https://www.vidmoat.com/logo-512.png', alt: '', width: '22', height: '22' }), reason === 'reconnect' ? 'Reconnect' : 'Use my Vidmoat account')
    : el('a', { class: 'btn primary', href: cfg.billingUrl, target: '_blank', rel: 'noopener noreferrer', onclick: () => track('signin_click', { where: 'feed_buy' }) }, 'Buy credits or upgrade');
  $('.stage', feed.endEl).replaceChildren(el('div', { class: 'credits-box' }, el('h3', {}, copy[0]), el('p', {}, copy[1]), action,
    el('button', { type: 'button', class: 'btn ghost', onclick: () => showView('profile') }, 'See Credits in Profile')));
  if (creditsNoted !== reason) { creditsNoted = reason; toast(copy[0]); }
}

// ============================================================================ refresh
/** Reloads what is on screen: the feed (fresh page from the algorithm), the Library or the Profile. */
async function refreshView(which = view) {
  const btn = $(`.refresh-btn[data-refresh="${which}"]`);
  btn?.classList.add('spin');
  track('refresh', { where: which });
  try {
    flush();
    if (which === 'feed') await restartFeed();
    else {
      me = (await api('GET', '/api/me')).user;
      if (which === 'library') await showLibrary(); else if (which === 'explore') await renderExplore(); else renderProfile();
    }
  } catch { toast("Couldn't refresh. Check your connection."); }
  finally { setTimeout(() => btn?.classList.remove('spin'), 500); }
}
/** Pull down from the top of a page (or the first slide) to refresh. */
function wirePullToRefresh() {
  const ptr = $('#ptr');
  for (const page of $$('.view-page')) {
    let startY = null, pulling = false;
    page.addEventListener('touchstart', (e) => { startY = page.scrollTop <= 0 ? e.touches[0].clientY : null; pulling = false; }, { passive: true });
    page.addEventListener('touchmove', (e) => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 10 && page.scrollTop <= 0) { pulling = true; ptr.style.setProperty('--pull', `${Math.min(70, dy * 0.5)}px`); ptr.classList.add('pull'); }
    }, { passive: true });
    page.addEventListener('touchend', async (e) => {
      if (!pulling) { ptr.classList.remove('pull'); return; }
      const dy = e.changedTouches[0].clientY - startY;
      pulling = false; startY = null;
      if (dy > 110) { haptic('pull'); ptr.classList.replace('pull', 'go'); await refreshView(page.dataset.view); }
      ptr.classList.remove('pull', 'go');
    }, { passive: true });
  }
}
let lastActiveAt = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { lastActiveAt = Date.now(); return; }
  // Back after a long break: fresh stats and, on the feed, a fresh page.
  if (Date.now() - lastActiveAt > 10 * 60 * 1000 && view !== 'feed') refreshView(view);
});

// ============================================================================ sensors
// Motion data flows only after a user gesture (iOS asks). A drop pauses the video.
let sensorsStarted = false;
const motionAllowed = () => store.get('st_motion') !== 'off';
async function startSensors() {
  if (sensorsStarted || !motionAllowed()) return;
  sensorsStarted = true;
  const ok = await sensors.start({ onDrop: () => {
    const item = feed.items[feed.active];
    track('drop', { videoId: item?.data?.id, t: +(item?.watch?.lastT || 0).toFixed(1) });
    if (item?.player && !feed.paused) { feed.paused = true; item.player.pause(); item.el.dataset.paused = 'true'; toast('Paused. Tap to continue.'); }
  } });
  track('sensors', { motion: ok, permission: sensors.status().permission });
}
// ============================================================================ feed: navigation
function go(delta) { goTo(feed.active + delta); }
function goTo(index, { animate = true } = {}) {
  const max = feed.items.length; // the end slide
  const target = Math.max(0, Math.min(max, index));
  feed.dragDy = null;
  if (target === feed.active) { setOffset(0, animate); return; }
  if (animate) feed.animUntil = performance.now() + 460; // so anything activate() re-lays out also glides
  activate(target);
  layout(animate);
  if (target >= feed.items.length - 2) loadMore();
}

function wireGestures() {
  const f = feedEl();
  // Older Safari has no overflow: clip; undo any focus-driven scroll of the feed container.
  f.addEventListener('scroll', () => { if (f.scrollTop || f.scrollLeft) { f.scrollTop = 0; f.scrollLeft = 0; } }, { passive: true });
  let start = null;
  let lastTap = 0;
  let tapTimer = null;

  // A swipe may start anywhere, buttons included (like TikTok): a control only gets its tap when
  // the finger did not travel. The progress bar (it seeks) and text fields keep their own gestures.
  let swallowClickUntil = 0;
  f.addEventListener('click', (e) => { if (performance.now() < swallowClickUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
  f.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button > 0 || e.target.closest('input, textarea, select, .progress')) return;
    const onControl = Boolean(e.target.closest('button, a, .quiz'));
    // Caught mid-glide: freeze the track where it is and carry on from there, instead of jumping
    // to the slide it was gliding to.
    const t = trackEl();
    let base = 0;
    if (t.classList.contains('animating')) {
      const y = new DOMMatrixReadOnly(getComputedStyle(t).transform).m42;
      base = y + Math.max(0, feed.active) * slideHeight();
      feed.animUntil = 0;
      t.classList.remove('animating');
      t.style.transform = `translate3d(0, ${y}px, 0)`;
    }
    start = { x: e.clientX, y: e.clientY, t: performance.now(), dy: 0, base, moved: false, onControl, id: e.pointerId, samples: [{ y: e.clientY, t: performance.now() }] };
    if (base) feed.dragDy = base;
    if (!onControl) { try { f.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } }
  });
  f.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    let dy = e.clientY - start.y;
    start.samples.push({ y: e.clientY, t: performance.now() });
    if (start.samples.length > 12) start.samples.shift();
    if (!start.moved && Math.abs(dy) < 8) return;
    if (!start.moved && Math.abs(e.clientX - start.x) > Math.abs(dy)) return; // horizontal: ignore
    if (!start.moved && start.onControl) { try { f.setPointerCapture(e.pointerId); } catch { /* released already */ } }
    start.moved = true;
    const atTop = feed.active <= 0 && start.base + dy > 0;
    const atEnd = feed.active >= feed.items.length && start.base + dy < 0;
    if (atTop || atEnd) dy *= 0.3; // rubber band
    start.dy = dy;
    feed.dragDy = start.base + dy;
    // One write per frame: pointer events can arrive faster than the screen refreshes.
    if (!feed.dragFrame) feed.dragFrame = requestAnimationFrame(() => { feed.dragFrame = 0; if (feed.dragDy != null) setOffset(feed.dragDy, false); });
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const s = start;
    start = null;
    feed.dragDy = null;
    if (feed.dragFrame) { cancelAnimationFrame(feed.dragFrame); feed.dragFrame = 0; }
    if (s.base) setOffset(0, true); // a touch that stopped a glide finishes it
    if (s.moved) swallowClickUntil = performance.now() + 400; // a swipe that began on a button is not a tap
    if (!s.moved) {
      if (s.onControl || s.base) return; // the control handles its own tap; stopping a glide is not a tap
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
    const off = s.base + s.dy; // where the track is, relative to the active slide
    const flick = Math.abs(s.dy) > 20 && Math.abs(v) > 0.28;
    if (off < -h * 0.15 || (flick && v < 0)) go(1);
    else if (feed.active <= 0 && !s.base && s.dy > h * 0.12) { setOffset(0, true); $('#ptr').classList.add('go'); refreshView('feed').finally(() => $('#ptr').classList.remove('go')); }
    else if (off > h * 0.15 || (flick && v > 0)) go(-1);
    else setOffset(0, true);
  };
  f.addEventListener('pointerdown', () => startSensors(), { passive: true });
  f.addEventListener('pointerup', (e) => { startSensors(); end(e); });
  f.addEventListener('pointercancel', (e) => { if (start && e.pointerId === start.id) { start = null; feed.dragDy = null; setOffset(0, true); } });

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
    if ($('#app').hidden || view !== 'feed' || e.target.closest('input, textarea') || !$('#sheet').hidden || talkOpen) return;
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
  $('.share', node).onclick = () => shareLesson(item);
  wireChannelChip(item);
  $('.more', node).onclick = () => openMore(item);
  // Comments are for adults only (server/core/safety.js): the button is not even shown to minors.
  $('.comments', node).onclick = () => openComments(item); // renderSlide shows it on ready lessons, for adults
  $('.up-next', node).onclick = () => { track('upnext_tap', { videoId: item.data.id }); go(1); };
  if (data.status === 'generating') poll(item);
  return item;
}

// ---------------------------------------------------------------------------- moments
// A moment is a card between lessons (a tip, news or an offer) that the server paces
// (server/feed/moments.js). It is rendered here, has no player, and sits in the feed like a slide.
const MOMENT_KICKER = { tip: 'Tip', news: 'News', offer: 'Offer', welcome: 'Welcome back', recap: 'Last time', exam: 'Countdown' };
function addMomentSlide(data) {
  const m = data.moment;
  const node = el('article', { class: 'slide moment-slide', 'data-theme': m.theme || 'sun', 'data-kind': m.type });
  const lines = el('ul', { class: 'm-lines' }, ...m.lines.map((l, i) => el('li', { style: `--i:${i}` }, l)));
  const cta = el('button', { type: 'button', class: 'btn primary m-cta' }, m.cta?.label || 'Keep swiping');
  const stage = el('div', { class: 'stage m-stage' },
    el('div', { class: 'm-bg', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
    m.type === 'offer' ? el('div', { class: 'm-confetti', 'aria-hidden': 'true' }, ...Array.from({ length: 14 }, (_, i) => el('i', { style: `--n:${i}` }))) : null,
    el('div', { class: 'm-card' },
      el('div', { class: 'm-kicker' }, el('span', { class: 'm-emoji' }, m.emoji || '✨'), el('span', {}, MOMENT_KICKER[m.type] || 'Tip'), el('span', { class: 'm-from' }, '· from Noti')),
      el('div', { class: 'm-mascot' }, svgEl(mascot(m.mood || 'happy', 88))),
      el('h2', { class: 'm-title' }, m.title),
      lines, cta),
    el('div', { class: 'm-swipe' }, el('span', {}, 'Tap anywhere or swipe up to continue'), svgEl('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>')));
  node.append(stage);
  const item = { data, el: node, moment: true, player: null, polling: false, viewSent: false, completed: false, watched: 0, lastTime: 0, answered: false, watch: null, shownAt: 0 };
  cta.onclick = (e) => { e.stopPropagation(); momentAction(item, m.cta || { action: 'feed' }); };
  stage.onclick = (e) => { if (!e.target.closest('button')) go(1); };
  ensureEndSlide();
  feed.items.push(item);
  trackEl().insertBefore(node, feed.endEl);
  return item;
}
// ---------------------------------------------------------------------------- mini games
// Games between lessons (server/feed/games.js), made from lessons the student has watched.
// Answers are checked here for instant feedback; the result (which items were missed) goes to
// the server, which updates those units' mastery and brings missed lessons back as recall cards.
const shuffled = (a) => { const o = [...a]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; };
const bestKey = (type) => `st_best_${type}`;
function addGameSlide(data, { at } = {}) {
  const g = data.game;
  const node = el('article', { class: 'slide moment-slide game-slide', 'data-theme': g.theme || 'sky', 'data-game': g.type });
  const body = el('div', { class: 'g-body' });
  const dots = el('div', { class: 'g-dots', 'aria-hidden': 'true' });
  const card = el('div', { class: 'm-card g-card' },
    el('div', { class: 'm-kicker' }, el('span', { class: 'm-emoji' }, g.emoji || '🎮'), el('span', {}, 'Game'), el('span', { class: 'm-from' }, `· ${g.title}`)),
    el('h2', { class: 'm-title g-title' }, g.prompt || g.title),
    el('p', { class: 'g-intro' }, g.unit ? `${g.intro} From “${g.unit}”.` : g.intro),
    body, dots);
  node.append(el('div', { class: 'stage m-stage g-stage' }, el('div', { class: 'm-bg', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), card));
  const item = { data, el: node, moment: true, game: true, player: null, polling: false, viewSent: false, completed: false, watched: 0, lastTime: 0, answered: false, watch: null, shownAt: 0 };
  const st = { wrong: new Set(), started: 0, done: false, timer: null, total: 0 };
  const setDots = (n, i, results = []) => dots.replaceChildren(...Array.from({ length: n }, (_, k) => el('i', { class: results[k] === true ? 'ok' : results[k] === false ? 'bad' : k === i ? 'on' : '' })));
  const clearTimer = () => { clearTimeout(st.timer); st.timer = null; };
  const finish = () => {
    if (st.done) return;
    st.done = true; clearTimer();
    const score = st.total - st.wrong.size;
    const best = Number(store.get(bestKey(g.type))) || 0;
    const pct = st.total ? score / st.total : 0;
    const isBest = pct > 0 && Math.round(pct * 100) > best;
    if (isBest) store.set(bestKey(g.type), String(Math.round(pct * 100)));
    track('game_result', { id: g.id, game: g.type, score, total: st.total, wrong: [...st.wrong].join(','), ms: Date.now() - (st.started || Date.now()) });
    const stars = score === st.total ? 3 : pct >= 0.6 ? 2 : 1;
    body.replaceChildren(el('div', { class: 'g-result' },
      svgEl(mascot(stars === 3 ? 'cheer' : stars === 2 ? 'happy' : 'think', 84)),
      el('div', { class: 'g-stars', 'aria-label': `${stars} of 3 stars` }, '★'.repeat(stars), el('span', {}, '★'.repeat(3 - stars))),
      el('p', { class: 'g-score' }, `${score} / ${st.total}`),
      el('p', { class: 'muted' }, score === st.total ? 'Perfect. Those are yours.' : st.wrong.size === 1 ? 'One slipped. Its lesson will come back for review.' : 'The ones you missed will come back for review.'),
      isBest ? el('span', { class: 'sbadge hot', style: '--r:-3deg' }, 'New best') : null,
      el('div', { class: 'g-actions' },
        el('button', { type: 'button', class: 'btn primary small', onclick: () => go(1) }, 'Next lesson'),
        el('button', { type: 'button', class: 'btn ghost small', onclick: () => playGame(null) }, 'Another game'))));
    dots.replaceChildren();
    if (stars === 3) node.querySelector('.g-stage').append(el('div', { class: 'm-confetti', 'aria-hidden': 'true' }, ...Array.from({ length: 14 }, (_, i) => el('i', { style: `--n:${i}` }))));
  };
  const flash = (btn, cls) => { btn.classList.remove('ok', 'bad'); void btn.offsetWidth; btn.classList.add(cls); };
  const renderers = {
    match() {
      st.total = g.pairs.length;
      const lefts = shuffled(g.pairs.map((p, i) => ({ text: p.left, i }))), rights = shuffled(g.pairs.map((p, i) => ({ text: p.right, i })));
      let sel = null, matched = 0;
      const tile = (x, side) => {
        const b = el('button', { type: 'button', class: `g-tile ${side}` }, x.text);
        b.onclick = () => {
          if (b.disabled) return;
          if (!sel || sel.side === side) { $$('.g-tile.sel', body).forEach((t) => t.classList.remove('sel')); sel = { side, i: x.i, b }; b.classList.add('sel'); return; }
          const left = side === 'l' ? x.i : sel.i;
          if (sel.i === x.i) {
            [b, sel.b].forEach((t) => { t.classList.remove('sel'); t.classList.add('ok'); t.disabled = true; });
            matched++; setDots(st.total, -1, g.pairs.map((_, k) => ($$('.g-tile.l.ok', body).some((t) => t.dataset.i === String(k)) ? !st.wrong.has(k) : undefined)));
            if (matched === st.total) setTimeout(finish, 450);
          } else {
            st.wrong.add(left);
            [b, sel.b].forEach((t) => { t.classList.remove('sel'); flash(t, 'bad'); });
          }
          sel = null;
        };
        b.dataset.i = String(x.i);
        return b;
      };
      body.replaceChildren(el('div', { class: 'g-cols' }, el('div', { class: 'g-col' }, ...lefts.map((x) => tile(x, 'l'))), el('div', { class: 'g-col' }, ...rights.map((x) => tile(x, 'r')))));
      setDots(st.total, -1);
    },
    order() {
      st.total = g.items.length;
      let next = 0;
      const placed = el('ol', { class: 'g-placed' });
      const pool = el('div', { class: 'g-pool' });
      for (const x of shuffled(g.items.map((it, i) => ({ ...it, i })))) {
        const b = el('button', { type: 'button', class: 'g-tile' }, x.text);
        b.onclick = () => {
          if (x.i === next) {
            b.remove();
            placed.append(el('li', { class: st.wrong.has(x.i) ? 'late' : '' }, x.label ? el('b', {}, x.label) : null, x.text));
            next++;
            setDots(st.total, next, g.items.map((_, k) => (k < next ? !st.wrong.has(k) : undefined)));
            if (next === st.total) setTimeout(finish, 450);
          } else { st.wrong.add(next); flash(b, 'bad'); }
        };
        pool.append(b);
      }
      body.replaceChildren(placed, pool);
      setDots(st.total, 0);
    },
    sort() {
      st.total = g.chips.length;
      let i = 0;
      const counts = { L: 0, R: 0 };
      const chip = el('div', { class: 'g-chip', 'aria-live': 'polite' });
      const binL = el('button', { type: 'button', class: 'g-bin' }, el('b', {}, g.left), el('span', {}, '0'));
      const binR = el('button', { type: 'button', class: 'g-bin' }, el('b', {}, g.right), el('span', {}, '0'));
      const show = () => { chip.textContent = g.chips[i].text; chip.classList.remove('in'); void chip.offsetWidth; chip.classList.add('in'); };
      const pick = (side, bin) => {
        if (st.done || i >= st.total) return;
        const ok = g.chips[i].side === side;
        if (!ok) st.wrong.add(i);
        counts[g.chips[i].side]++;
        $('span', binL).textContent = String(counts.L); $('span', binR).textContent = String(counts.R);
        flash(ok ? bin : (side === 'L' ? binL : binR), ok ? 'ok' : 'bad');
        i++;
        setDots(st.total, i, g.chips.map((_, k) => (k < i ? !st.wrong.has(k) : undefined)));
        if (i === st.total) setTimeout(finish, 450); else setTimeout(show, 260);
      };
      binL.onclick = () => pick('L', binL); binR.onclick = () => pick('R', binR);
      body.replaceChildren(chip, el('div', { class: 'g-bins' }, binL, binR));
      show(); setDots(st.total, 0);
    },
    truefalse() {
      st.total = g.statements.length;
      let i = 0, answered = false;
      const text = el('p', { class: 'g-statement' });
      const bar = el('div', { class: 'g-timer' }, el('i'));
      const why = el('p', { class: 'g-why', 'aria-live': 'polite' });
      const yes = el('button', { type: 'button', class: 'g-tf yes' }, 'True');
      const no = el('button', { type: 'button', class: 'g-tf no' }, 'False');
      const answer = (val) => {
        if (answered || st.done) return;
        answered = true; clearTimer();
        const s = g.statements[i];
        const ok = val === s.truth;
        if (!ok) st.wrong.add(i);
        if (val != null) flash(val ? yes : no, ok ? 'ok' : 'bad');
        why.textContent = `${ok ? '✓' : val == null ? '⏱ Time' : '✗'} ${s.truth ? 'True' : 'False'}${s.why ? `: ${s.why}` : '.'}`;
        why.dataset.state = ok ? 'right' : 'wrong';
        bar.classList.remove('run');
        i++;
        setDots(st.total, i, g.statements.map((_, k) => (k < i ? !st.wrong.has(k) : undefined)));
        st.timer = setTimeout(() => (i === st.total ? finish() : show()), s.why ? 1500 : 900);
      };
      const show = () => {
        answered = false; why.textContent = ''; delete why.dataset.state;
        [yes, no].forEach((b) => b.classList.remove('ok', 'bad'));
        text.textContent = g.statements[i].text;
        bar.style.setProperty('--secs', `${g.seconds || 6}s`);
        bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run');
        clearTimer(); st.timer = setTimeout(() => answer(null), (g.seconds || 6) * 1000);
      };
      yes.onclick = () => answer(true); no.onclick = () => answer(false);
      body.replaceChildren(bar, text, el('div', { class: 'g-tfs' }, no, yes), why);
      st.resume = () => { if (!st.done && i < st.total) show(); };
      show(); setDots(st.total, 0);
    },
    fillgap() {
      st.total = g.rounds.length;
      let i = 0;
      const sentence = el('p', { class: 'g-sentence' });
      const opts = el('div', { class: 'g-opts' });
      const show = () => {
        const r = g.rounds[i];
        const [before, after] = r.sentence.split('____');
        sentence.replaceChildren(before, el('span', { class: 'g-blank' }, '?'), after ?? '');
        opts.replaceChildren(...r.options.map((o, k) => {
          const b = el('button', { type: 'button', class: 'g-tile' }, o);
          b.onclick = () => {
            if (opts.dataset.locked) return;
            opts.dataset.locked = '1';
            const ok = k === r.answerIndex;
            if (!ok) st.wrong.add(i);
            flash(b, ok ? 'ok' : 'bad');
            if (!ok) $$('.g-tile', opts)[r.answerIndex].classList.add('ok');
            $('.g-blank', sentence).textContent = r.options[r.answerIndex];
            $('.g-blank', sentence).classList.add(ok ? 'ok' : 'bad');
            i++;
            setDots(st.total, i, g.rounds.map((_, kk) => (kk < i ? !st.wrong.has(kk) : undefined)));
            st.timer = setTimeout(() => { delete opts.dataset.locked; i === st.total ? finish() : show(); }, 1300);
          };
          return b;
        }));
      };
      body.replaceChildren(sentence, opts);
      show(); setDots(st.total, 0);
    },
  };
  item.onEnter = () => {
    if (st.done) return;
    if (!st.started) { st.started = Date.now(); (renderers[g.type] || renderers.match)(); } else st.resume?.();
  };
  item.onLeave = () => { clearTimer(); };
  body.replaceChildren(el('p', { class: 'g-intro' }, 'Get ready…'));
  ensureEndSlide();
  if (at == null || at >= feed.items.length) { feed.items.push(item); trackEl().insertBefore(node, feed.endEl); }
  else { feed.items.splice(at, 0, item); trackEl().insertBefore(node, feed.items[at + 1].el); }
  return item;
}
/** A game on demand (Library › Practice games, or "Another game"), queued right after the current slide. */
async function playGame(type) {
  track('game_open', { game: type || 'any' });
  let r;
  try { r = await api('GET', `/api/games/next${type ? `?type=${type}` : ''}`); }
  catch (err) { toast(err.status === 404 ? 'Watch a few more lessons first: games are made from what you have watched.' : "Couldn't start a game."); return; }
  showView('feed');
  const at = feed.active < 0 ? 0 : feed.active + 1;
  addGameSlide(r.item, { at });
  layout(false);
  goTo(at);
}

// ---------------------------------------------------------------------------- recall cards
// A quick check the student got wrong, back as a card (server/feed/recall.js). Right twice,
// spaced out, retires it; wrong brings it back sooner. No video: the question is the lesson.
function addRecallSlide(data, { at } = {}) {
  const r = data.recall;
  const node = el('article', { class: 'slide moment-slide recall-slide', 'data-theme': 'grape', 'data-kind': 'recall' });
  node.style.setProperty('--accent', data.topic?.accent || '#9b7bff');
  const feedback = el('p', { class: 'r-feedback', 'aria-live': 'polite' });
  const opts = el('div', { class: 'r-options' }, ...r.options.map((opt, i) => el('button', { type: 'button', class: 'quiz-opt r-opt', style: `--i:${i}` }, el('b', {}, 'ABC'[i]), opt)));
  const again = el('button', { type: 'button', class: 'btn ghost small r-again', hidden: true }, 'Watch the lesson again');
  const next = el('button', { type: 'button', class: 'btn primary r-next', hidden: true }, 'Next');
  const skip = el('button', { type: 'button', class: 'r-skip' }, 'Skip for now');
  const stage = el('div', { class: 'stage m-stage r-stage' },
    el('div', { class: 'm-bg', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
    el('div', { class: 'm-card r-card' },
      el('div', { class: 'm-kicker' }, el('span', { class: 'm-emoji' }, '🔁'), el('span', {}, r.box >= 1 ? 'Last time, for keeps' : 'Recall'), el('span', { class: 'm-from' }, '· from Noti')),
      el('div', { class: 'm-mascot' }, svgEl(mascot('think', 88))),
      el('p', { class: 'r-unit' }, `${data.topic?.emoji || ''} ${r.unit || data.topic?.label || 'Quick check'}`.trim(), r.misses > 1 ? el('span', { class: 'r-count' }, `missed ${r.misses}×`) : null),
      el('h2', { class: 'm-title r-q' }, r.question),
      opts, feedback, el('div', { class: 'r-actions' }, again, next, skip)));
  node.append(stage);
  const item = { data, el: node, moment: true, recall: true, player: null, polling: false, viewSent: false, completed: false, watched: 0, lastTime: 0, answered: false, watch: null, shownAt: 0 };
  let shownAt = 0;
  node.addEventListener('transitionend', () => { shownAt ||= Date.now(); }, { once: true });
  $$('.r-opt', opts).forEach((b, i) => { b.onclick = (e) => {
    e.stopPropagation();
    if (item.answered) return;
    item.answered = true;
    const correct = i === r.answerIndex;
    haptic(correct ? 'success' : 'error');
    $$('.r-opt', opts).forEach((x, k) => { x.disabled = true; x.classList.toggle('right', k === r.answerIndex); x.classList.toggle('wrong', k === i && !correct); });
    feedback.textContent = correct ? (r.box >= 1 ? "Right again. That one's yours now. 🎉" : 'Correct! 🎉 One more time in a couple of days and it sticks.') : `Not quite: it's ${'ABC'[r.answerIndex]}. ${r.explanation || ''}`.trim();
    feedback.dataset.state = correct ? 'right' : 'wrong';
    track('recall_answer', { id: r.videoId, correct, ms: Date.now() - (shownAt || item.shownAt || Date.now()) });
    skip.hidden = true; next.hidden = false; again.hidden = correct;
    if (correct && feed.items[feed.active] === item) setTimeout(() => { if (feed.items[feed.active] === item) go(1); }, 1800);
  }; });
  again.onclick = (e) => { e.stopPropagation(); openVideo(r.videoId); };
  next.onclick = (e) => { e.stopPropagation(); go(1); };
  skip.onclick = (e) => { e.stopPropagation(); track('recall_skip', { id: r.videoId }); go(1); };
  stage.onclick = (e) => { if (item.answered && !e.target.closest('button')) go(1); };
  ensureEndSlide();
  if (at == null || at >= feed.items.length) { feed.items.push(item); trackEl().insertBefore(node, feed.endEl); }
  else { feed.items.splice(at, 0, item); trackEl().insertBefore(node, feed.items[at + 1].el); }
  return item;
}
/** Queues the Library's "to fix" questions right after the current slide. */
function fixMisses(list) {
  showView('feed');
  const fresh = list.filter((d) => !feed.items.some((it) => it.data.id === d.id)).slice(0, 10);
  const at = feed.active < 0 ? 0 : feed.active + 1;
  fresh.forEach((d, i) => addRecallSlide(d, { at: at + i }));
  layout(false);
  if (fresh.length) { goTo(at); toast(`${fresh.length} question${fresh.length > 1 ? 's' : ''} to fix. Go.`); }
  else { const i = feed.items.findIndex((it) => it.data.id === list[0]?.id); if (i >= 0) goTo(i); }
}

/** Where a moment's button takes the student. */
function momentAction(item, cta) {
  const m = item.data.moment;
  track('moment_cta', { id: m.id, action: cta.action || 'feed' });
  const seg = (name) => $(`.segmented [data-seg="${name}"]`)?.click();
  const reveal = (sel) => setTimeout(() => $(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  switch (cta.action) {
    case 'library': showView('library'); seg('course'); break;
    case 'explore': showView('explore'); break;
    case 'saved': showView('library'); seg('saved'); break;
    case 'profile': showView('profile'); break;
    case 'invite': showView('profile'); reveal('#invite-card'); break;
    case 'install': showView('profile'); reveal('#install-card'); break;
    case 'reminders': showView('profile'); reveal('#push-card'); break;
    case 'tune': openTune(); break;
    case 'url': if (/^https?:\/\//.test(cta.href || '')) window.open(cta.href, '_blank', 'noopener'); break;
    default: go(1);
  }
}

function unitLabel(d) {
  const name = d.unit?.title || d.topic.label;
  if (d.breather) return `☕ Breather · ${name}`;
  if (d.starter) return `${d.topic.emoji} ${name} · while you wait`;
  return d.position ? `Unit ${d.position.index} of ${d.position.total} · ${name}` : `${d.topic.emoji} ${name}`;
}

function renderSlide(item) {
  const { data: d, el: node } = item;
  node.style.setProperty('--accent', d.topic.accent);
  node.dataset.status = d.status;
  node.dataset.id = d.id;
  const talk = $('.comments', node);
  if (talk) talk.hidden = !me?.can?.comments || d.status !== 'ready' || Boolean(item.moment);
  $('.making-topic', node).textContent = unitLabel(d);
  $('.making-hook', node).textContent = d.status === 'failed' ? "This one didn't work out. Swipe for the next lesson." : d.hook || '';
  const stage = d.status === 'ready' ? 3 : d.title ? 1 : 0;
  $$('.making-steps li', node).forEach((li, i) => { li.classList.toggle('done', i < stage); li.classList.toggle('on', i === stage && d.status === 'generating'); });
  $('.unit-text', node).textContent = unitLabel(d) + (d.subtopic ? ` · ${d.subtopic}` : '');
  $('.title', node).textContent = d.title || '';
  renderChannelChip(item);
  // Social proof, only from real counts and only once it means something.
  const proof = $('.proof', node);
  proof.hidden = !(d.views >= 25);
  proof.textContent = d.views >= 25 ? `👀 ${fmtCount(d.views)} students learned this` : '';
  $('.fmt-badge', node).textContent = d.status === 'ready' && d.format?.tag ? d.format.tag : '';
  $('.like .count', node).textContent = String(d.likes || 0);
  $('.like', node).setAttribute('aria-pressed', String(!!d.liked));
  $('.save', node).setAttribute('aria-pressed', String(!!d.saved));
  $('.save .count', node).textContent = d.saved ? 'Saved' : 'Save';
  const credits = [...new Set((d.credits || []).map((c) => c.by).filter(Boolean))];
  $('.credits', node).textContent = d.pack ? `From ${d.pack.by} · ${d.pack.title}` : credits.length ? `Stock: ${credits.slice(0, 3).join(', ')}` : '';
  const poster = $('.poster', node);
  if (d.poster && poster.getAttribute('src') !== d.poster) poster.src = d.poster;
  if (d.status === 'ready') { renderChapters(item); renderGaps(item); }
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
  setTimeout(() => markViewed(item), 1000);
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
// ---- iOS sound gate -------------------------------------------------------------------------------
// The player's audio runs through a Web Audio context that iOS keeps suspended until a user gesture
// happens inside the player's own (cross-origin) frame. Our gesture layer sits over the frame, so
// until the first tap the frame would never see one. On iOS the first ready slide opens a hole in
// the layer ("Tap here for sound"); when the tap lands in the frame (focus moves into it), the
// document is re-sent so the audio pipeline restarts under that gesture. Once per page load.
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let soundUnlocked = !IOS;
let soundWatch = null;
function soundGate(item) {
  if (soundUnlocked || !item?.player || item.el.dataset.loaded !== 'true' || feed.items[feed.active] !== item) return;
  if (item.el.classList.contains('sound-gate')) return;
  $$('.slide.sound-gate').forEach((s) => { s.classList.remove('sound-gate'); $('.sound-chip', s).hidden = true; });
  item.el.classList.add('sound-gate');
  $('.sound-chip', item.el).hidden = false;
  document.body.classList.add('sound-gated');
  clearInterval(soundWatch);
  const started = Date.now();
  const check = () => {
    if (soundUnlocked) { clearInterval(soundWatch); return; }
    if (document.activeElement !== item.player?.iframe) { if (Date.now() - started > 120000) clearInterval(soundWatch); return; }
    soundUnlocked = true;
    clearInterval(soundWatch);
    item.el.classList.remove('sound-gate');
    $('.sound-chip', item.el).hidden = true;
    document.body.classList.remove('sound-gated');
    try { window.focus(); } catch { /* fine */ }
    // Restart this video's audio pipeline now that the frame has had its gesture.
    const t = Math.max(0, (item.player.time || 0) - 0.3);
    item.player.load(prepareDocument(item, { reveal: item.revealed }), t);
    item.player.play();
    track('sound_unlock', { videoId: item.data.id, t: Math.round(t) });
  };
  soundWatch = setInterval(check, 200);
  window.addEventListener('blur', () => setTimeout(check, 0), { once: true });
}

function mountPlayer(item) {
  if (item.player || item.moment || item.data.status !== 'ready') return;
  const duration = item.data.duration || 0;
  item.player = new VidmoatPlayer($('.player-host', item.el), cfg.playerOrigin, {
    onLoaded: () => {
      item.el.dataset.loaded = 'true';
      if (feed.items[feed.active] === item && !feed.paused && view === 'feed') item.player.play();
      soundGate(item);
      if (feed.items[feed.active] === item) syncPlayers(); // phones: the next lesson may start loading now
    },
    onState: ({ time, playing, audioTime }) => { onState(item, time, playing, duration); if (playing && audioTime != null) noteDrift(item, time, audioTime); },
    onRetry: (n) => { $('.making-note', item.el).textContent = n === 1 ? 'Slow connection. Loading once more…' : 'Still loading. One more try…'; sendEvent(item.data.id, 'player_retry', { n }); },
    onError: (msg) => {
      item.el.dataset.status = 'failed';
      $('.making-hook', item.el).textContent = /taking too long|could not load/i.test(msg) ? 'This one is slow to load. Swipe on, or come back to it.' : msg;
      sendEvent(item.data.id, 'player_error', { msg: String(msg).slice(0, 80) });
    },
  });
  item.player.load(prepareDocument(item), 0);
}
function unmountPlayer(item) {
  if (!item.player) return;
  item.player.destroy();
  item.player = null;
  delete item.el.dataset.loaded;
}
// ---- Live document edits ---------------------------------------------------------------------------
// The player only ever sees the document we hand it, so the app can change the lesson before it
// plays (and re-send it at the current time): captions, music and narration on or off, recall
// mode that hides the key terms, chapter markers from the scenes, and a stamp with the student's
// quiz answer inside the video. No new video is made for any of this.
// Sound effects are separate audio elements (five to eight per lesson); phones keep audio and
// video in step better with fewer of them, so they are off there unless the student turns them on.
const PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const PLAY_DEFAULTS = { captions: 'on', music: 'on', voice: 'on', sfx: PHONE ? 'off' : 'on', gaps: 'review', speed: '1', data: 'auto' }; // gaps: off | review | all
/** Playback speed the student chose (retime.js). */
/** Data saver: chosen, or Auto and the phone asks to save data (Chrome/Android Save-Data). */
const dataSaver = () => playPref('data') === 'on' || (playPref('data') === 'auto' && Boolean(navigator.connection?.saveData));
const speedPref = () => { const r = Number(playPref('speed')); return SPEEDS.includes(r) ? r : 1; };
const playPref = (k) => store.get(`st_play_${k}`) || PLAY_DEFAULTS[k];
const CAPTION_TRACK = 6;
const isCaption = (c) => c.type === 'text' && c.trackIndex === CAPTION_TRACK;
const isVoice = (c) => c.type === 'audio' && /^voice/.test(c.id || '');
const isMusic = (c) => c.type === 'audio' && c.id === 'music';
const isSfx = (c) => c.type === 'audio' && !isVoice(c) && !isMusic(c);
// Text the gaps may hide: captions, beats, items, cards, the explanation; never the quiz options, labels or the chip.
const GAP_SAFE = /^(opt|quiz|chip|outroLabel|kick|num)/;
const blank = (term) => '▁'.repeat(Math.min(9, Math.max(4, Math.round(term.length * 0.7))));
/** Should this lesson open in recall mode? */
function gapsFor(item) {
  const pref = playPref('gaps');
  if (pref === 'off' || !item.data.terms?.length || !item.data.document) return false;
  if (pref === 'all') return true;
  return Boolean(item.data.why?.review > 0 || item.data.why?.video?.retrieval);
}
/** A copy of the document with the viewer's playback choices applied. */
function prepareDocument(item, { reveal = false } = {}) {
  const src = item.data.document;
  if (!src?.clips) return src;
  item.gaps ??= gapsFor(item);
  const voiceOff = playPref('voice') === 'off' || (item.gaps && !reveal);
  const clips = [];
  for (const c of src.clips) {
    if (isCaption(c) && playPref('captions') === 'off') continue;
    if (isMusic(c) && (playPref('music') === 'off' || dataSaver())) continue;
    if (isSfx(c) && playPref('sfx') === 'off') continue;
    if (isVoice(c) && voiceOff) continue;
    let out = c;
    if (item.gaps && !reveal && c.type === 'text' && !GAP_SAFE.test(c.id || '') && c.textStyle?.content) {
      let text = c.textStyle.content;
      for (const term of item.data.terms) {
        const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        text = text.replace(re, blank(term));
      }
      if (text !== c.textStyle.content) out = { ...c, textStyle: { ...c.textStyle, content: text } };
    }
    clips.push(out);
  }
  if (item.stamp) clips.push(item.stamp);
  // Speed: the frame gets a retimed copy and the wrapper converts its times back to lesson seconds.
  const rate = speedPref();
  if (item.player) item.player.rate = rate;
  return { ...src, clips: retimeClips(clips, rate) };
}
/** Re-sends the active lesson's document with the current choices, keeping the time. */
function reloadDocument(item, opts = {}) {
  if (!item?.player || item.moment) return;
  const t = item.lastTime || 0;
  item.player.load(prepareDocument(item, opts), t);
}
/** The chip over a recall-mode lesson: tap to reveal the hidden terms (re-sends the full document). */
function renderGaps(item) {
  const chip = $('.gaps-chip', item.el);
  if (!chip) return;
  item.gaps ??= gapsFor(item);
  chip.hidden = !item.gaps;
  if (!item.gaps) return;
  chip.dataset.revealed = String(Boolean(item.revealed));
  $('span', chip).textContent = item.revealed ? `Revealed: ${item.data.terms.slice(0, 4).join(', ')}${item.data.terms.length > 4 ? '…' : ''}` : 'Recall mode: key terms hidden, narration off. Tap to reveal.';
  chip.onclick = (e) => {
    e.stopPropagation();
    if (item.revealed) { item.gaps = false; item.revealed = false; renderGaps(item); reloadDocument(item); return; }
    item.revealed = true;
    renderGaps(item);
    sendEvent(item.data.id, 'gaps_reveal', { t: +(item.lastTime || 0).toFixed(1) });
    reloadDocument(item, { reveal: true });
  };
}
/** Chapter markers on the progress bar, one per scene; tapping one jumps there. */
function renderChapters(item) {
  const bar = $('.progress', item.el);
  const scenes = (item.data.scenes || []).filter((s) => s.start > 0.5 && s.kind !== 'outro');
  const dur = item.data.duration || 0;
  if (!bar || !dur || !scenes.length) return;
  $$('.chap', bar).forEach((x) => x.remove());
  for (const s of scenes) bar.append(el('i', { class: 'chap', style: `left:${(s.start / dur) * 100}%`, title: s.kind }));
  bar.onclick = (e) => {
    e.stopPropagation();
    if (!item.player?.loaded) return;
    const r = bar.getBoundingClientRect();
    const t = Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
    const all = [{ start: 0 }, ...scenes].filter((s) => s.start <= t + 0.75);
    const to = all[all.length - 1].start;
    sendEvent(item.data.id, 'chapter_seek', { from: +(item.lastTime || 0).toFixed(1), to: +to.toFixed(1) });
    item.player.seek(to); // the player pauses on every seek
    if (!feed.paused && !item.held) item.player.play();
    if (item.watch) item.watch.pauseBy = 'seek';
  };
}
/** Stamps the student's answer into the video over the reveal (re-sent while the video is held). */
function stampAnswer(item, choice, correct) {
  const q = item.data.quiz, doc = item.data.document;
  if (!doc?.clips || !item.player?.loaded || q?.reveal == null) return;
  const base = doc.clips.find((c) => c.id === 'explain' || c.id === 'quizLabel') || doc.clips.find((c) => c.type === 'text');
  if (!base) return;
  const end = Math.min(item.data.duration || q.reveal + 6, q.reveal + 6);
  item.stamp = { ...base, id: 'youSaid', trackIndex: 20, start: +q.reveal.toFixed(2), duration: +(end - q.reveal).toFixed(2), y: 700, x: 0, opacity: 1, kfOpacity: [], kfY: [], kfScale: [], kfX: [],
    textStyle: { ...base.textStyle, content: correct ? `You said ${'ABC'[choice]}  ✓  Correct` : `You said ${'ABC'[choice]}  ·  It was ${'ABC'[q.answerIndex]}`, fontSize: 44, fontWeight: 800, color: '#0b0b0b', bgColor: correct ? '#9be37d' : '#ffd93d', bgOpacity: 1, bgPadding: 22, bgRadius: 999, align: 'center', outlineWidth: 0, shadow: false, highlight: '' } };
  sendEvent(item.data.id, 'quiz_stamp');
  item.player.load(prepareDocument(item, { reveal: item.revealed }), q.hold ?? (item.lastTime || 0));
}

// Playback performance: the embed player decodes every video layer of a document in the
// browser, so only the active lesson has a live player. The next one is mounted (paused, loading
// its document) once the viewer is halfway through the current lesson, or at once when the
// current slide has nothing to play; the previous one is unmounted immediately.
/**
 * Players for the active lesson (and the next, preloading). `light` only plays and pauses the
 * players that exist (cheap postMessages) and schedules the heavy part, creating and removing
 * player frames and posting documents, for when the slide transition has landed, so a swipe
 * never waits on it.
 */
function syncPlayers({ light = false } = {}) {
  if (light) {
    feed.items.forEach((item, i) => { if (item.player) { if (i === feed.active && !feed.paused && view === 'feed' && !feed.covered && !item.held) item.player.play(); else item.player.pause(); } });
    clearTimeout(feed.syncTimer);
    feed.syncTimer = setTimeout(() => syncPlayers(), Math.max(0, feed.animUntil - performance.now()) + 40);
    return;
  }
  clearTimeout(feed.syncTimer);
  if (feed.dragDy != null || performance.now() < feed.animUntil) { feed.syncTimer = setTimeout(() => syncPlayers(), 120); return; }
  const active = feed.items[feed.active];
  // Phones (iOS in particular) load media slowly and the player gives up after 15 s, so the next
  // lesson is only preloaded once the active one has actually loaded; on desktop it starts at once.
  const phone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const activeLoaded = Boolean(active?.player) && active.el.dataset.loaded === 'true';
  // Data saver: the next lesson is never fetched ahead (only when it becomes the one on screen).
  const preloadNext = !dataSaver() && (!active || active.data.status !== 'ready' || active.preloadNext || (!phone && !active.player) || (phone && activeLoaded));
  feed.items.forEach((item, i) => {
    const keep = feed.active >= 0 && (i === feed.active || (i === feed.active + 1 && preloadNext));
    if (keep) mountPlayer(item); else unmountPlayer(item);
    if (!item.player) return;
    if (i === feed.active && !feed.paused && view === 'feed' && !feed.covered && !item.held) item.player.play(); else item.player.pause();
  });
  soundGate(feed.items[feed.active]);
}
/**
 * Sync drift: the player reports its master clock and its audio clock; the gap is how far the
 * picture and the narration are apart. The worst gap of each view is sent once (drift, in
 * seconds) when it exceeds a quarter second, so the sheet shows whether the player's fix holds.
 */
function noteDrift(item, time, audioTime) {
  const d = Math.abs(time - audioTime);
  item.drift = Math.max(item.drift || 0, d);
  if (d >= 0.25 && !item.driftSent && feed.items[feed.active] === item) {
    item.driftSent = true;
    sendEvent(item.data.id, 'drift', { d: +d.toFixed(2), t: +time.toFixed(1) });
  }
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
  // An open loop: near the end, a line from the next lesson (curiosity pulls the swipe; nothing autoplays).
  if (isActive && duration && !item.teased && time >= duration * 0.72 && (!q || item.answered || time > (q.reveal ?? 0) + 1)) showUpNext(item);
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
  haptic('success');
  const stage = $('.stage', item.el).getBoundingClientRect();
  const burst = $('.heart-burst', item.el);
  burst.style.left = `${e.clientX - stage.left}px`;
  burst.style.top = `${e.clientY - stage.top}px`;
  burst.classList.remove('go'); void burst.offsetWidth; burst.classList.add('go');
  if (!item.data.liked) toggleFlag(item, 'liked', 'like', 'unlike', 'double-tap');
}

function toggleFlag(item, field, onType, offType, by = 'button') {
  if (!item || item.moment) return;
  const on = !item.data[field];
  item.data[field] = on;
  haptic(on ? 'select' : 'tap');
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
  haptic(correct ? 'success' : 'error');
  const box = $('.quiz', item.el);
  $$('.quiz-opt', box).forEach((b, k) => {
    b.disabled = true;
    b.classList.toggle('right', k === q.answerIndex);
    b.classList.toggle('wrong', k === i && !correct);
  });
  $('.quiz-feedback', box).textContent = correct ? 'Correct! 🎉' : `Not quite: it's ${'ABC'[q.answerIndex]}. We'll bring this back for review.`;
  if (correct) showMastery(item);
  sendEvent(item.data.id, 'quiz_answer', { correct, choice: i, ms: Date.now() - (item.heldAt || item.quizShownAt || Date.now()) });
  if (item.held && item.el.dataset.loaded === 'true') stampAnswer(item, i, correct);
  setTimeout(() => release(item), 700);
}

// ---------------------------------------------------------------------------- why sheet
function openWhy(item) {
  const d = item.data, w = d.why || {};
  const reasons = [];
  if (d.breather) reasons.push(['☕', d.breather.text || 'A short, fun detour next door to your subject. Your units are next.']);
  if (w.starter) reasons.push(['⏱️', `A ready lesson from the library while yours is being made${d.queuedFor ? ` (${d.queuedFor})` : ''}.`]);
  if (w.explored) reasons.push(['🧭', 'Something a little different. A small share of your feed explores, so it never gets stale.']);
  if (w.kind === 'course' && w.progress >= 0.7) reasons.push(['📚', d.position ? `Next up in your syllabus: unit ${d.position.index} of ${d.position.total}.` : 'Next up in your syllabus.']);
  else if (w.kind === 'course') reasons.push(['📚', 'Part of your course.']);
  if (w.kind === 'interest') reasons.push(['✨', `From your interests: ${d.topic.label}.`]);
  if (w.kind === 'follow') reasons.push(['➕', `From a course you follow${d.channel ? `: @${d.channel.handle}` : ''}.`]);
  if (w.intent > 0) reasons.push(['👀', `You just looked at ${d.channel ? `@${d.channel.handle}` : 'this course'}'s profile, so your feed leans towards it for a while.`]);
  if (d.pack) reasons.push(['📘', `Made from the community pack "${d.pack.title}" by ${d.pack.by}${d.pack.link ? `. ${d.pack.cta || 'Find out more'}: ${d.pack.link}` : '.'}`]);
  if (w.review > 0) reasons.push(['🔁', 'Due for review. Spaced repetition brings units back after 1, 3, 7 and 21 days, and sooner when a quiz goes wrong.']);
  if (w.affinity >= 0.6) reasons.push(['❤️', "You've been finishing and liking lessons like this."]);
  const v = w.video || {};
  if (v.formatAffinity >= 0.6) reasons.push(['🎬', `You tend to watch ${d.format?.name || 'this kind of'} videos through, so this one is a ${d.format?.name || 'match'}.`]);
  else if (v.diversity < 1) reasons.push(['🎬', `A ${d.format?.name || 'different'} video, to change the pace from the last one.`]);
  else if (d.format?.name) reasons.push(['🎬', `Format: ${d.format.name}. The feed rotates 32 formats so it never feels the same.`]);
  if (v.quality >= 0.6) reasons.push(['⭐', 'Other students watched this one to the end.']);
  if (v.fatigue > 1.05) reasons.push(['☕', "You've watched a lot this session, so here is something lighter."]);
  if (v.difficulty < 1) reasons.push(['🧩', 'A gentler format after a couple of tricky questions.']);
  else if (v.difficulty > 1) reasons.push(['🏋️', "You're on a streak, so this one pushes a little harder."]);
  const p = me?.profile || {};
  const lvl = cfg.levels.find((l) => l.id === p.level);
  if (lvl) reasons.push(['🎓', `Pitched at ${lvl.label}${p.exam ? `, in ${p.exam} terms` : ''}.`]);
  if (!reasons.length) reasons.push(['🎯', 'Picked for you from your course and interests.']);
  const body = el('div', {}, el('ul', { class: 'why-list' }, ...reasons.map(([icon, text]) => el('li', {}, el('span', {}, icon), el('span', {}, text)))));
  if (d.notes) body.append(el('button', { type: 'button', class: 'btn primary notes-btn', onclick: () => openNotes(item) }, '📝 Lesson notes'));
  openSheet("Why you're seeing this", body);
}
let sheetOnClose = null;
/** The lesson as a revision sheet: what it set out to teach, the points, definitions, the quick check and the takeaway. */
function openNotes(item) {
  const d = item.data, n = d.notes;
  if (!n) return;
  sendEvent(d.id, 'notes_open');
  const sec = (title, ...kids) => (kids.filter(Boolean).length ? el('section', { class: 'notes-sec' }, el('h4', {}, title), ...kids.filter(Boolean)) : null);
  const body = el('div', { class: 'notes' },
    el('p', { class: 'notes-kicker' }, `${d.unit?.title || d.topic.label}${d.format?.name ? ` · ${d.format.name}` : ''}${n.reviewed ? ' · reviewed' : ''}`),
    n.objective ? el('p', { class: 'notes-objective' }, el('b', {}, 'Goal: '), n.objective) : null,
    n.keyTerms?.length ? el('div', { class: 'chips notes-terms' }, ...n.keyTerms.map((t) => el('span', { class: 'chip-btn on' }, t))) : null,
    sec('Points', n.points?.length ? el('ol', {}, ...n.points.map((p) => el('li', {}, p))) : null),
    sec('Definitions', ...(n.definitions || []).map((x) => el('p', {}, el('b', {}, x.term), ': ', x.meaning))),
    sec('Equations', ...(n.equations || []).map((x) => el('p', { class: 'notes-eq' }, el('code', {}, x.lines.join('   ')), x.meaning ? el('small', {}, x.meaning) : null))),
    n.myth || n.fact ? sec('Myth and fact', n.myth ? el('p', {}, el('b', {}, 'Myth: '), n.myth) : null, n.fact ? el('p', {}, el('b', {}, 'Fact: '), n.fact) : null) : null,
    sec('Flashcards', ...(n.cards || []).map((c) => el('p', {}, el('b', {}, c.q), el('br'), c.a))),
    n.quiz ? sec('Quick check', el('p', {}, n.quiz.question), el('ol', { class: 'notes-opts', type: 'A' }, ...n.quiz.options.map((o, i) => el('li', { class: i === n.quiz.answerIndex ? 'right' : '' }, o))), n.quiz.explanation ? el('p', { class: 'muted' }, n.quiz.explanation) : null) : null,
    n.takeaway ? el('p', { class: 'notes-takeaway' }, n.takeaway) : null,
    el('div', { class: 'notes-actions' },
      el('button', { type: 'button', class: 'btn small', onclick: async () => {
        const text = [n.title || d.title, n.objective && `Goal: ${n.objective}`, ...(n.points || []).map((p, i) => `${i + 1}. ${p}`), ...(n.definitions || []).map((x) => `${x.term}: ${x.meaning}`), n.quiz && `Q: ${n.quiz.question} → ${n.quiz.options[n.quiz.answerIndex]}`, n.takeaway && `Remember: ${n.takeaway}`, `${location.origin}/v/${d.id}`].filter(Boolean).join('\n');
        try { await navigator.clipboard.writeText(text); toast('Notes copied.'); } catch { toast("Couldn't copy."); }
        sendEvent(d.id, 'notes_copy');
      } }, 'Copy notes'),
      d.pack?.link ? el('a', { class: 'btn small ghost', href: d.pack.link, target: '_blank', rel: 'noopener noreferrer' }, d.pack.cta || 'Source') : null));
  openSheet(n.title || d.title || 'Lesson notes', body);
}
/** What StudyGraph plans to teach in a unit, and what it has covered so far. */
async function openUnitPlan(u) {
  track('plan_open', { unitId: u.id });
  const r = await api('GET', `/api/units/${encodeURIComponent(u.id)}/plan`).catch(() => null);
  const body = el('div', { class: 'plan' });
  if (!r) { body.append(el('p', { class: 'muted' }, "Couldn't load this unit's plan.")); }
  else if (!r.plan) {
    body.append(el('p', { class: 'muted' }, r.unit.summary || ''), el('p', {}, 'The study plan is written with the first lessons of this unit. Watch one and come back.'));
  } else {
    const done = r.plan.concepts.filter((c) => c.covered).length;
    body.append(el('p', { class: 'muted' }, `${done} of ${r.plan.concepts.length} concepts covered so far. Each lesson teaches one, in this order.`));
    body.append(el('ol', { class: 'plan-list' }, ...r.plan.concepts.map((c) => el('li', { class: c.covered ? 'done' : '' },
      el('b', {}, c.title), el('span', {}, c.objective), c.misconception ? el('small', {}, `Watch out: ${c.misconception}`) : null))));
    if (r.plan.glossary?.length) body.append(el('h4', {}, 'Glossary'), el('dl', { class: 'plan-gloss' }, ...r.plan.glossary.flatMap((g) => [el('dt', {}, g.term), el('dd', {}, g.meaning)])));
  }
  openSheet(u.title, body);
}
function openSheet(title, body, onClose = null) {
  // At the top level, so it can sit above a course profile (#app is fixed: its own stacking context).
  if ($('#sheet').parentElement !== document.body) document.body.append($('#sheet'));
  // A sheet opened from inside another: let the first one tidy up (a settings card goes home).
  if (!$('#sheet').hidden && sheetOnClose) { const cb = sheetOnClose; sheetOnClose = null; cb(); }
  $('#sheet-title').textContent = title;
  $('#sheet-body').replaceChildren(body);
  if ($('#sheet').hidden) {
    sheetLayerDone = pushLayer(() => closeSheet({ fromBack: true })); // the phone's Back closes it
    if (!openSheet.wired) {
      openSheet.wired = true;
      for (const h of [$('#sheet .sheet-grip'), $('#sheet-title')]) dragToDismiss($('#sheet .sheet-panel'), h, () => closeSheet());
    }
  }
  $('#sheet').hidden = false;
  sheetOnClose = onClose;
  feed.items[feed.active]?.player?.pause();
}
let sheetLayerDone = null;
async function closeSheet() {
  sheetLayerDone?.(); sheetLayerDone = null;
  $('#sheet').hidden = true;
  const cb = sheetOnClose;
  sheetOnClose = null;
  if (cb) await cb();
  if (view === 'feed' && !feed.paused && !feed.covered) feed.items[feed.active]?.player?.play();
}

// ---------------------------------------------------------------------------- activation & paging
function activate(index) {
  feed.items.forEach((it, i) => { if (i !== index && it.teased) { it.teased = false; const u = it.el && $('.up-next', it.el); if (u) u.hidden = true; } });
  if (index === feed.active) return;
  const prev = feed.items[feed.active];
  const dir = index > feed.active ? 'next' : 'prev';
  if (prev) {
    if (prev.watch) prev.watch.leave(dir); else if (prev.data.status === 'generating' && prev.shownAt) track('gen_wait', { videoId: prev.data.id, ms: Date.now() - prev.shownAt, outcome: 'gave_up' });
    prev.watch = null;
    prev.el.dataset.paused = 'false';
    if (prev.moment) prev.el.classList.remove('on');
    prev.onLeave?.();
  }
  feed.active = index;
  feed.paused = false;
  const item = feed.items[index];
  if (item) {
    item.watched = 0; item.lastTime = 0; item.completed = false; item.preloadNext = false;
    item.shownAt = Date.now();
    if (dir === 'prev' && item.viewSent) sendEvent(item.data.id, 'rewatch');
    if (item.player?.loaded) item.player.seek(0);
    if (view === 'feed' && !item.moment) history.replaceState(null, '', `#v=${item.data.id}`);
    if (item.moment) requestAnimationFrame(() => item.el.classList.add('on')); // (re)start its animation
    if (item.onEnter) setTimeout(() => { if (feed.items[feed.active] === item) item.onEnter(); }, 350);
    clearTimeout(activate.viewTimer);
    activate.viewTimer = setTimeout(() => {
      markViewed(item);
    }, 1000);
    if (index > 0) { $('#swipe-hint').hidden = true; store.set('st_swiped', '1'); }
  }
  preferReady();
  syncPlayers({ light: true });
}

/** Counts a view once the active slide has been ready for a second (also when it finishes generating while active). */
function markViewed(item) {
  if (feed.items[feed.active] !== item || item.viewSent || item.data.status !== 'ready') return;
  item.viewSent = true;
  if (item.recall) { track('recall_view', { id: item.data.recall.videoId }); return; }
  if (item.game) { track('game_view', { id: item.data.game.id, game: item.data.game.type }); return; }
  if (item.gaps) sendEvent(item.data.id, 'gaps_on', { auto: playPref('gaps') === 'review' });
  if (item.moment) { track('moment_view', { id: item.data.moment.id, kind: item.data.moment.type }); return; }
  nthVideo++;
  sendEvent(item.data.id, 'view', { nth: nthVideo, format: item.data.format?.id, source: item.source || 'feed' });
  bumpGoal();
}

// ---- engagement that serves learning: a visible daily goal, the next lesson's hook, progress after a quiz ----
/** The daily goal ring in the feed header (stats.today of stats.goal, from /api/me; counted up locally). */
function renderGoalPill() {
  const pill = $('#goal-pill');
  const s = me?.stats;
  if (!pill || !s) return;
  const goal = s.goal || 3, n = s.today || 0;
  pill.hidden = false;
  pill.classList.toggle('done', n >= goal);
  $('.gp-fill', pill).style.strokeDashoffset = String(100 - Math.min(100, (n / goal) * 100));
  $('.gp-n', pill).textContent = n >= goal ? `${n} ✓` : `${n}/${goal}`;
  pill.setAttribute('aria-label', n >= goal ? `Daily goal done: ${n} lessons today` : `Today: ${n} of ${goal} lessons`);
}
function bumpGoal() {
  if (!me?.stats) return;
  const goal = me.stats.goal || 3;
  const before = me.stats.today || 0;
  me.stats.today = before + 1;
  renderGoalPill();
  if (before < goal && me.stats.today >= goal) { track('goal_reached', { goal }); levelUp([{ kind: 'goal', goal, streak: me.stats.streak || 0 }]); }
}

/** "Up next: <the next lesson's hook>" near the end of a lesson. */
function showUpNext(item) {
  item.teased = true;
  const next = feed.items[feed.active + 1];
  if (!next) return;
  const d = next.data || {};
  const text = next.game ? 'A quick game from what you just watched 🎮' : next.recall ? 'One you missed earlier. Can you get it now?' : next.moment ? null : d.status === 'ready' ? (d.hook || d.title) : null;
  if (!text) return;
  const box = $('.up-next', item.el);
  $('.un-t', box).textContent = text;
  box.hidden = false;
  track('upnext_shown', { videoId: item.data.id });
}

/** After a right answer: how close the unit is to mastered (from the viewer's mastery before this lesson). */
function showMastery(item) {
  const d = item.data;
  if (d.mastery == null || !d.unit?.title) return;
  const after = Math.min(1, d.mastery + 0.12);
  const bar = el('span', { class: 'mp-bar' }, el('i', { style: `width:${Math.round(d.mastery * 100)}%` }));
  const pill = el('p', { class: 'mastery-pill' }, el('span', { class: 'mp-label' }, after >= 0.7 ? `${d.unit.title} · nearly mastered` : `${d.unit.title} · getting stronger`), bar);
  $('.quiz', item.el).append(pill);
  requestAnimationFrame(() => requestAnimationFrame(() => { $('i', bar).style.width = `${Math.round(after * 100)}%`; }));
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
    items.filter((d) => !feed.items.some((it) => it.data.id === d.id)).forEach((d) => (d.kind === 'moment' ? addMomentSlide(d) : d.kind === 'recall' ? addRecallSlide(d) : d.kind === 'game' ? addGameSlide(d) : addSlide(d)));
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
  me = { ...me, ...res.user, billing: me?.billing }; // keep the computed parts (stats, learning, invites) /api/me added
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

  // Playback: applied to the lesson on screen at once, and to every lesson after it.
  body.append(el('h4', {}, 'Playback'));
  const PLAY = [
    ['gaps', 'Recall mode', [['off', 'Off'], ['review', 'Review lessons'], ['all', 'Every lesson']], 'Hides the key terms in the on-screen text and mutes the narration; tap the chip to reveal.'],
    ['captions', 'Captions', [['on', 'On'], ['off', 'Off']]],
    ['voice', 'Narration audio', [['on', 'On'], ['off', 'Off']]],
    ['music', 'Music', [['on', 'On'], ['off', 'Off']]],
    ['sfx', 'Sound effects', [['on', 'On'], ['off', 'Off']], PHONE ? 'Off on phones by default: fewer sounds keep the narration and the picture in step.' : null],
    ['speed', 'Speed', SPEEDS.map((r) => [String(r), `${r}×`])],
    ['data', 'Data saver', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], 'Saves mobile data: the next lesson only loads when you reach it, and the music is left out. Auto turns it on when your phone is in data-saving mode.'],
  ];
  for (const [key, label, options, hint] of PLAY) {
    const row = el('div', { class: 'pref-row' }, el('span', { class: 'pref-label' }, label));
    const seg = el('div', { class: 'segmented small', role: 'group', 'aria-label': label });
    for (const [val, text] of options) {
      const b = el('button', { type: 'button', 'aria-selected': String(playPref(key) === val) }, text);
      b.onclick = () => {
        store.set(`st_play_${key}`, val);
        $$('button', seg).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        track('play_pref', { key, value: val });
        const active = feed.items[feed.active];
        if (active?.player && !active.moment) { if (key === 'gaps') { active.gaps = gapsFor(active); active.revealed = false; renderGaps(active); } reloadDocument(active, { reveal: active.revealed }); }
      };
      seg.append(b);
    }
    row.append(seg);
    body.append(row);
    if (hint) body.append(el('p', { class: 'pref-hint' }, hint));
  }

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
    const added = await addCustomTopic(title);
    if (!added) return;
    input.value = '';
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

// ============================================================================ level-up burst
const burstQueue = [];
let bursting = false;
function levelUp(items) {
  burstQueue.push(...items);
  if (!bursting) nextBurst();
}
function nextBurst() {
  const item = burstQueue.shift();
  if (!item) { bursting = false; return; }
  bursting = true;
  const host = $('#burst');
  if (item.kind === 'goal') {
    const card = el('div', { class: 'burst-card' }, svgEl(mascot('cheer', 96)), el('b', {}, 'Daily goal done!'),
      el('span', {}, `${item.goal} lessons today. Anything more is a bonus.`), item.streak >= 2 ? sbadge(`🔥 ${item.streak}-day streak`, { hot: true, r: 2 }) : null,
      el('div', { class: 'burst-actions' }, el('button', { type: 'button', class: 'btn ghost small', onclick: () => close() }, 'Keep going')));
    const close = () => { card.classList.add('leaving'); setTimeout(() => { host.hidden = true; nextBurst(); }, 420); };
    host.replaceChildren(card);
    host.hidden = false;
    setTimeout(close, 3500);
    return;
  }
  track('level_up', { unitId: item.unitId });
  const colors = ['#ffd93d', '#ff6b6b', '#34d399', '#8fc1ff', '#f472b6', '#141414'];
  const confetti = Array.from({ length: 26 }, (_, i) => {
    const a = (i / 26) * Math.PI * 2, r = 140 + Math.random() * 160;
    return el('i', { class: 'confetti', style: `background:${colors[i % colors.length]};--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r + 80}px;--r:${Math.round(Math.random() * 720)}deg;--d:${(Math.random() * 0.25).toFixed(2)}s` });
  });
  let timer;
  const close = () => { clearTimeout(timer); card.classList.add('leaving'); setTimeout(() => { host.hidden = true; nextBurst(); }, 420); };
  const shareBtn = el('button', { type: 'button', class: 'btn primary small', onclick: async () => {
    clearTimeout(timer);
    track('levelup_share', { unitId: item.unitId });
    try {
      const blob = await renderCard({ kind: 'levelup', kicker: 'Level up', title: `I just mastered ${item.title}`, mark: item.title, subtitle: 'Quick checks passed, unit learned.',
        stats: [{ value: me?.stats?.mastered ?? 1, label: 'mastered', hl: true }, { value: me?.stats?.streak ?? 0, label: 'day streak' }, { value: me?.stats?.watched ?? 0, label: 'lessons' }],
        line: 'Another one down. Who is next?', mascot: mascot('cheer', 300), memberNo: me?.memberNo, accent: '#34d399', chips: [item.title], chipsLabel: 'Mastered' });
      const how = await shareCard(blob, { text: `I just mastered ${item.title} on StudyGraph. Join me: ${inviteLink()}`, filename: 'studygraph-level-up.png' });
      if (how === 'saved') toast('Card saved to your device.');
    } catch { toast("Couldn't make the card."); }
    close();
  } }, svgEl(svg_share), 'Share');
  const card = el('div', { class: 'burst-card' }, ...confetti, svgEl(mascot('cheer', 110)), el('b', {}, 'Unit mastered!'), el('span', {}, item.title), sbadge('🏅 level up', { hot: true, r: 2 }),
    el('div', { class: 'burst-actions' }, shareBtn, el('button', { type: 'button', class: 'btn ghost small', onclick: close }, 'Nice')));
  host.replaceChildren(card);
  host.hidden = false;
  if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
  timer = setTimeout(close, 6000);
}
window.addEventListener('studygraph:levelup', (e) => levelUp(e.detail));

/** The weekly recap postcard (this week, or last week's when this one is empty). */
function recapCard(stats) {
  const r = stats?.week || stats?.lastWeek;
  if (!r) return null;
  const past = !stats?.week;
  const acc = r.quizN ? `${Math.round((r.quizRight / r.quizN) * 100)}%` : null;
  const fmt = cfg.formats?.find((f) => f.id === r.topFormat)?.name;
  const line = r.mastered.length ? `${r.mastered.length} unit${r.mastered.length > 1 ? 's' : ''} mastered: ${r.mastered.slice(0, 2).join(', ')}.`
    : r.days >= 4 ? `${r.days} study days. That is a habit now.` : r.watched >= 5 ? `${r.unitCount} unit${r.unitCount > 1 ? 's' : ''} explored. Keep going.` : 'A start is a start. Swipe a few more.';
  const text = `My StudyGraph week: ${r.watched} lessons, ${r.minutes} min${acc ? `, ${acc} on quick checks` : ''}${r.mastered.length ? `, ${r.mastered.length} unit${r.mastered.length > 1 ? 's' : ''} mastered` : ''}. Join me: ${inviteLink()}`;
  const share = el('button', { type: 'button', class: 'btn ghost', onclick: async () => {
    track('recap_share', { week: r.week });
    share.disabled = true;
    try {
      const blob = await renderCard({ kind: 'recap', kicker: past ? 'Last week with Noti' : 'My week with Noti', title: `${r.watched} lesson${r.watched === 1 ? '' : 's'} this week`, mark: `${r.watched} lesson${r.watched === 1 ? '' : 's'}`,
        subtitle: me?.vidmoat?.name ? `${me.vidmoat.name.split(' ')[0]} is learning on StudyGraph` : 'Learning on StudyGraph',
        stats: [{ value: r.minutes, label: 'minutes' }, { value: acc || '—', label: 'quizzes' }, { value: r.days, label: 'days', hl: r.days >= 4 }, { value: r.mastered.length, label: 'mastered', hl: r.mastered.length > 0 }],
        line, mascot: mascot(r.mastered.length || r.days >= 4 ? 'cheer' : 'happy', 300), memberNo: me?.memberNo, chips: r.units, chipsLabel: 'Units this week' });
      const how = await shareCard(blob, { text, filename: `studygraph-week-${r.week}.png` });
      if (how === 'saved') toast('Card saved to your device and the text copied.');
    } catch { toast("Couldn't make the card."); }
    share.disabled = false;
  } }, svgEl(svg_share), 'Share recap');
  return el('div', { class: `recap${past ? ' past' : ''}` },
    el('h3', {}, past ? 'Last week with Noti' : 'Your week with Noti'),
    svgEl(mascot(r.mastered.length || r.days >= 4 ? 'cheer' : 'happy', 64)),
    el('div', { class: 'recap-stats' },
      el('span', {}, el('b', {}, String(r.watched)), 'lessons'), el('span', {}, el('b', {}, String(r.minutes)), 'min'),
      acc ? el('span', {}, el('b', {}, acc), 'quizzes') : null, el('span', {}, el('b', {}, String(r.days)), r.days === 1 ? 'day' : 'days'),
      fmt ? el('span', {}, el('b', {}, '★'), fmt) : null),
    el('p', {}, line), share);
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
const svg_share = '<svg viewBox="0 0 24 24" aria-hidden="true" class="btn-ic"><path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 14v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/></svg>';
const svgEl = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstElementChild; };
const sbadge = (text, { hot = false, r = -1 } = {}) => el('span', { class: `sbadge${hot ? ' hot' : ''}`, style: `--r:${r}deg` }, text);

/** A line from Noti for the student's current state. */
function buddyLine(stats) {
  if (!stats) return "Let's learn something today.";
  const hour = new Date().getHours();
  if (stats.streak >= 2 && !stats.today && hour >= 17) return `Your ${stats.streak}-day streak ends tonight. One lesson keeps it.`;
  if (stats.due >= 2 && !stats.today) return `${stats.due} units are due for review. Five minutes brings them back.`;
  if (stats.misses >= 3) return `${stats.misses} quick checks to fix. Each one you get right stays with you.`;
  const ex = examDays(me?.profile);
  if (ex != null && ex >= 0 && ex <= 14) return ex === 0 ? 'Exam day. Breathe. You know more than you think.' : `${ex} day${ex === 1 ? '' : 's'} to ${me.profile.exam || 'your exam'}. Revision first, new things after.`;
  if (stats.today && stats.today < stats.goal) return `${stats.today} of ${stats.goal} today. ${stats.goal - stats.today} more and the day is done.`;
  if (stats.today >= stats.goal && stats.streak < 3) return "Today's goal done. Anything more is a bonus.";
  if (stats.streak >= 7) return `${stats.streak} days in a row. You're unstoppable.`;
  if (stats.streak >= 3) return `${stats.streak}-day streak. Keep it going!`;
  if (stats.quizN >= 5 && stats.quizRight / stats.quizN >= 0.8) return `${Math.round((stats.quizRight / stats.quizN) * 100)}% on quick checks. Show-off.`;
  if (stats.mastered >= 1) return `${stats.mastered} unit${stats.mastered > 1 ? 's' : ''} mastered. On to the next.`;
  if (stats.watched >= 5) return `${stats.watched} lessons in. It's sticking.`;
  if (stats.watched >= 1) return 'First lessons done. Swipe for more.';
  return "Your feed is ready. Let's go.";
}
/** Days until the exam date on the profile (null without one; negative once it has passed). */
function examDays(p) {
  const t = Date.parse(p?.examDate || '');
  if (Number.isNaN(t)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today) / 86400e3);
}
/** A countdown pill: "WASSCE in 23 days" (nothing without a date, or once it is a week past). */
function examChip(p) {
  const d = examDays(p);
  if (d == null || d < -7) return null;
  const name = p.exam || 'Exam';
  const text = d < 0 ? `${name} done. Well played.` : d === 0 ? `${name} is today` : d === 1 ? `${name} tomorrow` : `${name} in ${d} days`;
  return el('span', { class: `exam-chip${d >= 0 && d <= 14 ? ' soon' : ''}`, title: p.examDate }, '📅 ', text);
}
/** The daily goal as a small ring: lessons watched today out of the goal. */
function goalRing(stats) {
  const goal = stats?.goal || 3, n = Math.min(goal, stats?.today || 0), r = 22, c = 2 * Math.PI * r;
  const ring = svgEl(`<svg class="goal-ring" viewBox="0 0 56 56" width="56" height="56" aria-hidden="true"><circle cx="28" cy="28" r="${r}" fill="none" stroke="rgba(0,0,0,.12)" stroke-width="6"/><circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--hl)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - n / goal)}" transform="rotate(-90 28 28)"/><text x="28" y="33" text-anchor="middle" font-family="var(--mono)" font-size="14" font-weight="700" fill="var(--ink)">${n}/${goal}</text></svg>`);
  return el('div', { class: `goal${n >= goal ? ' done' : ''}`, title: `Today: ${n} of ${goal} lessons` }, ring, el('span', {}, n >= goal ? 'Done today' : 'Today'));
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
let libData = null;
async function showLibrary() {
  const lib = await api('GET', '/api/library');
  libData = lib;
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
  setBadge(due + (lib.misses?.length || 0)); // the number on the app icon
  course.append(el('div', { class: 'hero search-hide' }, svgEl(mascot(due ? 'think' : stats?.streak >= 3 ? 'cheer' : 'happy')), goalRing(stats),
    el('div', {}, el('h3', {}, due ? `${due} unit${due > 1 ? 's' : ''} due for review` : 'Your syllabus'),
      el('p', {}, due ? 'Spaced repetition says now is the moment. They are first in your feed.' : 'Untick what you have mastered; your feed follows what stays ticked.'),
      examChip(me?.profile),
      el('div', { class: 'bubble' }, buddyLine(stats)))));
  course.append(Object.assign(statTiles(stats), { className: 'tiles search-hide' }));
  course.append(examCard());
  if (lib.misses?.length) {
    const due = lib.misses.length;
    course.append(el('div', { class: 'lib-strip fix-strip search-hide' }, svgEl(mascot('think', 64)),
      el('div', {}, el('h3', {}, `${due} question${due > 1 ? 's' : ''} to fix`), el('p', {}, 'Quick checks you got wrong. Get each one right twice and it is yours for good.')),
      el('button', { type: 'button', class: 'btn small primary', onclick: () => fixMisses(lib.misses) }, 'Fix them now')));
  }
  const GAMES = [['match', '🧩', 'Match it'], ['order', '🔢', 'Put it in order'], ['sort', '🗂️', 'Sort it'], ['truefalse', '⚡', 'True or false'], ['fillgap', '✍️', 'Fill the gap']];
  const ready = new Set(lib.games || []);
  course.append(el('div', { class: 'card games-card search-hide' }, el('h3', {}, 'Practice games'),
    el('p', { class: 'muted' }, ready.size ? 'Quick games made from lessons you have watched. What you miss comes back for review.' : 'Watch a few lessons and games made from them unlock here.'),
    el('div', { class: 'games-grid' }, ...GAMES.map(([type, emoji, label]) => el('button', { type: 'button', class: 'game-btn', disabled: !ready.has(type), onclick: () => playGame(type) },
      el('span', { class: 'game-emoji' }, emoji), el('b', {}, label),
      el('small', {}, ready.has(type) ? (Number(store.get(`st_best_${type}`)) ? `Best ${store.get(`st_best_${type}`)}%` : 'Play') : 'Locked'))))));
  const recap = recapCard(stats);
  if (recap && stats?.week) course.append(Object.assign(recap, { className: `${recap.className} search-hide` }));
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
      const row = el('div', { class: `unit-row${u.active ? '' : ' off'}`, 'data-search': u.title.toLowerCase() },
        el('label', { class: 'unit-name' }, box, el('button', { type: 'button', class: 'unit-title', title: 'What is in this unit', onclick: (e) => { e.preventDefault(); openUnitPlan(u); } }, u.title), u.custom ? el('span', { class: 'tag' }, 'yours') : null, u.dueForReview && u.active ? el('span', { class: 'due' }, 'Review due') : null),
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
      const added = await addCustomTopic(title, { programKey: key === 'custom' ? null : key });
      if (!added) return;
      input.value = '';
      showLibrary();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    const corner = pct >= 70 ? sbadge('🏅 mastered', { hot: true, r: 6 }) : pct >= 30 ? sbadge('📈 on it', { r: 6 }) : null;
    const pk = program?.pack;
    course.append(el('div', { class: `course-card${pk ? ' pack-card' : ''}`, 'data-search': String(program?.name || '').toLowerCase() }, corner ? Object.assign(corner, { className: corner.className + ' corner-badge' }) : null,
      el('div', { class: 'course-head' }, ring, el('div', {}, el('h3', {}, program?.name || (key === 'custom' ? 'My topics' : 'Your course')), el('p', {}, program?.basis || (key === 'custom' ? 'Topics you added' : `${units.length} units`)))),
      el('div', { class: `unit-rows${rows.length > 7 ? ' scroll-box' : ''}` }, ...rows),
      pk ? el('div', { class: 'pack-foot' },
        pk.link ? el('a', { class: 'btn small', href: pk.link, target: '_blank', rel: 'noopener noreferrer', onclick: () => track('pack_link', { slug: pk.slug }) }, pk.cta || 'Find out more') : null,
        el('button', { type: 'button', class: 'btn ghost small', onclick: async () => { track('pack_remove', { slug: pk.slug }); await patchMe({ removePack: pk.slug }).catch(() => {}); showLibrary(); } }, 'Remove pack'))
        : el('div', { class: 'add-row' }, input, el('button', { type: 'button', class: 'btn small', onclick: add }, 'Add'))));
  }
  if (!byProgram.has('custom')) {
    const input = el('input', { type: 'text', maxlength: '60', placeholder: 'Add your own topic…', 'aria-label': 'Add a topic' });
    const add = async () => {
      const title = input.value.trim();
      if (title.length < 2) return;
      if (!(await addCustomTopic(title))) return;
      showLibrary();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    course.append(el('div', { class: 'card' }, el('h3', {}, 'My topics'), el('p', { class: 'muted' }, 'Anything you want to learn, in your own words.'),
      el('div', { class: 'add-row' }, input, el('button', { type: 'button', class: 'btn small', onclick: add }, 'Add'))));
  }
  // Community packs live on the Explore tab; the Library only shows the ones added (as courses).
  const packs = [];
  if (false) {
    const list = el('div', { class: `packs${packs.length > 4 ? ' scroll-box' : ''}` });
    for (const p of packs.slice(0, 12)) {
      const topic = cfg.topics.find((t) => t.id === p.topic);
      list.append(el('div', { class: 'pack-row', 'data-search': `${p.title} ${p.by} ${p.kind} ${p.about}`.toLowerCase() },
        el('div', { class: 'pack-body' }, el('b', {}, p.title), el('small', {}, `${topic?.emoji || '📘'} ${p.kind} · ${p.units.length} units · by ${p.by}`), el('p', {}, p.about.length > 140 ? `${p.about.slice(0, 137)}…` : p.about)),
        el('button', { type: 'button', class: 'btn small primary', onclick: async (e) => {
          e.target.disabled = true;
          track('pack_add', { slug: p.slug, by: 'library' });
          const { added } = await patchMe({ addPack: p.slug }).catch(() => ({}));
          if (added?.pack) { toast(`Added "${added.pack.title}". Lessons are on their way.`); showLibrary(); } else { e.target.disabled = false; toast("Couldn't add that pack."); }
        } }, 'Add')));
    }
    course.append(el('div', { class: 'card packs-card' }, el('h3', {}, 'Community packs'),
      el('p', { class: 'muted' }, packs.length ? 'Books, courses and projects people have shared. Add one and its units join your course.' : 'You have added every pack there is. Share one of your own on GitHub.'),
      list, el('p', { class: 'fine' }, 'Anyone can add a pack: a Markdown file in the repo. ', el('a', { href: 'https://github.com/fredabila/studytok-vidmoat/blob/main/content/README.md', target: '_blank', rel: 'noopener noreferrer' }, 'How to submit one'))));
  }
  if (lib.interests?.length) {
    course.append(el('div', { class: 'card' }, el('h3', {}, 'Also following'),
      el('div', { class: 'chips' }, ...lib.interests.map((t) => { const topic = cfg.topics.find((x) => x.id === t); return topic ? el('span', { class: 'chip-btn' }, `${topic.emoji} ${topic.label}`) : null; }))));
  }
  renderSaved(lib.saved);
  renderHistory(lib.history);
  const counts = { course: lib.units.filter((u) => u.active).length, saved: lib.saved.length, history: lib.history.length };
  for (const b of $$('.segmented [data-seg]')) { const n = $('.seg-n', b); if (n) { n.textContent = String(counts[b.dataset.seg] || ''); n.hidden = !counts[b.dataset.seg]; } }
  applyLibrarySearch();
  markOverflow();
}

// ============================================================================ explore (community packs)
// ---- Explore (server/feed/discover.js) --------------------------------------------------------------
// Like the explore page of a social app: a search box with typeahead (courses, lessons, topics,
// packs, popular searches, your recent ones), topic chips, courses picked for you, community
// packs, and a grid of lessons outside your feed chosen by the algorithm. Tapping a tile plays
// the grid from there as a feed. Search results have Top / Courses / Lessons / Packs tabs.
const xp = { data: null, topic: '', at: 0, shown: 30, q: '', results: null, tab: 'top', packs: null, seq: 0 };
const RECENT_KEY = 'st_recent_searches';
const recentSearches = () => { try { return JSON.parse(store.get(RECENT_KEY) || '[]').slice(0, 8); } catch { return []; } };
const rememberSearch = (q) => store.set(RECENT_KEY, JSON.stringify([q, ...recentSearches().filter((x) => x !== q)].slice(0, 8)));
const forgetSearch = (q) => store.set(RECENT_KEY, JSON.stringify(recentSearches().filter((x) => x !== q)));
const regionName = (loc) => String(loc || '').split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');

async function renderExplore({ fresh = false } = {}) {
  const list = $('#explore-list');
  $('section[data-view="explore"] .lib-clear').hidden = !$('#explore-search').value;
  if (xp.q) return renderSearchResults();
  const seq = ++xp.seq;
  if (fresh || !xp.data || xp.data.topic !== (xp.topic || null) || Date.now() - xp.at > 120000) {
    if (!xp.data) list.replaceChildren(el('div', { class: 'explore-empty' }, el('span', { class: 'spinner' })));
    try {
      xp.data = await api('GET', `/api/explore${xp.topic ? `?topic=${encodeURIComponent(xp.topic)}` : ''}`);
      xp.at = Date.now();
      xp.shown = 30;
    } catch { list.replaceChildren(el('div', { class: 'explore-empty' }, "Couldn't load Explore. Pull to refresh.")); return; }
  }
  if (seq !== xp.seq) return; // a newer render (chip, search) has taken over
  const d = xp.data;
  renderTopicChips(d.topics);
  const parts = [];
  if (d.courses?.length) parts.push(el('section', { class: 'x-sec' }, el('h2', { class: 'x-h' }, 'Courses for you'),
    el('div', { class: 'x-row' }, ...d.courses.map((c) => courseChip(c)))));
  if (d.packs?.length) parts.push(el('section', { class: 'x-sec' }, el('h2', { class: 'x-h' }, 'Community packs'),
    el('div', { class: 'x-row' }, ...d.packs.map((p) => packChip(p)))));
  parts.push(el('section', { class: 'x-sec' }, el('h2', { class: 'x-h' }, xp.topic ? `${cfg.topics.find((t) => t.id === xp.topic)?.label || d.topics.find((t) => t.id === xp.topic)?.label || 'Lessons'}` : 'For you'),
    d.videos.length ? lessonGrid(d.videos.slice(0, xp.shown), { source: 'explore', all: d.videos })
      : el('div', { class: 'explore-empty' }, svgEl(mascot('think', 90)), el('b', {}, 'Nothing new here yet'), el('span', {}, "You've seen everything in this corner. Try another topic.")),
    d.videos.length > xp.shown ? el('button', { type: 'button', class: 'btn ghost x-more', onclick: () => { xp.shown += 30; renderExplore(); } }, 'Show more') : null));
  list.replaceChildren(...parts);
}

function renderTopicChips(topics) {
  const chip = (id, label) => el('button', { type: 'button', class: 'x-chip', 'aria-pressed': String((xp.topic || '') === id), onclick: () => {
    xp.topic = xp.topic === id ? '' : id;
    if (xp.topic) track('explore_topic', { topic: xp.topic });
    renderExplore();
  } }, label);
  $('#explore-filters').replaceChildren(chip('', 'For you'), ...topics.map((t) => chip(t.id, `${t.emoji} ${t.label}`)));
}

/** A grid of lesson tiles; every 9th one is large. Tapping plays the grid from that tile. */
function lessonGrid(tiles, { source, all = tiles } = {}) {
  const fits = (t) => !t.loc || t.loc === localRegion();
  return el('div', { class: 'x-grid' }, ...tiles.map((t, i) => el('button', { type: 'button', class: `x-tile${i % 9 === 4 ? ' big' : ''}`, 'aria-label': t.title, onclick: () => {
    track('explore_tile_open', { id: t.id, pos: i, topic: t.topic || '', why: t.why || '' });
    queueLessons(all.slice(all.indexOf(t)).filter((x) => x === t || fits(x)).slice(0, 12), source);
  } },
    t.poster ? el('img', { src: t.poster, alt: '', loading: 'lazy', decoding: 'async' }) : el('span', { class: 'x-tile-blank', style: `--accent:${cfg.topics.find((x) => x.id === t.topic)?.accent || '#ffd93d'}` }, cfg.topics.find((x) => x.id === t.topic)?.emoji || '📚'),
    t.why ? el('span', { class: 'x-why' }, t.why) : null,
    el('span', { class: 'x-tile-meta' }, el('span', { class: 'x-tile-title' }, t.title || 'Lesson'),
      el('span', { class: 'x-tile-sub' }, [t.handle ? `@${t.handle}` : t.unit, t.duration ? minsOf(t.duration) : null].filter(Boolean).join(' · '))))));
}
const localRegion = () => me?.region || ''; // the server's key for the student's country (lessons/index.js regionOf)

/** A course in a horizontal row: avatar, name, handle, followers, Follow. */
function courseChip(c) {
  const btn = el('button', { type: 'button', class: `btn small ${c.following ? 'ghost' : 'primary'}` }, c.following ? 'Following' : 'Follow');
  btn.onclick = async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    try { await setFollow(c.handle, !c.following, { source: 'explore' }); c.following = !c.following; btn.textContent = c.following ? 'Following' : 'Follow'; btn.className = `btn small ${c.following ? 'ghost' : 'primary'}`; } catch { toast("Couldn't change that."); }
    btn.disabled = false;
  };
  return el('article', { class: 'x-course', style: `--accent:${c.topic?.accent || '#ffe580'}`, tabindex: '0', onclick: () => { track('explore_course_open', { handle: c.handle, where: 'row' }); openChannel(c.handle, { source: 'explore' }); } },
    el('div', { class: 'x-course-av', 'aria-hidden': 'true' }, face(c)),
    el('strong', {}, c.name), el('small', {}, `@${c.handle}`),
    el('small', { class: 'x-course-n' }, `${fmtCount(c.lessons)} lessons · ${fmtCount(c.followers)} follower${c.followers === 1 ? '' : 's'}`),
    c.why ? el('small', { class: 'x-course-why' }, c.why) : null, btn);
}

function packChip(p) {
  const topic = cfg.topics.find((t) => t.id === p.topic);
  return el('button', { type: 'button', class: `x-pack${p.added ? ' added' : ''}`, style: `--accent:${topic?.accent || '#ffe580'}`, onclick: () => openPack(p.slug) },
    el('span', { class: 'x-pack-emoji', 'aria-hidden': 'true' }, topic?.emoji || '📘'),
    el('strong', {}, p.title), el('small', {}, `${p.kind} · ${p.units} units${p.added ? ' · added' : ''}`));
}

/** A community pack in a sheet: what it covers, add or remove, its link. */
async function openPack(slug) {
  try { xp.packs ||= (await api('GET', '/api/packs')).packs; } catch { return toast("Couldn't load that pack."); }
  const p = xp.packs.find((x) => x.slug === slug);
  if (!p) return;
  const topic = cfg.topics.find((t) => t.id === p.topic);
  const isAdded = (me?.packs || []).includes(p.slug);
  const btn = el('button', { type: 'button', class: `btn ${isAdded ? 'ghost' : 'primary'}` }, isAdded ? 'Remove from my course' : 'Add to my course');
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (isAdded) { track('pack_remove', { slug: p.slug }); await patchMe({ removePack: p.slug }); toast(`Removed "${p.title}".`); }
      else { track('pack_add', { slug: p.slug, by: 'explore' }); const { added: a } = await patchMe({ addPack: p.slug }); if (!a?.pack) throw new Error('no'); toast(`Added "${p.title}". Lessons are on their way.`); }
      me = (await api('GET', '/api/me')).user;
      await closeSheet();
      renderExplore({ fresh: true });
    } catch { btn.disabled = false; toast("Couldn't change that pack."); }
  };
  openSheet(p.title, el('div', { class: 'xpack-sheet', style: `--accent:${topic?.accent || '#ffe580'}` },
    el('small', { class: 'muted' }, `${p.kind} · ${topic?.label || 'General'} · by ${p.by}`),
    el('p', {}, p.about),
    el('h4', {}, 'What you will learn'), el('ol', {}, ...p.units.map((u) => el('li', {}, u.title))),
    el('div', { class: 'xpack-foot' }, btn,
      el('button', { type: 'button', class: 'btn ghost', onclick: () => openChannel(p.slug, { source: 'pack' }) }, `@${p.slug}`),
      p.link ? el('a', { class: 'btn ghost', href: p.link, target: '_blank', rel: 'noopener noreferrer', onclick: () => track('pack_link', { slug: p.slug }) }, p.cta || 'Find out more') : null)));
}

// ---- search: typeahead and results ----
let suggestSeq = 0;
let suggestTimer = null;
/** Typeahead after a short pause in typing. */
function queueSuggestions() { clearTimeout(suggestTimer); suggestTimer = setTimeout(showSuggestions, 150); }
async function showSuggestions() {
  const box = $('#x-suggest');
  const q = $('#explore-search').value.trim();
  const mine = ++suggestSeq;
  if (!q) {
    const recent = recentSearches();
    const trending = xp.data?.trending || [];
    if (!recent.length && !trending.length) { box.hidden = true; return; }
    box.replaceChildren(
      ...(recent.length ? [el('p', { class: 'x-sg-h' }, 'Recent'), ...recent.map((r) => el('div', { class: 'x-sg-row', role: 'option' },
        el('button', { type: 'button', class: 'x-sg-main', onclick: () => submitSearch(r, 'recent') }, el('span', { class: 'x-sg-ic' }, '🕘'), el('span', {}, r)),
        el('button', { type: 'button', class: 'x-sg-x', 'aria-label': `Forget ${r}`, onclick: (e) => { e.stopPropagation(); forgetSearch(r); showSuggestions(); } }, '×')))] : []),
      ...(trending.length ? [el('p', { class: 'x-sg-h' }, 'Popular searches'), el('div', { class: 'x-sg-chips' }, ...trending.map((t) => el('button', { type: 'button', class: 'x-chip', onclick: () => submitSearch(t, 'trending') }, `🔥 ${t}`)))] : []));
    box.hidden = false;
    return;
  }
  let res;
  try { res = await api('GET', `/api/search/suggest?q=${encodeURIComponent(q)}`); } catch { return; }
  if (mine !== suggestSeq) return;
  const rows = res.suggestions.map((s) => {
    const [icon, label, sub, act] = s.type === 'course' ? [s.emoji, s.name, `@${s.handle} · ${fmtCount(s.followers)} followers`, () => { openChannel(s.handle, { source: 'search' }); }]
      : s.type === 'lesson' ? ['▶', s.title, s.unit || 'Lesson', () => queueLessons([{ id: s.id }], 'search')]
      : s.type === 'topic' ? [s.emoji, s.label, 'Topic', () => { $('#explore-search').value = ''; xp.q = ''; xp.topic = s.id; hideSuggestions(); renderExplore(); }]
      : s.type === 'pack' ? ['📘', s.title, 'Community pack', () => openPack(s.slug)]
      : ['🔍', s.text, 'Popular search', () => submitSearch(s.text, 'suggest')];
    const iconEl = s.type === 'course' && s.avatar ? el('img', { src: s.avatar, alt: '', class: 'face-img' }) : icon;
    return el('button', { type: 'button', class: 'x-sg-row x-sg-main', role: 'option', onclick: () => { track('search_pick', { type: s.type, value: (s.handle || s.id || s.slug || s.text || '').slice(0, 60) }); if (s.type !== 'query') rememberSearch(q); hideSuggestions(); act(); } },
      el('span', { class: 'x-sg-ic' }, iconEl), el('span', { class: 'x-sg-text' }, el('span', {}, label), el('small', {}, sub)));
  });
  box.replaceChildren(...rows, el('button', { type: 'button', class: 'x-sg-row x-sg-main x-sg-all', onclick: () => submitSearch(q, 'enter') }, el('span', { class: 'x-sg-ic' }, '🔍'), el('span', {}, `Search for "${q.slice(0, 40)}"`)));
  box.hidden = false;
}
const hideSuggestions = () => { clearTimeout(suggestTimer); suggestSeq++; $('#x-suggest').hidden = true; };

async function submitSearch(q, where = 'enter') {
  q = String(q || '').trim();
  if (q.length < 2) return;
  $('#explore-search').value = q;
  $('#explore-search').blur();
  hideSuggestions();
  rememberSearch(q);
  xp.q = q; xp.tab = 'top'; xp.results = null;
  $('section[data-view="explore"] .lib-clear').hidden = false;
  $('#explore-list').replaceChildren(el('div', { class: 'explore-empty' }, el('span', { class: 'spinner' })));
  try { xp.results = await api('GET', `/api/search?q=${encodeURIComponent(q)}`); } catch { xp.results = { courses: [], lessons: [], packs: [] }; }
  if (xp.q !== q) return;
  const r = xp.results;
  track('search_submit', { q: q.slice(0, 60), results: r.courses.length + r.lessons.length + r.packs.length, where });
  renderSearchResults();
}

function renderSearchResults() {
  const r = xp.results;
  if (!r) return;
  const tabs = [['top', 'Top'], ['courses', `Courses · ${r.courses.length}`], ['lessons', `Lessons · ${r.lessons.length}`], ['packs', `Packs · ${r.packs.length}`]];
  $('#explore-filters').replaceChildren(...tabs.map(([k, label]) => el('button', { type: 'button', class: 'x-chip', 'aria-pressed': String(xp.tab === k), onclick: () => { xp.tab = k; renderSearchResults(); } }, label)));
  const courses = (n) => r.courses.length ? el('div', { class: 'xch-list' }, ...r.courses.slice(0, n).map((c) => channelCard(c))) : null;
  const lessons = (n) => r.lessons.length ? lessonGrid(r.lessons.slice(0, n), { source: 'search' }) : null;
  const packs = () => r.packs.length ? el('div', { class: 'x-row wrap' }, ...r.packs.map((p) => packChip({ slug: p.slug, title: p.title, topic: p.topic, kind: p.kind, units: p.units.length, added: (me?.packs || []).includes(p.slug) }))) : null;
  const none = !r.courses.length && !r.lessons.length && !r.packs.length;
  const body = none ? [el('div', { class: 'explore-empty' }, svgEl(mascot('think', 90)), el('b', {}, `Nothing for "${xp.q}" yet`),
    el('span', {}, 'Add it as your own topic and StudyGraph will make lessons for it.'),
    el('button', { type: 'button', class: 'btn primary small', onclick: async () => { if (await addCustomTopic(xp.q)) { clearSearch(); } } }, `Study "${xp.q.slice(0, 30)}"`))]
    : xp.tab === 'courses' ? [courses(50)] : xp.tab === 'lessons' ? [lessons(60)] : xp.tab === 'packs' ? [packs()]
      : [r.courses.length ? el('h2', { class: 'x-h' }, 'Courses') : null, courses(3), r.lessons.length ? el('h2', { class: 'x-h' }, 'Lessons') : null, lessons(12), r.packs.length ? el('h2', { class: 'x-h' }, 'Packs') : null, packs()];
  $('#explore-list').replaceChildren(...body.filter(Boolean));
}

function clearSearch() {
  $('#explore-search').value = '';
  xp.q = ''; xp.results = null;
  hideSuggestions();
  renderExplore();
}

// ---- Library search -------------------------------------------------------------------------------
// One box filters whatever is on screen: units and packs on Course, tiles on Saved, rows on History.
// Everything searchable carries data-search; decorative blocks carry .search-hide and step aside.
function applyLibrarySearch() {
  const input = $('#lib-search');
  if (!input) return;
  const q = input.value.trim().toLowerCase();
  $('section[data-view="library"] .lib-clear').hidden = !q;
  const counts = {};
  for (const panel of $$('.seg-panel')) {
    let n = 0;
    $$('[data-search]', panel).forEach((x) => { const hit = !q || x.dataset.search.includes(q); x.classList.toggle('off', !hit); if (hit && q) n++; });
    $$('.course-card', panel).forEach((c) => {
      const rows = $$('.unit-row', c);
      const own = Boolean(q) && c.dataset.search?.includes(q);
      if (own) rows.forEach((r) => r.classList.remove('off'));
      c.classList.toggle('off', Boolean(q) && !own && rows.length > 0 && rows.every((r) => r.classList.contains('off')));
      if (q && !own && rows.length) n -= 0; // rows already counted
    });
    $$('.lib-day', panel).forEach((h) => { const any = h.nextElementSibling && $$('.hrow', h.nextElementSibling).some((r) => !r.classList.contains('off')); h.classList.toggle('off', Boolean(q) && !any); });
    $$('.packs-card', panel).forEach((c) => c.classList.toggle('off', Boolean(q) && !$$('.pack-row', c).some((r) => !r.classList.contains('off'))));
    $$('.search-hide', panel).forEach((x) => x.classList.toggle('off', Boolean(q)));
    counts[panel.dataset.panel] = $$('[data-search]', panel).filter((x) => !x.classList.contains('off') && !x.classList.contains('course-card')).length;
  }
  const out = $('#lib-results');
  out.hidden = !q;
  if (!q) return;
  const total = (counts.course || 0) + (counts.saved || 0) + (counts.history || 0);
  const parts = [['course', 'Course'], ['saved', 'Saved'], ['history', 'History']].map(([k, label]) => el('button', { type: 'button', class: 'lib-res', 'aria-pressed': String($(`.segmented [data-seg="${k}"]`).getAttribute('aria-selected') === 'true'), onclick: () => $(`.segmented [data-seg="${k}"]`).click() }, `${counts[k] || 0} in ${label}`));
  out.replaceChildren(...parts);
  if (!total) out.append(el('button', { type: 'button', class: 'btn small primary lib-add', onclick: async () => {
    const title = input.value.trim();
    if (!(await addCustomTopic(title))) return;
    input.value = ''; showLibrary();
  } }, `Add "${input.value.trim().slice(0, 30)}" as a topic`));
}
/** Marks bounded lists that actually overflow, so they can show their scroll hint. */
function markOverflow() {
  $$('.scroll-box').forEach((b) => b.classList.toggle('overflows', b.scrollHeight > b.clientHeight + 4));
}

// ---- Saved and History ---------------------------------------------------------------------------
const topicOf = (id) => cfg.topics.find((t) => t.id === id);
const fmtTag = (id) => cfg.formats?.find((f) => f.id === id)?.tag || '';
const minsOf = (sec) => (sec >= 90 ? `${Math.round(sec / 60)} min` : `${Math.round(sec || 0)} s`);
function agoText(t) {
  if (!t) return '';
  const d = Date.now() - t;
  if (d < 60e3) return 'just now';
  if (d < 3600e3) return `${Math.round(d / 60e3)} min ago`;
  if (d < 86400e3) return `${Math.round(d / 3600e3)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function dayLabel(t) {
  if (!t) return 'Earlier';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - new Date(t).setHours(0, 0, 0, 0)) / 86400e3);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return new Date(t).toLocaleDateString(undefined, { weekday: 'long' });
  return 'Earlier';
}
/** A poster tile for a lesson in the Library (Saved). */
function lessonTile(v, { onRemove } = {}) {
  const topic = topicOf(v.topic);
  const open = el('button', { type: 'button', class: 'ltile', style: `--accent:${topic?.accent || '#ffd93d'}`, onclick: () => openVideo(v.id) },
    v.poster ? el('img', { src: v.poster, alt: '', loading: 'lazy' }) : el('div', { class: 'ph' }, topic?.emoji || '📚'),
    el('span', { class: 'lt-top' }, el('span', { class: 'lt-topic' }, `${topic?.emoji || ''} ${topic?.label || 'Lesson'}`.trim()), v.duration ? el('span', { class: 'lt-dur' }, minsOf(v.duration)) : null),
    el('span', { class: 'lt-play', 'aria-hidden': 'true' }, svgEl('<svg viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>')),
    el('span', { class: 'lt-body' }, el('b', {}, v.title || 'Untitled'), el('small', {}, [v.unit, fmtTag(v.format)].filter(Boolean).join(' · '))));
  const wrap = el('div', { class: 'ltile-wrap', 'data-search': `${v.title || ''} ${v.unit || ''} ${topic?.label || ''}`.toLowerCase() }, open);
  if (onRemove) wrap.append(el('button', { type: 'button', class: 'lt-x', 'aria-label': 'Remove from Saved', title: 'Remove from Saved', onclick: onRemove }, '×'));
  return wrap;
}
function renderSaved(list) {
  const box = $('#lib-saved');
  box.classList.remove('grid');
  if (!list.length) { box.replaceChildren(el('div', { class: 'empty' }, svgEl(mascot('think', 110)), el('b', {}, 'Nothing saved yet'), 'Tap the bookmark on any lesson to keep it here for revision.')); return; }
  const total = list.reduce((s, v) => s + (v.duration || 0), 0);
  const strip = el('div', { class: 'lib-strip search-hide' }, svgEl(mascot('cheer', 64)),
    el('div', {}, el('h3', {}, `${list.length} saved lesson${list.length > 1 ? 's' : ''}`), el('p', {}, `${minsOf(total)} of revision, ready when you are.`)),
    el('button', { type: 'button', class: 'btn small primary', onclick: () => queueLessons(list, 'saved') }, 'Revise all'));
  const tiles = list.map((v) => lessonTile(v, { onRemove: () => {
    sendEvent(v.id, 'unsave');
    const slide = feed.items.find((it) => it.data.id === v.id); if (slide) { slide.data.saved = false; renderSlide(slide); }
    toast('Removed from Saved');
    renderSaved(list.filter((x) => x.id !== v.id));
  } }));
  box.replaceChildren(strip, el('div', { class: `grid tiles-grid${tiles.length > 6 ? ' scroll-box tall' : ''}` }, ...tiles));
  applyLibrarySearch();
}
function renderHistory(list) {
  const box = $('#lib-history');
  box.classList.remove('grid');
  if (!list.length) { box.replaceChildren(el('div', { class: 'empty' }, svgEl(mascot('sleepy', 110)), el('b', {}, 'No history yet'), 'Lessons you watch show up here.')); return; }
  const stats = me?.stats;
  const strip = el('div', { class: 'lib-strip search-hide' }, svgEl(mascot('happy', 64)),
    el('div', {}, el('h3', {}, `${stats?.watched || list.length} lesson${(stats?.watched || list.length) === 1 ? '' : 's'} watched`), el('p', {}, stats?.streak >= 2 ? `${stats.streak}-day streak. Tap any lesson to watch it again.` : 'Tap any lesson to watch it again.')),
    el('button', { type: 'button', class: 'btn small', onclick: () => queueLessons(list.slice(0, 8), 'history') }, 'Replay recent'));
  const groups = new Map();
  for (const v of list.slice(0, 40)) { const k = dayLabel(v.at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); }
  const sections = [];
  for (const [label, items] of groups) {
    sections.push(el('h4', { class: 'lib-day' }, label, el('span', {}, `${items.length}`)));
    sections.push(el('div', { class: 'hlist' }, ...items.map((v) => {
      const topic = topicOf(v.topic);
      return el('button', { type: 'button', class: 'hrow', style: `--accent:${topic?.accent || '#ffd93d'}`, 'data-search': `${v.title || ''} ${v.unit || ''} ${topic?.label || ''}`.toLowerCase(), onclick: () => openVideo(v.id) },
        v.poster ? el('img', { src: v.poster, alt: '', loading: 'lazy' }) : el('span', { class: 'ph' }, topic?.emoji || '📚'),
        el('span', { class: 'h-body' }, el('b', {}, v.title || 'Untitled'), el('small', {}, [v.unit, fmtTag(v.format), v.duration ? minsOf(v.duration) : null].filter(Boolean).join(' · '))),
        el('span', { class: 'h-when' }, agoText(v.at) || '', svgEl('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/></svg>')));
    })));
  }
  box.replaceChildren(strip, el('div', { class: `hist-box${list.length > 6 ? ' scroll-box tall' : ''}` }, ...sections));
  applyLibrarySearch();
}
/** Queues several Library lessons right after the current slide and jumps to the first. */
async function queueLessons(list, source) {
  showView('feed');
  const fresh = list.filter((v) => !feed.items.some((it) => it.data.id === v.id)).slice(0, 12);
  const got = (await Promise.all(fresh.map((v) => api('GET', `/api/videos/${v.id}`).then((r) => r.item).catch(() => null)))).filter(Boolean);
  const at = feed.active < 0 ? 0 : feed.active + 1;
  got.forEach((item, i) => { addSlide(item, { at: at + i }).source = source; });
  layout(false);
  if (got.length) { goTo(at); toast(`${got.length} lesson${got.length > 1 ? 's' : ''} queued. Swipe through them.`); }
  else if (list.length) { const i = feed.items.findIndex((it) => it.data.id === list[0].id); if (i >= 0) goTo(i); }
}

// ============================================================================ profile
/** "How you learn best": the measured learning profile (server/feed/learning.js), with what to do about it. */
function renderLearning() {
  const card = $('#learning-card');
  const lp = me?.learning;
  if (!card || !lp) { if (card) card.hidden = true; return; }
  card.hidden = false;
  const said = new Set(lp.said || []);
  const meta = Object.fromEntries(LEARN_STYLES.map(([id, emoji, label]) => [id, { emoji, label }]));
  const max = Math.max(...lp.styles.map((s) => s.score), 0.01), min = Math.min(...lp.styles.map((s) => s.score));
  const bars = lp.styles.map((s) => el('div', { class: `lp-row${s.id === lp.top && lp.confidence ? ' top' : ''}` },
    el('span', { class: 'lp-name' }, `${meta[s.id].emoji} ${s.id === 'listening' ? 'Hearing it' : meta[s.id].label}`, said.has(s.id) ? el('small', {}, ' · you said') : null),
    el('span', { class: 'lp-bar' }, el('i', { style: `width:${Math.round(18 + 82 * ((s.score - min) / Math.max(0.0001, max - min)))}%` })),
    el('span', { class: 'lp-val' }, s.watch != null && s.views >= 3 ? `${Math.round(s.watch * 100)}%` : '–')));
  const top = lp.styles[0];
  const head = !lp.confidence ? 'Your learning profile starts with your first lessons.'
    : lp.measured ? `You learn best by ${meta[top.id].label.toLowerCase()}.` : `So far: ${meta[top.id].label.toLowerCase()}. Still learning about you.`;
  const actions = [];
  const p = me?.prefs || {};
  if (lp.measured && top.id === 'visual' && p.visuals !== 'diagrams') actions.push(['Diagram-first lessons', async () => { await patchMe({ prefs: { ...p, visuals: 'diagrams' } }); toast('New lessons will lead with diagrams.'); }]);
  if (lp.measured && top.id === 'listening' && p.voice === 'off') actions.push(['Turn narration on', async () => { await patchMe({ prefs: { ...p, voice: 'on' } }); toast('Narration is back on for new lessons.'); }]);
  if (lp.measured && top.id === 'handson') actions.push(['Play a game', () => playGame(null)]);
  if (lp.measured && top.id === 'reading') actions.push(['Lesson notes are under Why', () => toast('Tap Why on any lesson, then Lesson notes.')]);
  card.replaceChildren(el('h3', {}, 'How you learn best'),
    el('p', { class: 'lp-head' }, head),
    el('div', { class: 'lp-bars' }, ...bars),
    el('p', { class: 'fine lp-note' }, lp.insight || (lp.confidence ? 'Measured from what you finish, get right and replay. The percentages are how far through you watch.' : 'Measured from what you finish, get right and replay, starting with what you tell us.')),
    el('div', { class: 'lp-actions' }, ...actions.map(([label, fn]) => el('button', { type: 'button', class: 'btn small', onclick: async () => { track('style_action', { action: label }); try { await fn(); } catch { toast("Couldn't do that."); } } }, label)),
      el('button', { type: 'button', class: 'btn ghost small', onclick: openStylePicker }, said.size ? 'Change what I said' : 'Tell us how you like to learn')));
}
function openStylePicker() {
  const chosen = new Set(me?.learning?.said || []);
  const box = el('div', { class: 'chips' });
  renderStyles(box, chosen);
  openSheet('How do you like to learn?', el('div', {}, el('p', { class: 'muted' }, 'Pick any. Your feed starts there, then follows what you actually finish and get right: people often learn best in ways they would not have picked.'), box,
    el('button', { type: 'button', class: 'btn primary', style: 'width:100%;margin-top:14px', onclick: async () => {
      track('style_set', { styles: [...chosen].join(','), where: 'profile' });
      try { await patchMe({ styles: [...chosen] }); me = (await api('GET', '/api/me')).user; closeSheet(); renderLearning(); toast('Saved.'); } catch { toast("Couldn't save that."); }
    } }, 'Save')));
}
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
  if (me?.memberNo) badges.unshift(sbadge(`#${me.memberNo} member`, { hot: me.memberNo <= 100, r: -3 }));
  const shareMe = el('button', { type: 'button', class: 'btn ghost small', onclick: async () => {
    track('profile_share', {});
    try {
      const blob = await renderCard({ kind: 'profile', kicker: 'StudyGraph member', title: `Member #${me?.memberNo || '?'}`, mark: `#${me?.memberNo || '?'}`,
        subtitle: `${me?.vidmoat?.name || 'A student'} · ${[lvl?.label, p.program].filter(Boolean).join(' · ') || 'learning every day'}`,
        stats: [{ value: stats?.streak ?? 0, label: 'day streak', hl: (stats?.streak ?? 0) >= 3 }, { value: stats?.watched ?? 0, label: 'lessons' }, { value: stats?.quizN ? `${Math.round((stats.quizRight / stats.quizN) * 100)}%` : '—', label: 'quizzes' }, { value: stats?.mastered ?? 0, label: 'mastered' }],
        line: buddyLine(stats), mascot: mascot(stats?.streak >= 3 ? 'cheer' : 'happy', 300), memberNo: me?.memberNo, chips: [p.program, p.exam ? `Preparing for ${p.exam}` : null, ...(me?.interests || []).slice(0, 3).map((t) => cfg.topics.find((x) => x.id === t)?.label)].filter(Boolean), chipsLabel: 'Studying' });
      const how = await shareCard(blob, { text: inviteText(), filename: 'studygraph-member.png' });
      if (how === 'saved') toast('Card saved to your device.');
    } catch { toast("Couldn't make the card."); }
  } }, svgEl(svg_share), 'Share my card');
  $('#profile-card').replaceChildren(svgEl(mascot(stats?.streak >= 3 ? 'cheer' : 'happy')),
    el('div', {}, el('h3', {}, me?.vidmoat?.name || 'Guest learner'), el('p', {}, [me?.memberNo ? `Member #${me.memberNo}` : null, lvl?.label, p.institution, p.age ? `age ${p.age}` : null].filter(Boolean).join(' · ') || 'Exploring'),
      el('div', { class: 'p-counts' },
        el('button', { type: 'button', class: 'p-count', onclick: openFollowing }, el('strong', {}, fmtCount((me?.following || []).length)), 'following'),
        el('button', { type: 'button', class: 'p-count', onclick: () => { showView('library'); setTimeout(() => $('.segmented [data-seg="saved"]')?.click(), 300); } }, el('strong', {}, fmtCount(me?.liked || 0)), 'liked')),
      el('div', { class: 'bubble' }, buddyLine(stats)),
      badges.length ? el('div', { class: 'badges' }, ...badges) : null,
      el('div', { class: 'badges' }, shareMe)),
    goalRing(stats));
  $('#profile-tiles').replaceChildren(...[statTiles(stats), recapCard(stats)].filter(Boolean));

  renderCredits();
  renderInvite();
  renderLearning();
  renderSettingsList();
  renderPushCard().then(renderSettingsList).catch(() => {});
  const account = $('#account-card');
  if (me?.vidmoat) {
    account.replaceChildren(el('h3', {}, 'Vidmoat account'),
      el('p', { class: 'muted' }, `Signed in as ${me.vidmoat.email || me.vidmoat.name}. Your course, progress and library follow you to any device where you sign in.`),
      el('ul', { class: 'reassure' }, el('li', {}, 'StudyGraph never uses your Vidmoat credits'), el('li', {}, 'We only read your name and email')),
      el('button', { type: 'button', class: 'btn ghost', onclick: signOut }, 'Sign out on this device'));
  } else {
    account.replaceChildren(el('h3', {}, 'Keep your progress everywhere'),
      el('p', { class: 'muted' }, 'Sign in with your Vidmoat account to save your course, progress and library, and pick up on any device.'),
      el('ul', { class: 'reassure' },
        el('li', {}, 'We only read your name and email'),
        el('li', {}, 'StudyGraph never uses your Vidmoat credits'),
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
    install.replaceChildren(...[el('h3', {}, 'Install StudyGraph'),
      el('p', { class: 'muted' }, installPrompt ? 'Add StudyGraph to your home screen: it opens full screen, like an app.' : 'On iPhone or iPad: tap the Share button in Safari, then "Add to Home Screen".'),
      installPrompt ? el('button', { type: 'button', class: 'btn primary', onclick: doInstall }, 'Install app') : null].filter(Boolean));
  }

  $('#studies-summary').replaceChildren(el('p', {}, [p.program, p.institution, p.country].filter(Boolean).join(' · ') || 'No course set'),
    el('p', {}, [lvl?.label, p.exam && `Preparing for ${p.exam}`].filter(Boolean).join(' · ')), ...[examChip(p)].filter(Boolean));
}
/** Who pays for new videos: the free allowance on StudyGraph's account, or the student's own Vidmoat credits. */
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
    const problemText = { exhausted: "You're out of Vidmoat credits, so new lessons are paused. Top up and they resume on their own.", plan: 'Your Vidmoat plan does not include AI speech yet. Upgrade to keep making narrated lessons.', reconnect: 'StudyGraph lost access to your account. Connect it again to keep going.' }[b.problem];
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
        : 'Your first lessons are made on StudyGraph’s Vidmoat account. Connect yours any time to make lessons with your own credits.'),
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
  if (outcome === 'accepted') toast('Installed! Find StudyGraph on your home screen.');
  renderProfile();
}

// ============================================================================ views
function showView(next) {
  view = next;
  document.body.dataset.view = next;
  setStatusBar(next === 'feed' ? '#141414' : '#f6f1e7'); // the status bar follows the screen
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== next; });
  $$('.tabbtn').forEach((t, i) => { t.setAttribute('aria-current', t.dataset.tab === next ? 'page' : 'false'); if (t.dataset.tab === next) $('.tab-blob').style.setProperty('--tab', String(i)); });
  if (next === 'feed') {
    renderGoalPill();
    layout(false);
    syncPlayers();
    const item = feed.items[feed.active];
    history.replaceState(history.state, '', item ? `#v=${item.data.id}` : location.pathname);
  } else {
    feed.items[feed.active]?.player?.pause();
    history.replaceState(history.state, '', `#${next}`);
    // Fresh numbers for the stickers and tiles: send pending events, then re-read the profile.
    flush();
    const refresh = api('GET', '/api/me').then((r) => { me = { ...r.user, billing: r.user.billing || me?.billing }; renderGoalPill(); }).catch(() => {});
    if (next === 'library') { track('library_open', { tab: 'course' }); refresh.then(() => showLibrary()).catch(() => toast("Couldn't load your library.")); }
    if (next === 'profile') { track('profile_open'); renderProfile(); refresh.then(renderProfile); }
    if (next === 'explore') { track('explore_open'); refresh.then(() => renderExplore()).catch(() => renderExplore()); }
  }
}

/** Starts over: 'feed' forgets what the algorithm learned; 'everything' also clears the course and setup. */
async function resetMe(scope) {
  const ask = scope === 'everything'
    ? 'Reset everything? Your course, saved lessons, progress and settings are cleared and you set up again. Your account, member number, invites and free-lesson count stay.'
    : 'Reset your feed? Progress, streak, history and what the algorithm learned about you are cleared. Your course, saved lessons and member number stay.';
  if (!window.confirm(ask)) return;
  track('reset', { scope });
  flush(true);
  try { await api('POST', '/api/me/reset', { scope }); } catch { toast("Couldn't reset. Try again."); return; }
  me = (await api('GET', '/api/me')).user;
  feed.items.splice(0).forEach((it) => { it.player?.destroy(); it.el.remove(); });
  feed.active = -1;
  nthVideo = 0;
  if (scope === 'everything') {
    toast('Everything cleared. Set up your studies again.');
    await runOnboarding(me);
    me = (await api('GET', '/api/me')).user;
  } else toast('Fresh start. Your feed begins again.');
  showView('feed');
  await loadMore(3);
  goTo(0, { animate: false });
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
  $$('.tabbtn').forEach((t) => { t.onclick = () => { if (view !== t.dataset.tab) haptic('tap'); showView(t.dataset.tab); }; });
  const tabs = $$('.segmented [data-seg]');
  tabs.forEach((b, i) => {
    b.onclick = () => {
      track('library_open', { tab: b.dataset.seg });
      tabs.forEach((x) => { x.setAttribute('aria-selected', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
      $$('.seg-panel').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.seg; });
      applyLibrarySearch();
      markOverflow();
    };
    b.onkeydown = (e) => { // arrow keys move between tabs, as a tablist should
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[j].click(); tabs[j].focus();
    };
  });
  const search = $('#lib-search');
  let searchTimer = null;
  search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { applyLibrarySearch(); if (search.value.trim()) track('library_search', { q: search.value.trim().slice(0, 40) }); }, 120); };
  search.onkeydown = (e) => { if (e.key === 'Escape') { search.value = ''; applyLibrarySearch(); search.blur(); } };
  $('section[data-view="library"] .lib-clear').onclick = () => { search.value = ''; applyLibrarySearch(); search.focus(); };
  const xs = $('#explore-search');
  // Explore search: typeahead while typing, recent and popular searches on focus, results on Enter.
  xs.oninput = () => { $('section[data-view="explore"] .lib-clear').hidden = !xs.value; queueSuggestions(); };
  xs.onfocus = () => showSuggestions();
  xs.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitSearch(xs.value, 'enter'); }
    if (e.key === 'Escape') { if (xs.value) clearSearch(); else hideSuggestions(); xs.blur(); }
  };
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#x-suggest, #explore-search')) hideSuggestions(); });
  $('section[data-view="explore"] .lib-clear').onclick = () => { clearSearch(); xs.focus(); };
  document.addEventListener('keydown', (e) => { if (e.key === '/' && (view === 'library' || view === 'explore') && !e.target.closest('input, textarea')) { e.preventDefault(); (view === 'explore' ? xs : search).focus(); } });
  window.addEventListener('resize', markOverflow);
  $('#edit-studies').onclick = editStudies;
  $('#reset-feed').onclick = () => resetMe('feed');
  $('#reset-all').onclick = () => resetMe('everything');
  $$('.refresh-btn').forEach((b) => { b.onclick = () => refreshView(b.dataset.refresh); });
  wirePullToRefresh();
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
  onething: { topic: 'Physics', accent: '#8fc1ff', hook: 'One thing about <em>falling</em>', card: ['15 seconds', 'Terminal velocity'] },
  cheatsheet: { topic: 'Maths', accent: '#f472b6', hook: 'Quadratics on <em>one card</em>', card: ['Cheat sheet', 'x = (−b ± √(b² − 4ac)) / 2a'] },
  predict: { topic: 'Chemistry', accent: '#a78bfa', hook: 'What happens when the <em>sodium</em> hits water?', card: ['What happens next?', 'A · B · C'] },
  analogy: { topic: 'Computer science', accent: '#2dd4bf', hook: 'A hash map is like a <em>coat check</em>', card: ['Analogy | Real thing', 'Ticket | Key'] },
  mistakes: { topic: 'Economics', accent: '#f5b971', hook: '3 mistakes that cost <em>marks</em> in elasticity', stamp: '✗ 1', card: ["Don't do this", 'Mixing up % and absolute'] },
  history: { topic: 'History', accent: '#fbbf24', hook: 'From <em>apples</em> to black holes', card: ['1915', 'General relativity'] },
  challenge: { topic: 'Maths', accent: '#34d399', hook: 'Ten seconds. <em>Go.</em>', card: ['10 seconds', '17 × 6 = ?'] },
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
  const ref = captureRef();
  capturePack();
  const invited = $('#ld-invited');
  invited.hidden = !ref;
  if (ref) invited.replaceChildren('Invited by member ', el('b', {}, `#${ref}`));
  funnel('landing', ref ? { ref } : {});
  $$('.ld-go, .ld-signin').forEach((a) => a.addEventListener('click', () => funnel('signin_click'), { once: true }));
  $('#landing').hidden = false;
  $('#onboard').hidden = true;
  $('#app').hidden = true;
  document.body.classList.add('landing-on');
  if (notice) toast(notice);
}

// ============================================================================ invites
// ?ref=<member number> on any visit is remembered (cookie for the server's sign-in callback,
// localStorage for the profile save) and stripped from the URL.
/** `?pack=<slug>` on any link: remembered until the student is set up, then added to their course. */
function capturePack() {
  const slug = new URLSearchParams(location.search).get('pack');
  if (slug && /^[a-z0-9-]{3,40}$/.test(slug)) {
    store.set('st_pack', slug);
    const url = new URL(location.href); url.searchParams.delete('pack'); history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  return store.get('st_pack');
}
async function applyPendingPack() {
  const slug = store.get('st_pack');
  if (!slug || !me?.setupDone) return;
  try { localStorage.removeItem('st_pack'); } catch { /* fine */ }
  if (me.packs?.includes(slug)) return;
  try {
    const { added } = await patchMe({ addPack: slug });
    if (added?.pack) { toast(`Added "${added.pack.title}" to your course.`); track('pack_add', { slug, by: 'link' }); await restartFeed(); }
  } catch { /* an unknown pack: nothing to add */ }
}
function captureRef() {
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref && /^\d{1,7}$/.test(ref)) {
    try { localStorage.setItem('st_ref', ref); } catch { /* fine */ }
    document.cookie = `st_ref=${ref}; Max-Age=${60 * 60 * 24 * 30}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    const url = new URL(location.href); url.searchParams.delete('ref'); history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  try { return localStorage.getItem('st_ref'); } catch { return null; }
}
const inviteLink = () => `${location.origin}/?ref=${me?.memberNo}`;

/**
 * Shares a public link to a lesson (/v/:id plays it without an account). The viewer's member
 * number rides along as ?ref=, so anyone who joins from it counts as their invite.
 */
async function shareLesson(item) {
  if (item.data.status !== 'ready') { toast('This lesson is still being made. Try again in a moment.'); return; }
  const url = `${location.origin}/v/${item.data.id}${me?.memberNo ? `?ref=${me.memberNo}` : ''}`;
  const title = item.data.title || item.data.unit?.title || 'A StudyGraph lesson';
  const text = `${title}: a ${Math.round(item.data.duration || 30)}-second lesson on StudyGraph. Watch it free:`;
  if (item.player && !feed.paused) { item.player.pause(); feed.paused = true; }
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); sendEvent(item.data.id, 'lesson_share', { by: 'sheet' }); return; }
  } catch (err) { if (err?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Link copied. Anyone can watch it, no account needed.'); } catch { toast(url); }
  sendEvent(item.data.id, 'lesson_share', { by: 'copy' });
}
const inviteText = () => `I'm member #${me?.memberNo} on StudyGraph: short study videos made for your syllabus. Join me: ${inviteLink()}`;
/** A funnel step counted on the server by day (landing seen, sign-in tapped, install). */
const funnel = (step, extra = {}) => { try { navigator.sendBeacon?.('/api/funnel', new Blob([JSON.stringify({ step, ...extra })], { type: 'text/plain' })) || fetch('/api/funnel', { method: 'POST', body: JSON.stringify({ step, ...extra }), keepalive: true }); } catch { /* fine */ } };

/** Reminders (public/push.js): one nudge a day at most, when a streak is about to end or reviews are due. */
async function renderPushCard() {
  const card = $('#push-card');
  try {
    const { enabled } = await api('GET', '/api/push/key');
    if (!enabled) { card.hidden = true; return; }
    const push = await import('/push.js');
    const state = await push.pushState();
    if (state === 'unsupported') { card.hidden = true; return; }
    const copyFor = (s) => ({
      'install-first': 'Add StudyGraph to your Home Screen (Share, then Add to Home Screen) and reminders become available.',
      denied: 'Notifications are blocked for StudyGraph in your browser settings.',
      subscribed: 'Reminders are on for this device: a streak about to end, units due for review. One a day at most.',
    }[s] || 'Get one nudge when your streak is about to end or a review is due. Never more than one a day.');
    const copy = el('p', { class: 'muted' }, copyFor(state));
    const btn = el('button', { type: 'button', class: `btn ${state === 'subscribed' ? 'ghost' : 'primary'}` }, state === 'subscribed' ? 'Turn off reminders' : 'Enable reminders');
    btn.hidden = state === 'denied' || state === 'install-first';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const next = state === 'subscribed' ? await push.disablePush() : await push.enablePush();
        track(next === 'subscribed' ? 'push_enabled' : 'push_disabled', {});
        if (next === 'off' && state !== 'subscribed') toast('Reminders are not available on this server yet.');
        renderPushCard();
      } finally { btn.disabled = false; }
    };
    card.hidden = false;
    card.replaceChildren(el('h3', {}, 'Reminders'), copy, btn);
  } catch { card.hidden = true; }
}

function renderInvite() {
  const card = $('#invite-card');
  if (!me?.memberNo) { card.hidden = true; return; }
  card.hidden = false;
  const link = inviteLink();
  const count = me.invites || 0;
  const share = async () => {
    track('invite_share', {});
    try {
      if (navigator.share) { await navigator.share({ title: 'StudyGraph', text: inviteText(), url: link }); toast('Thanks for spreading the word!'); return; }
    } catch (err) { if (err?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(inviteText()); toast('Invite copied. Paste it anywhere.'); } catch { toast(link); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Link copied.'); } catch { toast(link); } };
  card.replaceChildren(el('h3', {}, 'Invite a friend'),
    el('p', { class: 'muted' }, `Your link carries your member number. Friends who join with it are counted here${me.referredBy ? `, like you were by #${me.referredBy}` : ''}.`),
    el('div', { class: 'invite-link' }, el('code', {}, link.replace(/^https?:\/\//, '')), el('button', { type: 'button', class: 'btn small ghost', onclick: copy }, 'Copy')),
    el('div', { class: 'badges' }, el('button', { type: 'button', class: 'btn small primary', onclick: share }, svgEl(svg_share), 'Share invite')),
    el('p', { class: 'invite-count' }, count ? `${count} friend${count === 1 ? '' : 's'} joined with your link` : 'Nobody yet. Be the one who got them started.'));
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
    scopes: 'Vidmoat did not grant the permissions StudyGraph needs. Try again and allow all of them.',
  }[auth] || null;
}

async function boot() {
  capturePack(); // a ?pack= link is remembered before anything else happens
  captureChannelLink(); // so is a ?c= / ?follow= link from a course profile page
  if ('serviceWorker' in navigator) {
    // Check for a new worker on every open; when one takes over mid-session, reload once so the
    // page runs one deploy's HTML, JS and CSS together.
    navigator.serviceWorker.register('/sw.js').then((reg) => reg.update().catch(() => {})).catch(() => {});
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); hadController = true; });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; funnel('install_prompt'); if (view === 'profile') renderProfile(); if (!$('#landing').hidden) $('#ld-install').hidden = false; });
  window.addEventListener('appinstalled', () => funnel('installed'));
  captureRef();

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
  // Sign in with Vidmoat is the way in: the landing page explains StudyGraph and hands over to
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
  await applyPendingPack();

  // Browsers allow sound only after a tap on the page; onboarding (or sign-in) already gave one.
  if (!onboarded && !notice) {
    $('#sound-gate').hidden = false;
    await new Promise((r) => { $('#sound-go').onclick = r; });
    $('#sound-gate').hidden = true;
  }
  ensureEndSlide();
  track('session_start', { source: matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'app' : 'browser', entry: linked ? 'link' : hash ? hash.slice(1, 12) : 'feed', ageBand: ageBand(me?.profile?.age) });
  if (hash === '#library' || hash === '#profile' || hash === '#explore') showView(hash.slice(1)); else showView('feed');
  // Installed app: a shortcut or a link opened while it is running focuses it and goes there.
  document.body.classList.toggle('standalone', standalone);
  if ('launchQueue' in window) window.launchQueue.setConsumer((p) => { const h = p.targetURL ? new URL(p.targetURL).hash : ''; if (['#library', '#profile', '#explore'].includes(h)) showView(h.slice(1)); });
  // The icon badge (lessons due for review) is kept fresh in the background.
  if (standalone) setTimeout(() => api('GET', '/api/library').then((lib) => setBadge(lib.units.filter((u) => u.active && u.dueForReview).length + (lib.misses?.length || 0))).catch(() => {}), 4000);
  $('#sound-go')?.addEventListener('click', startSensors, { once: true });
  if (linked) await openVideo(linked);
  await loadMore(3);
  applyPendingChannel();
  if (feed.active < 0 && feed.items.length) goTo(0, { animate: false });
  if (!store.get('st_swiped') && !feed.items[feed.active]?.moment) { // a moment card says how to continue itself
    $('#swipe-hint').hidden = false;
    setTimeout(() => { $('#swipe-hint').hidden = true; }, 6000);
  }
}


// ============================================================================ course profiles
// Every course has a public profile, @handle (server/feed/channels.js). Students follow and
// unfollow them; a profile shows the course's lessons as a grid that plays as a feed, and can be
// shared as study-graph.com/@handle. Students who create a course (a researched course or their
// own topic) name its handle; a course that already exists is followed instead of duplicated.
const fmtCount = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n || 0));
const profileUrl = (h) => `${location.origin}/@${h}`;
const isFollowingHandle = (h) => (me?.following || []).includes(h);
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._-]{1,38}[a-z0-9])$/;
const channelUi = { handle: null, data: null, lessons: [], more: false, pushed: false };

/** Follow (on) or unfollow a course profile and update every place that shows it. */
async function setFollow(handle, on, { source = 'app' } = {}) {
  const res = await api(on ? 'POST' : 'DELETE', `/api/channels/${handle}/follow`);
  me = { ...me, following: on ? [...new Set([...(me?.following || []), handle])] : (me?.following || []).filter((h) => h !== handle) };
  track(on ? 'channel_follow' : 'channel_unfollow', { handle, source });
  feed.items.forEach((it) => { if (it.data?.channel?.handle === handle) { it.data.channel.following = on; renderChannelChip(it); } });
  if (channelUi.data?.handle === handle) { channelUi.data.following = on; channelUi.data.followers = res.followers; renderChannelHead(); }
  if (res.left && res.user) {
    me = { ...me, ...res.user, billing: me?.billing };
    toast(`Unfollowed @${handle}. It has left your course.`);
    restartFeed();
  } else toast(on ? `Following @${handle}. Its lessons will join your feed.` : `Unfollowed @${handle}.`);
  return res;
}

/** A course's face: its picture when it has one, else its topic emoji. */
function face(c, emoji) {
  return c?.avatar ? el('img', { src: c.avatar, alt: '', loading: 'lazy', decoding: 'async', class: 'face-img' }) : document.createTextNode(emoji || c?.topic?.emoji || '📚');
}

/** The course avatar on a lesson's rail (like a creator's picture): its topic, a + until followed. */
function renderChannelChip(item) {
  const av = $('.rail-av', item.el);
  const ch = item.data?.channel;
  if (!av) return;
  av.hidden = !ch;
  if (!ch) return;
  const topic = item.data.topic || {};
  $('.av-face', av).replaceChildren(face(ch, topic.emoji));
  av.style.setProperty('--av', topic.accent || '#ffd93d');
  $('.av-open', av).setAttribute('aria-label', `${ch.name || 'Course'} (@${ch.handle}): open its profile`);
  $('.av-plus', av).hidden = Boolean(ch.following || isFollowingHandle(ch.handle));
}

function wireChannelChip(item) {
  const av = $('.rail-av', item.el);
  if (!av) return;
  $('.av-open', av).onclick = () => item.data?.channel && openChannel(item.data.channel.handle, { source: 'slide' });
  $('.av-plus', av).onclick = async (e) => {
    e.stopPropagation();
    const h = item.data?.channel?.handle;
    const btn = e.currentTarget; // null once the handler has awaited
    if (!h) return;
    btn.disabled = true;
    try { await setFollow(h, true, { source: 'slide' }); } catch { toast("Couldn't follow that course."); }
    btn.disabled = false;
  };
}

/** The ⋯ menu on a lesson: everything that is not like, save or share. */
function openMore(item) {
  const d = item.data;
  track('more_open', { videoId: d.id });
  const row = (icon, title, sub, act) => el('button', { type: 'button', class: 'set-row', onclick: async () => { await closeSheet(); act(); } },
    el('span', { class: 'set-ic', 'aria-hidden': 'true' }, icon), el('span', { class: 'set-text' }, el('strong', {}, title), sub ? el('small', {}, sub) : null));
  const rows = [
    d.channel ? row(d.topic?.emoji || '📚', d.channel.name || 'Course', `@${d.channel.handle}`, () => openChannel(d.channel.handle, { source: 'more' })) : null,
    d.status === 'ready' ? row('🙋', 'Ask about this lesson', 'A private question to the tutor', () => openAsk(item)) : null,
    row('💡', "Why you're seeing this", 'What the algorithm used', () => { sendEvent(d.id, 'why_open'); openWhy(item); }),
    d.notes ? row('📝', 'Lesson notes', 'Points, definitions and the quick check', () => openNotes(item)) : null,
    row('🙈', 'Show me less of this', d.unit?.title || d.topic?.label || '', () => {
      sendEvent(d.id, 'less', { t: +(item.watch?.lastT || 0).toFixed(1) });
      toast(`Got it: less of ${d.unit?.title || d.topic.label}`);
      if (feed.items[feed.active] === item) go(1);
    }),
    row('🎚️', 'Tune your feed', 'Topics, narration, length, difficulty', () => { track('tune_open'); openTune(); }),
  ].filter(Boolean);
  openSheet('More', el('div', { class: 'settings-list more-list' }, ...rows));
}

function channelRoot() {
  let root = $('#channel-view');
  if (!root) {
    root = el('section', { id: 'channel-view', class: 'channel-view', hidden: '', 'aria-label': 'Course profile' });
    document.body.append(root);
    window.addEventListener('popstate', () => { if (!root.hidden && !String(history.state?.channel || '')) closeChannel({ fromPop: true }); });
  }
  return root;
}

/** Opens a course profile over the app. */
async function openChannel(handle, { source = 'app' } = {}) {
  const h = String(handle || '').replace(/^@/, '').toLowerCase();
  if (!HANDLE_RE.test(h)) return;
  if (!$('#sheet').hidden) closeSheet(); // a profile opened from a sheet replaces it
  const root = channelRoot();
  Object.assign(channelUi, { handle: h, data: null, lessons: [], more: false });
  root.hidden = false;
  document.body.classList.add('channel-open');
  feed.covered = true;
  syncPlayers({ light: true });
  if (!channelUi.pushed) { history.pushState({ channel: h }, '', `#@${h}`); channelUi.pushed = true; }
  root.replaceChildren(channelTop(h), el('div', { class: 'ch-loading' }, el('span', { class: 'spinner' })));
  try {
    const { channel, lessons, more } = await api('GET', `/api/channels/${h}`);
    if (channelUi.handle !== h) return;
    // An old handle of a renamed course: show and address it by its current one.
    if (channel.handle !== h) { channelUi.handle = channel.handle; history.replaceState({ channel: channel.handle }, '', `#@${channel.handle}`); }
    Object.assign(channelUi, { data: channel, lessons, more });
    track('channel_view', { handle: h, source });
    renderChannel();
  } catch (err) {
    root.replaceChildren(channelTop(h), el('div', { class: 'ch-empty' }, err.status === 404 ? `There is no course called @${h}.` : "Couldn't load this course. Try again."));
  }
}

function closeChannel({ fromPop = false } = {}) {
  const root = channelRoot();
  root.hidden = true;
  document.body.classList.remove('channel-open');
  feed.covered = false;
  if (channelUi.pushed && !fromPop) { channelUi.pushed = false; history.back(); } else channelUi.pushed = false;
  channelUi.handle = null;
  if (view === 'feed') syncPlayers();
}

function channelTop(h) {
  return el('div', { class: 'ch-top' },
    el('button', { type: 'button', class: 'ch-back', 'aria-label': 'Back', onclick: () => closeChannel() }, '‹'),
    el('strong', { class: 'ch-top-handle' }, `@${h}`),
    el('button', { type: 'button', class: 'ch-share-top', 'aria-label': 'Share this course', onclick: () => shareChannel(h, 'top') }, svgEl(svg_share)));
}

async function shareChannel(h, where = 'profile') {
  const d = channelUi.data?.handle === h ? channelUi.data : null;
  const title = d ? `${d.name} (@${h})` : `@${h}`;
  const url = profileUrl(h);
  try {
    if (navigator.share) { await navigator.share({ title, text: `${title} on StudyGraph: short study videos for this course.`, url }); track('channel_share', { handle: h, by: `native-${where}` }); return; }
    await navigator.clipboard.writeText(url);
    track('channel_share', { handle: h, by: `copy-${where}` });
    toast('Profile link copied.');
  } catch { /* cancelled */ }
}

function renderChannel() {
  const root = channelRoot();
  const d = channelUi.data;
  root.style.setProperty('--accent', d.topic?.accent || '#ffd93d');
  const head = el('header', { class: 'ch-head' });
  const grid = el('div', { class: 'ch-grid' });
  const moreBtn = el('button', { type: 'button', class: 'btn ghost small ch-more', hidden: !channelUi.more }, 'Load more lessons');
  moreBtn.onclick = async () => {
    moreBtn.disabled = true;
    const last = channelUi.lessons[channelUi.lessons.length - 1];
    try {
      const { lessons, more } = await api('GET', `/api/channels/${d.handle}/lessons?before=${last?.at || ''}`);
      channelUi.lessons.push(...lessons); channelUi.more = more;
      fillGrid(grid); moreBtn.hidden = !more;
    } catch { toast("Couldn't load more."); }
    moreBtn.disabled = false;
  };
  const units = (d.units || []).length ? el('details', { class: 'ch-syllabus' }, el('summary', {}, `What it covers · ${d.units.length} unit${d.units.length > 1 ? 's' : ''}`),
    el('ol', {}, ...d.units.map((u) => el('li', {}, el('strong', {}, u.title), u.summary ? el('span', {}, u.summary) : null)))) : null;
  root.replaceChildren(channelTop(d.handle), el('div', { class: 'ch-scroll' }, head, units, grid, moreBtn));
  renderChannelHead();
  fillGrid(grid);
}

function renderChannelHead() {
  const d = channelUi.data;
  const head = $('#channel-view .ch-head');
  if (!d || !head) return;
  const on = d.following;
  const followBtn = el('button', { type: 'button', class: `btn ${on ? 'ghost' : 'primary'} ch-follow-btn` }, on ? 'Following ✓' : 'Follow');
  followBtn.onclick = async () => {
    if (on && d.inCourse && !confirm(`Unfollow @${d.handle}? It is part of your course, so its units will leave your feed too.`)) return;
    followBtn.disabled = true;
    try { await setFollow(d.handle, !on, { source: 'profile' }); } catch { toast("Couldn't change that."); followBtn.disabled = false; }
  };
  const kicker = [d.topic ? `${d.topic.emoji} ${d.topic.label}` : null, d.level?.label, d.official ? 'Official course' : d.kind === 'pack' ? 'Community pack' : 'Made by a student'].filter(Boolean).join(' · ');
  head.replaceChildren(
    el('div', { class: 'ch-avatar', 'aria-hidden': 'true' }, face(d)),
    el('h2', { class: 'ch-name' }, d.name),
    el('p', { class: 'ch-handle' }, `@${d.handle}`, d.mine ? el('span', { class: 'sbadge', style: '--r:-2deg' }, 'you named it') : null),
    el('p', { class: 'ch-kicker' }, kicker),
    el('ul', { class: 'ch-stats' },
      el('li', {}, el('strong', {}, fmtCount(d.lessons)), 'lessons'),
      el('li', {}, el('strong', {}, fmtCount(d.followers)), 'followers'),
      el('li', {}, el('strong', {}, fmtCount(d.views)), 'views')),
    d.bio ? el('p', { class: 'ch-bio' }, d.bio) : null,
    el('div', { class: 'ch-actions' }, followBtn,
      el('button', { type: 'button', class: 'btn ghost', disabled: !channelUi.lessons.length, onclick: () => playChannel(0, 'play') }, '▶ Play all'),
      el('button', { type: 'button', class: 'btn ghost', 'aria-label': 'Share', onclick: () => shareChannel(d.handle) }, svgEl(svg_share))),
    d.canRename ? el('div', { class: 'ch-owner' },
      el('button', { type: 'button', class: 'link ch-rename', onclick: () => pickPicture(d) }, d.avatar ? '🖼️ Change picture' : '🖼️ Add a picture'),
      d.avatar ? el('button', { type: 'button', class: 'link ch-rename', onclick: () => removePicture(d) }, 'Remove picture') : null,
      el('button', { type: 'button', class: 'link ch-rename', onclick: () => openRename(d) }, '✏️ Change handle')) : null);
}

/**
 * Picks, crops (centre square) and shrinks a picture in the browser, then sends it as a JPEG. Re-encoding
 * drops the photo's EXIF data (location, device). The server has it checked before anyone sees it.
 */
function pickPicture(d) {
  const input = el('input', { type: 'file', accept: 'image/*', hidden: '' });
  document.body.append(input);
  input.onchange = async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast('That picture is too big. Try one under 15 MB.');
    let dataUrl;
    try { dataUrl = await squareJpeg(file, 320); } catch { return toast("Couldn't read that picture. Try a JPEG or PNG."); }
    toast('Checking your picture…');
    try {
      const { channel } = await api('POST', `/api/channels/${d.handle}/avatar`, { image: dataUrl });
      track('channel_avatar', { handle: d.handle, outcome: 'set' });
      channelUi.data = channel;
      feed.items.forEach((it) => { if (it.data?.channel?.handle === d.handle) { it.data.channel.avatar = channel.avatar; renderChannelChip(it); } });
      xp.data = null;
      renderChannelHead();
      toast('Picture added.');
    } catch (err) {
      track('channel_avatar', { handle: d.handle, outcome: err.status === 422 ? 'rejected' : 'error' });
      toast(err.message || "Couldn't add that picture.");
    }
  };
  input.click();
}

async function removePicture(d) {
  try {
    const { channel } = await api('DELETE', `/api/channels/${d.handle}/avatar`);
    channelUi.data = channel;
    feed.items.forEach((it) => { if (it.data?.channel?.handle === d.handle) { it.data.channel.avatar = null; renderChannelChip(it); } });
    xp.data = null;
    renderChannelHead();
  } catch { toast("Couldn't remove the picture."); }
}

/** A centred square crop of an image file, `size` px, as a JPEG data URL (orientation applied). */
async function squareJpeg(file, size) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = el('canvas', { width: String(size), height: String(size) });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close?.();
  for (const q of [0.86, 0.75, 0.6]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length < 260000) return url;
  }
  throw new Error('too large');
}

/** The student who brought a course changes its handle; the old one keeps redirecting. */
function openRename(d) {
  let handle = null;
  const save = el('button', { type: 'button', class: 'btn primary', disabled: '' }, 'Save');
  const body = el('div', { class: 'name-sheet' },
    el('p', {}, `Links to @${d.handle} keep working: they open the new handle. Followers stay. You can change it up to 3 times a month.`),
    handleField(d.handle, (h) => { handle = h; save.disabled = !h; save.textContent = h ? `Change to @${h}` : 'Save'; }, { current: d.handle }),
    save);
  save.onclick = async () => {
    if (!handle) return;
    save.disabled = true;
    try {
      const { channel, from } = await api('POST', `/api/channels/${d.handle}/rename`, { handle });
      track('channel_rename', { handle: channel.handle, from });
      me = { ...me, following: (me?.following || []).map((h) => (h === from ? channel.handle : h)) };
      feed.items.forEach((it) => { if (it.data?.channel?.handle === from) { it.data.channel.handle = channel.handle; renderChannelChip(it); } });
      xp.data = null;
      channelUi.handle = channel.handle;
      channelUi.data = channel;
      history.replaceState({ channel: channel.handle }, '', `#@${channel.handle}`);
      await closeSheet();
      renderChannel();
      toast(`Your course is now @${channel.handle}.`);
    } catch (err) {
      toast(err.message || "Couldn't change the handle.");
      save.disabled = false;
    }
  };
  openSheet('Change handle', body);
}

function fillGrid(grid) {
  const list = channelUi.lessons;
  if (!list.length) { grid.replaceChildren(el('p', { class: 'ch-empty' }, 'The first lessons for this course are being made. Follow it and they will come to your feed.')); return; }
  // A course's lessons are made for students in different countries; ones made for another country say so.
  grid.replaceChildren(...list.map((l, i) => el('button', { type: 'button', class: 'ch-tile', onclick: () => playChannel(i, 'tile') },
    l.poster ? el('img', { src: l.poster, alt: '', loading: 'lazy', decoding: 'async' }) : el('span', { class: 'ch-tile-blank' }),
    l.loc && l.loc !== localRegion() ? el('span', { class: 'ch-tile-loc' }, `Made for ${regionName(l.loc)}`) : null,
    el('span', { class: 'ch-tile-meta' }, el('span', { class: 'ch-tile-title' }, l.title || l.unit || 'Lesson'), el('span', { class: 'ch-tile-len' }, [l.format, l.duration ? minsOf(l.duration) : null].filter(Boolean).join(' · '))))));
}

/** Plays the profile's lessons as a feed, starting at `i`. */
async function playChannel(i, how) {
  const h = channelUi.handle;
  // The tapped lesson always plays; the ones after it are the student's country's (or no country's).
  const list = channelUi.lessons.slice(i).filter((l, k) => k === 0 || !l.loc || l.loc === localRegion());
  if (!list.length) return;
  track(how === 'play' ? 'channel_play' : 'channel_lesson_open', how === 'play' ? { handle: h, from: 'profile' } : { handle: h, id: list[0].id });
  closeChannel();
  await queueLessons(list, `channel:${h}`);
}

/**
 * A handle field: "@" + input with a live availability check. `onChange(handle|null)` gets the
 * handle while it is valid and free, null otherwise.
 */
function handleField(initial, onChange, { current = null } = {}) {
  const input = el('input', { type: 'text', class: 'handle-input', value: initial || '', maxlength: '40', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Course handle' });
  const note = el('small', { class: 'handle-note' }, '');
  let timer = null;
  let seq = 0;
  const check = async () => {
    const v = input.value.trim().replace(/^@/, '').toLowerCase();
    if (input.value !== v) input.value = v;
    const mine = ++seq;
    if (!v) { note.textContent = 'Pick a handle for this course.'; note.dataset.ok = 'false'; onChange(null); return; }
    if (v === current) { note.textContent = 'This is the current handle.'; note.dataset.ok = ''; onChange(null); return; }
    try {
      const r = await api('GET', `/api/channels/check?handle=${encodeURIComponent(v)}`);
      if (mine !== seq) return;
      note.dataset.ok = String(r.ok);
      note.textContent = r.ok ? `study-graph.com/@${r.handle} is yours.` : `${r.reason}${r.suggestion ? ` Try @${r.suggestion}.` : ''}`;
      onChange(r.ok ? r.handle : null);
    } catch { onChange(null); }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 250); });
  check();
  return el('div', { class: 'handle-field' }, el('label', { class: 'handle-row' }, el('span', { 'aria-hidden': 'true' }, '@'), input), note);
}

/** A course profile as a small card (Explore, Following, "already exists"). */
function channelCard(c, { onFollowChange } = {}) {
  const on = c.following || isFollowingHandle(c.handle);
  const btn = el('button', { type: 'button', class: `btn small ${on ? 'ghost' : 'primary'}` }, on ? 'Following' : 'Follow');
  btn.onclick = async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    try {
      if (on && c.inCourse && !confirm(`Unfollow @${c.handle}? It is part of your course, so its units will leave your feed too.`)) { btn.disabled = false; return; }
      await setFollow(c.handle, !on, { source: 'card' });
      onFollowChange?.();
    } catch { toast("Couldn't change that."); btn.disabled = false; }
  };
  return el('article', { class: 'ch-card', style: `--accent:${c.topic?.accent || '#ffe580'}`, tabindex: '0', onclick: () => openChannel(c.handle, { source: 'card' }), onkeydown: (e) => { if (e.key === 'Enter') openChannel(c.handle, { source: 'card' }); } },
    el('div', { class: 'ch-card-av', 'aria-hidden': 'true' }, face(c)),
    el('div', { class: 'ch-card-text' }, el('strong', {}, c.name), el('small', {}, `@${c.handle} · ${fmtCount(c.followers)} follower${c.followers === 1 ? '' : 's'} · ${fmtCount(c.lessons)} lessons`)),
    btn);
}

/**
 * Adds a topic of the student's own. If the topic is already on StudyGraph, offers to follow it
 * instead of making a copy; if it is new, asks for its handle first. Returns `added` or null.
 */
async function addCustomTopic(title, { programKey = null } = {}) {
  title = String(title || '').trim();
  if (title.length < 2) return null;
  let found = null;
  try { found = await api('GET', `/api/channels/for?title=${encodeURIComponent(title)}`); } catch { /* offline check: just add */ }
  const choice = await new Promise((resolve) => {
    if (!found) return resolve({ handle: null });
    let handle = null;
    const body = el('div', { class: 'name-sheet' });
    if (found.channel) {
      track('channel_search', { q: title, results: 1 });
      body.append(el('p', {}, `"${title}" is already on StudyGraph. Follow it to get its lessons, and share them with everyone else studying it.`),
        channelCard(found.channel),
        el('button', { type: 'button', class: 'btn primary', onclick: () => { resolve({ handle: found.channel.handle, existing: true }); closeSheet(); } }, `Follow @${found.channel.handle}`));
    } else {
      const go = el('button', { type: 'button', class: 'btn primary', disabled: '' }, 'Create course');
      body.append(el('p', {}, `"${title}" has no course profile yet. Give it a handle: it becomes the course's profile, study-graph.com/@handle, and anyone who adds the same topic will follow it.`),
        handleField(found.suggestion, (h) => { handle = h; go.disabled = !h; go.textContent = h ? `Create @${h}` : 'Create course'; }), go);
      go.onclick = () => { resolve({ handle }); closeSheet(); };
    }
    openSheet(found.channel ? 'Already on StudyGraph' : 'Name your course', body, () => resolve(null));
  });
  if (!choice) return null;
  const { added } = await patchMe({ addCustom: { title, programKey, handle: choice.existing ? null : choice.handle } }).catch(() => ({}));
  if (!added) { toast("Couldn't add that topic."); return null; }
  track('custom_add', { title: added.title });
  if (added.channel?.handle) me = { ...me, following: [...new Set([...(me?.following || []), added.channel.handle])] };
  toast(added.channel?.existed ? `Following @${added.channel.handle}. Lessons are on their way.` : `Created @${added.channel?.handle || added.title}. Lessons are on their way.`);
  return added;
}

/** The courses a student follows, in a sheet (from the "following" count on their profile). */
async function openFollowing() {
  const body = el('div', { class: 'name-sheet' }, el('div', { class: 'ch-loading' }, el('span', { class: 'spinner' })));
  openSheet('Following', body, () => { if (view === 'profile') renderProfile(); });
  try {
    const { channels } = await api('GET', '/api/me/following');
    body.replaceChildren(channels.length ? el('div', { class: 'xch-list' }, ...channels.map((c) => channelCard(c)))
      : el('p', { class: 'muted' }, 'Follow courses from Explore, or from the @handle on any lesson.'));
  } catch { body.replaceChildren(el('p', { class: 'muted' }, "Couldn't load who you follow.")); }
}

/**
 * The Profile tab's settings as one short list. Each row opens its card in a sheet; the cards
 * live in #profile-drawer and go back there when the sheet closes, so their render functions
 * keep finding them by id.
 */
function renderSettingsList() {
  const list = $('#settings-list');
  if (!list) return;
  const b = me?.billing;
  const p = me?.profile || {};
  const lvl = cfg.levels.find((l) => l.id === p.level);
  const rows = [
    ['credits-card', '🎟️', 'Credits', b ? (b.mode === 'own' ? 'Using your Vidmoat credits' : `${b.houseLeft ?? 0} free lesson${b.houseLeft === 1 ? '' : 's'} left`) : ''],
    ['studies-card', '🎓', 'Your studies', [p.program, lvl?.label].filter(Boolean).join(' · ') || 'Level, course and interests'],
    ['tune-card', '🎚️', 'Feed settings', 'Topics, narration, length, difficulty'],
    ['invite-card', '💌', 'Invite friends', `${me?.invites || 0} joined with your link`],
    ['push-card', '🔔', 'Reminders', 'Streak and review nudges'],
    ['account-card', '👤', 'Account', me?.vidmoat ? (me.vidmoat.email || me.vidmoat.name) : 'Sign in to keep your progress'],
    ['install-card', '📲', 'Install the app', 'Full screen, from your home screen'],
    ['reset-card', '♻️', 'Start fresh', 'Reset your feed or everything'],
  ].filter(([id]) => $(`#${id}`) && !$(`#${id}`).hidden);
  list.replaceChildren(...rows.map(([id, icon, title, sub]) => el('button', { type: 'button', class: 'set-row', onclick: () => (id === 'tune-card' ? (track('tune_open'), openTune()) : openSettingsCard(id, title)) },
    el('span', { class: 'set-ic', 'aria-hidden': 'true' }, icon), el('span', { class: 'set-text' }, el('strong', {}, title), sub ? el('small', {}, sub) : null), el('span', { class: 'set-go', 'aria-hidden': 'true' }, '›'))));
}

function openSettingsCard(id, title) {
  const card = $(`#${id}`);
  if (!card) return;
  track('settings_open', { card: id.replace('-card', '') });
  const back = () => { $('#profile-drawer').append(card); card.classList.remove('in-sheet'); renderSettingsList(); };
  card.classList.add('in-sheet');
  openSheet(title, card, back);
}

/** ?c=<handle> opens a profile; ?follow=<handle> follows it too (links from the public /@handle page). */
function captureChannelLink() {
  const params = new URLSearchParams(location.search);
  const follow = params.get('follow');
  const open = params.get('c');
  const h = (follow || open || '').toLowerCase();
  if (h && HANDLE_RE.test(h)) {
    store.set('st_channel', JSON.stringify({ h, follow: Boolean(follow) }));
    const url = new URL(location.href); url.searchParams.delete('follow'); url.searchParams.delete('c'); history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  const hash = /^#@([a-z0-9._-]{3,40})$/.exec(location.hash)?.[1];
  if (hash && !store.get('st_channel')) store.set('st_channel', JSON.stringify({ h: hash, follow: false }));
}
async function applyPendingChannel() {
  let pending = null;
  try { pending = JSON.parse(store.get('st_channel') || 'null'); localStorage.removeItem('st_channel'); } catch { /* fine */ }
  if (!pending?.h || !me?.setupDone) return;
  if (location.hash.startsWith('#@')) history.replaceState(null, '', location.pathname);
  if (pending.follow && !isFollowingHandle(pending.h)) await setFollow(pending.h, true, { source: 'link' }).catch(() => {});
  openChannel(pending.h, { source: 'link' });
}

// Last: every top-level declaration above must exist before boot's synchronous start runs.
boot().catch((err) => {
  console.error(err);
  toast('StudyGraph could not start. Is the server running?');
});

// ============================================================================ ask, talk, exam
// Ask: a private question to a tutor that has the lesson in front of it (server/feed/ask.js).
const ASK_STARTERS = ['Explain it more simply', 'Give me another example', 'Why is that the answer?', 'How would this come up in an exam?'];
function openAsk(item) {
  const d = item.data;
  sendEvent(d.id, 'ask_open');
  const input = el('textarea', { class: 'ask-input', rows: '3', maxlength: '300', placeholder: 'What would you like to understand better?' });
  const out = el('div', { class: 'ask-out', 'aria-live': 'polite' });
  const send = el('button', { type: 'button', class: 'btn primary' }, 'Ask');
  const ask = async (q) => {
    q = String(q || '').trim();
    if (q.length < 3) { input.focus(); return; }
    send.disabled = true;
    out.replaceChildren(el('p', { class: 'muted' }, el('span', { class: 'spinner' }), ' Thinking…'));
    try {
      const r = await api('POST', `/api/videos/${d.id}/ask`, { q });
      sendEvent(d.id, 'ask', { len: q.length, onTopic: r.onTopic });
      out.replaceChildren(el('div', { class: 'ask-q' }, q), el('div', { class: 'ask-a' }, r.answer));
      if (r.followUp) {
        out.append(el('button', { type: 'button', class: 'btn small', onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          sendEvent(d.id, 'ask_follow');
          if (await addCustomTopic(r.followUp)) b.textContent = `Lessons on "${r.followUp}" are coming to your feed`;
          else b.disabled = false;
        } }, `Make me lessons on "${r.followUp}"`));
      }
      input.value = '';
    } catch (err) {
      out.replaceChildren(el('p', { class: 'ask-err' }, err.message || "Couldn't ask right now."));
    } finally { send.disabled = false; }
  };
  send.onclick = () => ask(input.value);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
  const body = el('div', { class: 'ask' },
    el('p', { class: 'muted' }, `About "${d.title || d.unit?.title || 'this lesson'}". Only you see your questions.`),
    el('div', { class: 'chips' }, ...ASK_STARTERS.map((t) => el('button', { type: 'button', class: 'chip-btn', onclick: () => ask(t) }, t))),
    input, el('div', { class: 'ask-actions' }, send), out);
  openSheet('Ask about this lesson', body);
  setTimeout(() => input.focus(), 50);
}

// Talk: comments under a lesson, adults only (the server refuses minors whatever the app shows).
const timeAgo = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
// The comments panel, like TikTok's: a bottom sheet over the lower part of the screen while the
// lesson keeps playing above it. Top comments first, likes, one level of replies, and answers from
// the StudyGraph Tutor under questions (server/feed/comments.js).
const AV_COLORS = ['#ffd93d', '#8fc1ff', '#ff9ecb', '#9be7b0', '#c6a8ff', '#ffb48a'];
const avColor = (name) => AV_COLORS[[...String(name)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AV_COLORS.length];
const heartSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
let talkOpen = null; // { item, close }
function talkAvatar(c) {
  return c.ai
    ? el('span', { class: 'tk-av ai', 'aria-hidden': 'true' }, '✨')
    : el('span', { class: 'tk-av', style: `background:${avColor(c.name)}`, 'aria-hidden': 'true' }, (c.name || '?')[0].toUpperCase());
}
async function openComments(item) {
  const d = item.data;
  if (talkOpen) talkOpen.close();
  sendEvent(d.id, 'comments_open');
  let replyTo = null; // { id, name }
  let refreshTimers = [];
  const count = el('strong', { class: 'tk-count' }, 'Comments');
  const list = el('div', { class: 'tk-list' }, el('div', { class: 'tk-empty' }, el('span', { class: 'spinner' })));
  const input = el('input', { type: 'text', class: 'tk-input', maxlength: '300', placeholder: 'Add a comment…', 'aria-label': 'Add a comment', enterkeyhint: 'send' });
  const sendBtn = el('button', { type: 'button', class: 'tk-send', 'aria-label': 'Post', disabled: true }, svgEl('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'));
  const replying = el('div', { class: 'tk-replying', hidden: true });
  const note = el('p', { class: 'tk-note', 'aria-live': 'polite' });
  const meName = me?.vidmoat?.name || 'You';

  const heart = (c) => {
    const b = el('button', { type: 'button', class: `tk-heart${c.liked ? ' on' : ''}`, 'aria-label': c.liked ? 'Unlike' : 'Like', 'aria-pressed': String(c.liked) },
      svgEl(heartSvg), el('span', {}, c.likes ? fmtCount(c.likes) : ''));
    b.onclick = async () => {
      const on = !c.liked;
      haptic(on ? 'select' : 'tap');
      c.liked = on; c.likes = Math.max(0, c.likes + (on ? 1 : -1));
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); $('span', b).textContent = c.likes ? fmtCount(c.likes) : '';
      try { await api(on ? 'POST' : 'DELETE', `/api/comments/${c.id}/like`); } catch { /* the next load shows the truth */ }
    };
    return b;
  };
  const row = (c, { reply = false, parent = null } = {}) => {
    const actions = el('div', { class: 'tk-meta' }, el('span', {}, timeAgo(c.at)));
    if (!c.ai) actions.append(el('button', { type: 'button', class: 'tk-link', onclick: () => startReply(parent || c, c.name) }, 'Reply'));
    if (c.mine) actions.append(el('button', { type: 'button', class: 'tk-link', onclick: async () => { try { await api('DELETE', `/api/comments/${c.id}`); load(); } catch { toast("Couldn't delete that."); } } }, 'Delete'));
    else if (!c.ai) actions.append(el('button', { type: 'button', class: 'tk-link', onclick: async (e) => { const b = e.currentTarget; try { await api('POST', `/api/comments/${c.id}/report`); b.textContent = 'Reported'; b.disabled = true; } catch { toast("Couldn't report that."); } } }, 'Report'));
    return el('div', { class: `tk-row${reply ? ' reply' : ''}${c.ai ? ' ai' : ''}` }, talkAvatar(c),
      el('div', { class: 'tk-body' },
        el('div', { class: 'tk-name' }, c.name, c.ai ? el('span', { class: 'tk-badge' }, 'AI tutor') : null, c.mine ? el('span', { class: 'tk-you' }, '· you') : null),
        el('p', { class: 'tk-text' }, c.text), actions),
      c.ai ? el('span') : heart(c));
  };
  const thread = (c) => {
    const box = el('div', { class: 'tk-thread' }, row(c));
    if (c.tutorPending) box.append(el('div', { class: 'tk-row reply ai pending' }, talkAvatar({ ai: true }), el('div', { class: 'tk-body' }, el('div', { class: 'tk-name' }, 'StudyGraph Tutor', el('span', { class: 'tk-badge' }, 'AI tutor')), el('p', { class: 'tk-text tk-typing' }, 'is answering', el('i'), el('i'), el('i')))));
    if (c.replies.length) {
      // The tutor's answer shows at once; students' replies fold behind "View replies" like TikTok.
      const shown = c.replies.filter((r) => r.ai);
      const folded = c.replies.filter((r) => !r.ai);
      const wrap = el('div', { class: 'tk-replies' }, ...shown.map((r) => row(r, { reply: true, parent: c })));
      box.append(wrap);
      if (folded.length) {
        const more = el('button', { type: 'button', class: 'tk-more' }, `View ${folded.length} repl${folded.length > 1 ? 'ies' : 'y'}`);
        more.onclick = () => { more.replaceWith(...folded.map((r) => row(r, { reply: true, parent: c }))); };
        wrap.append(more);
      }
    }
    return box;
  };
  const load = async () => {
    try {
      const r = await api('GET', `/api/videos/${d.id}/comments`);
      count.textContent = r.count ? `${fmtCount(r.count)} comment${r.count > 1 ? 's' : ''}` : 'Comments';
      list.replaceChildren(...(r.comments.length ? r.comments.map(thread) : [el('div', { class: 'tk-empty' }, el('b', {}, 'No comments yet'), el('span', {}, 'Ask a question and the AI tutor answers it here, for everyone who watches this lesson.'))]));
      // A tutor answer on its way: look again shortly.
      if (r.comments.some((c) => c.tutorPending)) { refreshTimers.forEach(clearTimeout); refreshTimers = [setTimeout(load, 4000), setTimeout(load, 9000), setTimeout(load, 16000)]; }
    } catch (err) { list.replaceChildren(el('div', { class: 'tk-empty' }, err.message || "Couldn't load comments.")); }
  };
  const startReply = (c, name) => {
    replyTo = { id: c.id, name };
    replying.hidden = false;
    replying.replaceChildren(el('span', {}, `Replying to ${name}`), el('button', { type: 'button', 'aria-label': 'Cancel reply', onclick: () => { replyTo = null; replying.hidden = true; } }, '✕'));
    input.placeholder = `Reply to ${name}…`;
    input.focus();
  };
  const submit = async () => {
    const text = input.value.trim();
    if (text.length < 2) return;
    sendBtn.disabled = true; note.textContent = 'Checking…';
    try {
      const r = await api('POST', `/api/videos/${d.id}/comments`, { text, parentId: replyTo?.id });
      sendEvent(d.id, 'comment_post');
      input.value = ''; note.textContent = r.tutor ? 'Posted. The AI tutor is answering your question…' : '';
      replyTo = null; replying.hidden = true; input.placeholder = 'Add a comment…';
      await load();
      if (r.tutor) setTimeout(() => { if (note.textContent.startsWith('Posted')) note.textContent = ''; }, 6000);
    } catch (err) { note.textContent = err.message || "Couldn't post that."; }
    finally { sendBtn.disabled = !input.value.trim(); }
  };
  input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') close(); });
  sendBtn.onclick = submit;

  const panel = el('section', { class: 'tk-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Comments' },
    el('div', { class: 'tk-head' }, el('span', { class: 'tk-grab', 'aria-hidden': 'true' }), count, el('button', { type: 'button', class: 'tk-close', 'aria-label': 'Close comments', onclick: () => close() }, '✕')),
    list,
    el('div', { class: 'tk-foot' }, replying, note,
      el('div', { class: 'tk-compose' }, el('span', { class: 'tk-av', style: `background:${avColor(meName)}`, 'aria-hidden': 'true' }, meName[0].toUpperCase()), input, sendBtn),
      el('p', { class: 'tk-rules' }, 'Be kind, keep it about the lesson. No links or contact details.')));
  const shade = el('div', { class: 'tk-shade', onclick: () => close() });
  const root = el('div', { class: 'tk-root' }, shade, panel);
  // Pull the header down to close, like any bottom sheet; Back closes it too.
  dragToDismiss(panel, $('.tk-head', panel), () => close());
  const layerDone = pushLayer(() => close());
  // iOS keeps the layout height when the keyboard opens: lift the panel above the keyboard.
  const vv = window.visualViewport;
  const fit = () => { if (vv) panel.style.bottom = `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`; };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  function close() {
    layerDone();
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
    refreshTimers.forEach(clearTimeout);
    root.classList.remove('open');
    setTimeout(() => root.remove(), 220);
    talkOpen = null;
    document.body.classList.remove('talk-open');
  }
  document.body.append(root);
  document.body.classList.add('talk-open');
  requestAnimationFrame(() => root.classList.add('open'));
  talkOpen = { item, close };
  load();
}

// Exam mode: countdown, readiness per unit, today's focus and a mock exam (server/feed/exam.js).
function examCard() {
  const card = el('div', { class: 'card exam-card search-hide' }, el('h3', {}, 'Exam mode'), el('p', { class: 'muted' }, el('span', { class: 'spinner' })));
  api('GET', '/api/exam').then((x) => {
    track('exam_open', { days: x.days ?? -1 });
    const pct = Math.round(x.readiness * 100);
    const head = x.days != null && x.days >= 0
      ? `${x.exam || 'Your exam'} ${x.days === 0 ? 'is today' : x.days === 1 ? 'is tomorrow' : `in ${x.days} days`}`
      : 'Practice like it is the exam';
    const parts = [el('h3', {}, head),
      el('div', { class: 'exam-ready' }, el('div', { class: 'exam-bar' }, el('i', { style: `width:${pct}%` })), el('b', {}, `${pct}% ready`))];
    if (x.focus.length) {
      parts.push(el('p', { class: 'muted' }, x.days != null && x.days >= 0 ? 'Today, focus on:' : 'Your weakest units:'),
        el('ul', { class: 'exam-focus' }, ...x.focus.map((u) => el('li', {}, el('span', {}, u.title), el('small', { class: `exam-tag ${u.label.replace(/\s/g, '-')}` }, u.label)))));
    } else parts.push(el('p', { class: 'muted' }, 'Pick a course in your profile and your readiness per unit shows here.'));
    if (!x.examDate) parts.push(el('p', { class: 'pref-hint' }, 'Add your exam date in Profile → Edit studies for a countdown and a daily plan.'));
    parts.push(el('button', { type: 'button', class: 'btn primary small', onclick: () => openMockExam() }, 'Take a mock exam'));
    card.replaceChildren(...parts);
  }).catch(() => card.remove());
  return card;
}

async function openMockExam() {
  let qs;
  try { qs = (await api('GET', '/api/exam/mock?n=10')).questions; } catch { return toast("Couldn't start the mock exam."); }
  if (!qs.length) return toast('Watch a few lessons first: the mock exam is made from questions in lessons you have seen.');
  track('mock_start', { n: qs.length });
  let i = 0, right = 0;
  const missed = [];
  const body = el('div', { class: 'mock' });
  const show = () => {
    if (i >= qs.length) {
      track('mock_done', { n: qs.length, correct: right });
      const pct = Math.round((right / qs.length) * 100);
      body.replaceChildren(el('div', { class: 'mock-done' }, svgEl(mascot(pct >= 70 ? 'cheer' : 'think')), el('h3', {}, `${right} of ${qs.length} right (${pct}%)`),
        el('p', { class: 'muted' }, pct >= 70 ? 'Strong. Your feed keeps the weaker units coming.' : 'The ones you missed are back in your feed for review, weakest first.'),
        missed.length ? el('ul', { class: 'mock-missed' }, ...missed.map((q) => el('li', {}, el('b', {}, q.question), el('span', {}, `Answer: ${q.options[q.answerIndex]}`), q.explanation ? el('small', {}, q.explanation) : null))) : null,
        el('button', { type: 'button', class: 'btn primary', onclick: () => closeSheet() }, 'Done')));
      return;
    }
    const q = qs[i];
    const started = performance.now();
    const opts = q.options.map((o, k) => el('button', { type: 'button', class: 'mock-opt', onclick: () => {
      const correct = k === q.answerIndex;
      haptic(correct ? 'success' : 'error');
      if (correct) right++; else missed.push(q);
      // The same evidence as a quick check in the video: it moves mastery and the feed.
      sendEvent(q.videoId, 'quiz_answer', { choice: k, correct, ms: Math.round(performance.now() - started) });
      opts.forEach((b, j) => { b.disabled = true; b.classList.toggle('ok', j === q.answerIndex); b.classList.toggle('bad', j === k && !correct); });
      body.append(el('div', { class: 'mock-next' }, q.explanation ? el('p', { class: 'muted' }, q.explanation) : null,
        el('button', { type: 'button', class: 'btn primary small', onclick: () => { i++; show(); } }, i + 1 < qs.length ? 'Next' : 'See my score')));
    } }, `${'ABCD'[k]}. ${o}`));
    body.replaceChildren(el('p', { class: 'mock-meta' }, `Question ${i + 1} of ${qs.length}${q.unit ? ` · ${q.unit}` : ''}`), el('h3', { class: 'mock-q' }, q.question), el('div', { class: 'mock-opts' }, ...opts));
  };
  openSheet('Mock exam', body);
  show();
}
