// StudyTok client: onboarding (level -> studies -> syllabus, with live course research), the
// vertical feed (live Vidmoat players for the active slide ±1, generation polling, tap-to-answer
// quizzes, likes/saves), and the Library (course progress, saved videos, history).

import { VidmoatPlayer } from './player.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const PLAYER_WINDOW = 1;   // keep players mounted for active ±1
const LOAD_MORE_AT = 2;    // fetch more when this many slides remain below the active one
const SKIP_SEC = 2;        // leaving before this counts as a skip
const SCHOOL_LEVELS = new Set(['middle-school', 'high-school']);

const COUNTRIES = ['Ghana', 'Nigeria', 'Kenya', 'South Africa', 'Uganda', 'Tanzania', 'Rwanda', 'Ethiopia', 'Egypt', 'Morocco', 'Cameroon', "Côte d'Ivoire", 'Senegal', 'Zambia', 'Zimbabwe', 'Botswana', 'Malawi', 'United States', 'Canada', 'United Kingdom', 'Ireland', 'Germany', 'France', 'Spain', 'Italy', 'Netherlands', 'Sweden', 'Poland', 'Turkey', 'India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal', 'China', 'Japan', 'South Korea', 'Singapore', 'Malaysia', 'Indonesia', 'Philippines', 'Vietnam', 'Thailand', 'Australia', 'New Zealand', 'Brazil', 'Mexico', 'Argentina', 'Colombia', 'Chile', 'Peru', 'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Jamaica', 'Trinidad and Tobago'];

let cfg;
const items = [];          // { data, el, player, polling, viewSent, completed, watched, lastTime, answered }
let active = -1;
let loadingMore = false;
let userPaused = false;
let view = 'feed';

// ---------------------------------------------------------------- utilities
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

/** The server no longer knows this browser (e.g. storage was reset): set up again. */
let recovering = false;
function sessionLost() {
  if (recovering) return;
  recovering = true;
  toast('Your session expired. Let\'s set up your feed again.');
  setTimeout(() => location.replace(location.pathname), 1200);
}
const sendEvent = (videoId, type, extra = {}) => api('POST', '/api/events', { videoId, type, ...extra }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v; // CSSOM, allowed by the page's CSP (style attributes are not)
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
};
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ================================================================= onboarding
const ob = { level: null, profile: {}, interests: new Set(), programs: [], selected: new Set() };

function showStep(n) {
  $$('#onboard .step').forEach((s) => { s.hidden = s.dataset.step !== String(n); });
  $$('#onboard .stepper li').forEach((li) => li.classList.toggle('on', Number(li.dataset.step) <= n));
  $('#onboard').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

function renderLevels() {
  const box = $('#levels');
  box.replaceChildren(...cfg.levels.map((l) => el('button', {
    type: 'button', class: 'level', role: 'radio', 'aria-checked': String(ob.level === l.id),
    onclick: () => chooseLevel(l.id),
  }, el('span', { class: 'emoji', 'aria-hidden': 'true' }, l.emoji), el('span', { class: 'label' }, l.label))));
}

function renderTopics() {
  $('#topics').replaceChildren(...cfg.topics.map((t) => {
    const b = el('button', { type: 'button', class: 'topic', 'aria-pressed': String(ob.interests.has(t.id)) },
      el('span', { class: 'emoji', 'aria-hidden': 'true' }, t.emoji), el('span', { class: 'label' }, t.label));
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
  $('[data-label-program]').textContent = school ? 'Subjects' : 'Course / program';
  form.program.placeholder = school ? 'e.g. Biology, Chemistry, Core Mathematics' : id === 'professional' ? 'e.g. ACCA, CFA Level 1, Nursing licensure' : 'e.g. BSc Computer Science';
  try {
    const { programs } = await api('GET', `/api/catalog?level=${encodeURIComponent(id)}`);
    $('#programs').replaceChildren(...programs.map((p) => el('option', { value: p.name })));
  } catch { /* suggestions are optional */ }
  showStep(2);
  (id === 'lifelong' ? form.country : form.institution).focus();
}

function updateStart() {
  $('#start').disabled = ob.selected.size === 0 && ob.interests.size === 0;
}

function programBlock(program, part) {
  const box = el('div', { class: 'program' });
  const render = (p) => {
    box.replaceChildren();
    if (p?.status === 'loading') {
      box.append(el('div', { class: 'researching' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('strong', {}, `Looking up ${part || ob.profile.institution}…`)));
      return;
    }
    if (!p) {
      box.append(el('p', { class: 'muted' }, `We couldn't find "${part || ob.profile.institution}". Pick some interests below, or edit your course.`));
      return;
    }
    if (p.status === 'researching') {
      box.append(el('div', { class: 'researching' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }),
        el('div', {}, el('strong', {}, `Researching ${p.institution || p.name}…`), el('p', { class: 'muted' }, 'Looking up the official course list or syllabus. This can take up to a minute.'))));
      return;
    }
    if (p.status === 'failed') {
      if (p.fallback) { render({ ...p.fallback, note: 'Research did not finish, so here are the core units instead.' }); return; }
      box.append(el('p', { class: 'muted' }, `Research didn't work for "${part}" (${p.error || 'unknown error'}). Pick interests below, or try a simpler course name.`));
      return;
    }
    const head = el('div', { class: 'program-head' },
      el('div', {}, el('h3', {}, p.name), el('p', { class: 'muted' }, p.note || p.basis || '')),
      el('button', { type: 'button', class: 'ghost small', onclick: () => {
        const on = !p.units.every((u) => ob.selected.has(u.id));
        p.units.forEach((u) => (on ? ob.selected.add(u.id) : ob.selected.delete(u.id)));
        render(p); updateStart();
      } }, 'All / none'));
    box.append(head);
    const list = el('div', { class: 'unit-list' });
    for (const u of p.units) {
      const b = el('button', { type: 'button', class: 'unit', 'aria-pressed': String(ob.selected.has(u.id)) },
        el('strong', {}, u.title), u.summary ? el('span', {}, u.summary) : null);
      b.onclick = () => {
        ob.selected.has(u.id) ? ob.selected.delete(u.id) : ob.selected.add(u.id);
        b.setAttribute('aria-pressed', String(ob.selected.has(u.id)));
        updateStart();
      };
      list.append(b);
    }
    box.append(list);
    if (p.sources?.length) {
      box.append(el('p', { class: 'sources' }, 'Sources: ', ...p.sources.slice(0, 4).flatMap((s, i) => [i ? ' · ' : '', el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title.slice(0, 50))])));
    }
    if (p.source === 'catalog' && cfg.research && ob.profile.institution) {
      box.append(el('button', { type: 'button', class: 'link', onclick: () => resolvePart(part, block, true) }, `Tailor this to ${ob.profile.institution}'s actual course →`));
    }
  };
  const block = { box, render };
  render(program);
  return block;
}

async function resolvePart(part, existing, tailor = false) {
  const block = existing || programBlock({ status: 'loading' }, part);
  if (!existing) $('#syllabus .programs').append(block.box);
  else block.render({ status: 'loading' });
  // Forget the units of a previous answer for this part (e.g. before tailoring).
  const previous = ob.programs.find((p) => p.part === part);
  if (previous) { previous.program.units.forEach((u) => ob.selected.delete(u.id)); ob.programs = ob.programs.filter((p) => p !== previous); }
  try {
    const profile = { ...ob.profile, level: ob.level, program: part };
    let { program, researchUnavailable } = await api('POST', '/api/programs/resolve', { profile, tailor });
    if (researchUnavailable && !program) toast('Researching courses needs the Anthropic key on the server.');
    while (program?.status === 'researching') {
      block.render(program);
      await sleep(3000);
      program = (await api('GET', `/api/programs/${encodeURIComponent(program.key)}`)).program;
    }
    let shown = program;
    if (program?.status === 'failed' && program.fallback) shown = { ...program.fallback, note: 'Research did not finish, so here are the core units instead.' };
    if (shown?.units?.length && shown.status !== 'failed') {
      ob.programs.push({ part, program: shown });
      for (const u of shown.units) ob.selected.add(u.id);
    }
    block.render(shown);
  } catch (err) {
    block.render(null);
    toast(`Could not look up "${part}": ${err.message}`);
  }
  updateStart();
}

async function buildSyllabus() {
  const box = $('#syllabus');
  ob.programs = [];
  ob.selected = new Set();
  const parts = !ob.profile.program ? (ob.profile.institution ? [''] : [])
    : SCHOOL_LEVELS.has(ob.level) ? ob.profile.program.split(/\s*(?:,|;|\band\b|&)\s*/i).filter(Boolean).slice(0, 6) : [ob.profile.program];
  box.replaceChildren(
    el('p', { class: 'tagline' }, parts.length ? 'Your syllabus. Untick anything you have already mastered: the feed follows what stays ticked, in order.' : 'Pick what you want to learn about.'),
    el('div', { class: 'programs' }),
  );
  if (!parts.length && !ob.interests.size) cfg.topics.slice(0, 4).forEach((t) => ob.interests.add(t.id));
  updateStart();
  await Promise.all(parts.map((p) => resolvePart(p)));
  if (!ob.selected.size && !ob.interests.size) cfg.topics.slice(0, 4).forEach((t) => ob.interests.add(t.id));
  renderTopics();
  updateStart();
}

async function runOnboarding(prefill) {
  if (prefill) {
    ob.level = prefill.profile?.level || null;
    ob.profile = { ...prefill.profile };
    ob.interests = new Set(prefill.interests || []);
    const form = $('#details');
    for (const k of ['country', 'institution', 'program', 'exam']) form[k].value = prefill.profile?.[k] || '';
  }
  renderLevels();
  renderTopics();
  $('#onboard').hidden = false;
  $('#app').hidden = true;
  showStep(1);
  $('#countries').replaceChildren(...COUNTRIES.map((c) => el('option', { value: c })));

  $$('#onboard [data-back]').forEach((b) => { b.onclick = () => showStep(Math.max(1, Number(b.closest('.step').dataset.step) - 1)); });
  $('#details').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    ob.profile = { level: ob.level, country: f.country.value.trim(), institution: f.institution.value.trim(), program: f.program.value.trim(), exam: f.exam.value.trim() };
    if (ob.level === 'lifelong') ob.profile.institution = ob.profile.program = ob.profile.exam = '';
    showStep(3);
    buildSyllabus();
  };

  await new Promise((resolve) => { $('#start').onclick = resolve; });
  const units = ob.programs.flatMap((p) => p.program.units.map((u) => u.id)).filter((id) => ob.selected.has(id));
  await api('POST', '/api/profile', {
    profile: { ...ob.profile, level: ob.level },
    programKeys: ob.programs.map((p) => p.program.key),
    units, interests: [...ob.interests],
  });
  $('#onboard').hidden = true;
  $('#app').hidden = false;
}

// ================================================================= feed
function addSlide(data, { at } = {}) {
  const node = $('#slide-tpl').content.firstElementChild.cloneNode(true);
  const item = { data, el: node, player: null, polling: false, viewSent: false, completed: false, watched: 0, lastTime: 0, answered: false };
  if (at == null || at >= items.length) {
    items.push(item);
    $('#feed').appendChild(node);
  } else {
    items.splice(at, 0, item);
    $('#feed').insertBefore(node, items[at + 1].el);
  }
  items.forEach((it, i) => { it.el.dataset.index = String(i); });
  render(item);

  $('.tap', node).onclick = () => togglePause(item);
  $('.like', node).onclick = () => toggle(item, 'liked', 'like', 'unlike');
  $('.save', node).onclick = () => toggle(item, 'saved', 'save', 'unsave');
  $('.less', node).onclick = () => {
    sendEvent(item.data.id, 'less');
    toast(`Got it: less of ${item.data.unit?.title || item.data.topic.label}`);
    scrollToIndex(items.indexOf(item) + 1);
  };
  $('.replay', node).onclick = () => { if (item.player) { item.player.seek(0); item.player.play(); userPaused = false; setPaused(item, false); } };

  observer.observe(node);
  if (data.status === 'generating') poll(item);
  return item;
}

function render(item) {
  const { data, el: node } = item;
  node.style.setProperty('--accent', data.topic.accent);
  $('.cover-topic', node).textContent = `${data.topic.emoji} ${data.unit?.title || data.topic.label}`;
  $('.cover-hook', node).textContent = data.hook || 'Writing your lesson…';
  $('.chip', node).textContent = `${data.topic.emoji} ${data.unit?.title || data.topic.label}${data.subtopic ? ` · ${data.subtopic}` : ''}`;
  $('.title', node).textContent = data.title || '';
  $('.like .count', node).textContent = String(data.likes || 0);
  $('.like', node).setAttribute('aria-pressed', String(!!data.liked));
  $('.save', node).setAttribute('aria-pressed', String(!!data.saved));
  $('.save .count', node).textContent = data.saved ? 'Saved' : 'Save';
  const credits = [...new Set((data.credits || []).map((c) => c.by).filter(Boolean))];
  $('.credits', node).textContent = credits.length ? `Footage & music: ${credits.slice(0, 3).join(', ')} (stock)` : '';
  const poster = $('.poster', node);
  if (data.poster && poster.getAttribute('src') !== data.poster) poster.src = data.poster;
  node.dataset.status = data.status;
  $('.status-text', node).textContent =
    data.status === 'failed' ? 'This one did not work out. Swipe for the next.' :
    data.status === 'ready' ? 'Loading player…' : (data.title ? 'Adding visuals and voice…' : 'Writing your lesson…');
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
      item.data = { ...fresh, why: item.data.why };
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
      if (items[active] === item && !userPaused && view === 'feed') item.player.play();
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
  updateQuiz(item, time);

  // Loop at the end, TikTok-style, and count a completion once.
  if (duration && time >= duration - 0.15 && isActive) {
    if (!item.completed) { item.completed = true; sendEvent(item.data.id, 'complete'); }
    item.lastTime = 0;
    item.player.seek(0);
    if (!userPaused) item.player.play();
  }
  if (!isActive && playing) item.player.pause();
}

function syncPlayers() {
  items.forEach((item, i) => {
    const near = active >= 0 && Math.abs(i - active) <= PLAYER_WINDOW;
    if (near) mountPlayer(item); else unmountPlayer(item);
    if (item.player) {
      if (i === active && !userPaused && view === 'feed') item.player.play();
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

function toggle(item, field, onType, offType) {
  const on = !item.data[field];
  item.data[field] = on;
  if (field === 'liked') item.data.likes = Math.max(0, (item.data.likes || 0) + (on ? 1 : -1));
  render(item);
  sendEvent(item.data.id, on ? onType : offType);
  if (field === 'saved' && on) toast('Saved to your Library for revision');
}

// ---------------------------------------------------------------- tap-to-answer quiz
function updateQuiz(item, time) {
  const q = item.data.quiz;
  const box = $('.quiz', item.el);
  if (!q || q.from == null || q.reveal == null) { box.hidden = true; return; }
  const open = time >= q.from && time < q.reveal + (item.answered ? 2.5 : 0);
  if (open && box.hidden) {
    box.hidden = false;
    if (!$('.quiz-options', box).childElementCount) {
      $('.quiz-options', box).replaceChildren(...q.options.map((opt, i) =>
        el('button', { type: 'button', class: 'quiz-opt', onclick: () => answer(item, i) }, el('b', {}, 'ABC'[i]), ` ${opt}`)));
    }
  }
  if (!open && !box.hidden) box.hidden = true;
  if (time < q.from - 0.5 && item.answered) {
    // Looping back: allow seeing the options again, but keep the first answer.
    $$('.quiz-opt', box).forEach((b) => b.disabled = true);
  }
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
  sendEvent(item.data.id, 'quiz_answer', { correct });
}

// ---------------------------------------------------------------- activation & paging
function activate(index) {
  if (index === active) return;
  const prev = items[active];
  if (prev) {
    if (!prev.completed && prev.watched < SKIP_SEC && prev.data.status === 'ready') sendEvent(prev.data.id, 'skip');
    if (prev.watched > 0) sendEvent(prev.data.id, 'leave', { watchedSec: Math.round(prev.watched) });
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
  history.replaceState(null, '', `#v=${item.data.id}`);

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
    next.filter((d) => !items.some((it) => it.data.id === d.id)).forEach((d) => addSlide(d));
    syncPlayers();
  } catch (err) {
    if (err.status === 401) return;
    toast('Could not load more videos. Retrying…');
    setTimeout(() => loadMore(count), 4000);
  } finally {
    loadingMore = false;
  }
}

const observer = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) activate(Number(e.target.dataset.index));
}, { root: null, threshold: [0.6] });

function scrollToIndex(i, smooth = true) {
  const node = items[i]?.el;
  if (node) node.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

/** Opens a specific video (from the Library or a shared link) right after the current one. */
async function openVideo(id) {
  const existing = items.findIndex((it) => it.data.id === id);
  if (existing >= 0) { showView('feed'); scrollToIndex(existing); return; }
  try {
    const { item } = await api('GET', `/api/videos/${id}`);
    const at = active < 0 ? 0 : active + 1;
    addSlide(item, { at });
    showView('feed');
    requestAnimationFrame(() => scrollToIndex(at, active >= 0));
  } catch {
    toast('That video is no longer available.');
  }
}

// ================================================================= library
async function showLibrary() {
  const lib = await api('GET', '/api/library');
  const p = lib.profile || {};
  const level = cfg.levels.find((l) => l.id === p.level);
  $('#lib-profile').replaceChildren(
    el('div', {}, el('strong', {}, [p.program, p.institution].filter(Boolean).join(' · ') || 'Exploring interests'),
      el('p', { class: 'muted' }, [level?.label, p.country, p.exam && `Preparing for ${p.exam}`].filter(Boolean).join(' · '))),
    ...lib.programs.map((pr) => el('p', { class: 'muted small' }, `${pr.name}: ${pr.basis || ''}`)),
    el('button', { type: 'button', class: 'ghost small', onclick: editProfile }, 'Edit'),
  );
  $('#lib-units').replaceChildren(...(lib.units.length ? lib.units.map((u) => el('div', { class: 'unit-row' },
    el('div', { class: 'unit-name' }, u.title, u.dueForReview ? el('span', { class: 'due' }, 'review due') : null),
    el('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(u.mastery * 100)), 'aria-label': `${u.title} mastery` },
      el('i', { style: `width:${Math.round(u.mastery * 100)}%` })),
    el('span', { class: 'muted small' }, `${Math.round(u.mastery * 100)}%`),
  )) : [el('p', { class: 'muted' }, 'No course units yet. Use Edit to add your course or subjects.')]));
  const card = (v) => el('button', { type: 'button', class: 'vcard', onclick: () => openVideo(v.id) },
    v.poster ? el('img', { src: v.poster, alt: '', loading: 'lazy' }) : el('div', { class: 'ph' }),
    el('span', {}, v.title || 'Untitled'), el('small', {}, v.unit || ''));
  $('#lib-saved').replaceChildren(...(lib.saved.length ? lib.saved.map(card) : [el('p', { class: 'muted' }, 'Tap the bookmark on any video to save it for revision.')]));
  $('#lib-history').replaceChildren(...(lib.history.length ? lib.history.slice(0, 24).map(card) : [el('p', { class: 'muted' }, 'Nothing watched yet.')]));
}

function showView(next) {
  view = next;
  $$('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.view === next ? 'page' : 'false'));
  $('#feed').hidden = next !== 'feed';
  $('#library').hidden = next !== 'library';
  if (next === 'library') { items[active]?.player?.pause(); showLibrary().catch(() => toast('Could not load your library.')); }
  else syncPlayers();
}

async function editProfile() {
  items[active]?.player?.pause();
  const user = await api('GET', '/api/me').then((r) => r.user, (err) => { if (err.status === 401) sessionLost(); throw err; });
  await runOnboarding(user);
  toast('Saved. New videos will follow your updated course.');
  // Start a fresh feed that reflects the new choices.
  items.splice(0).forEach((it) => { it.player?.destroy(); it.el.remove(); });
  active = -1;
  showView('feed');
  await loadMore(3);
}

// ================================================================= boot
function wireGlobal() {
  document.addEventListener('keydown', (e) => {
    if ($('#app').hidden || view !== 'feed' || e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); scrollToIndex(active + 1); }
    if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); scrollToIndex(Math.max(0, active - 1)); }
    if (e.key === ' ') { e.preventDefault(); if (items[active]) togglePause(items[active]); }
  });
  document.addEventListener('visibilitychange', () => {
    const item = items[active];
    if (!item?.player) return;
    if (document.hidden) item.player.pause(); else if (!userPaused && view === 'feed') item.player.play();
  });
  $$('.tab').forEach((t) => { t.onclick = () => showView(t.dataset.view); });
  $('#edit-profile').onclick = editProfile;
}

async function boot() {
  cfg = await api('GET', '/api/config');
  wireGlobal();
  const linked = /#v=([0-9a-f-]{36})/.exec(location.hash)?.[1];

  let onboarded = false;
  try {
    await api('GET', '/api/me');
  } catch (err) {
    if (err.status !== 401) throw err;
    await runOnboarding();
    onboarded = true;
  }
  $('#onboard').hidden = true;
  $('#app').hidden = false;

  // Browsers allow sound only after a tap on the page; onboarding already gave us one.
  if (!onboarded) {
    $('#sound-gate').hidden = false;
    await new Promise((r) => { $('#sound-go').onclick = r; });
    $('#sound-gate').hidden = true;
  }
  if (linked) await openVideo(linked);
  await loadMore(3);
}

boot().catch((err) => {
  console.error(err);
  toast('StudyTok could not start. Is the server running?');
});
