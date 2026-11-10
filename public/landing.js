// The landing page's moving parts: the phone that swipes through sample lessons, the format ticker,
// reveal-on-scroll, count-ups, the two-city quote and the quiz a visitor can actually answer.
// Everything stops for prefers-reduced-motion and while the tab is hidden.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function card(f, s) {
  const c = el('article', 'lpc');
  c.dataset.f = f.id;
  c.style.setProperty('--accent', s.accent);
  const hook = el('div', 'lpc-hook');
  hook.innerHTML = `<span>${s.hook}</span>`; // trusted static copy from app.js (SAMPLE_HOOKS)
  const body = el('div', 'lpc-card');
  body.append(el('b', null, s.card[0]), document.createTextNode(s.card[1] || ''));
  const foot = el('div', 'lpc-foot');
  foot.append(el('span', null, f.name), el('span', null, '0:38'));
  c.append(el('span', 'lpc-chip', `${s.topic} · ${f.tag}`), hook, ...(s.stamp ? [el('span', 'lpc-stamp', s.stamp)] : []), body, foot);
  return c;
}

/** The phone: one sample lesson per "swipe", looping. */
function phone(root, formats, hooks) {
  const track = root.querySelector('#lp-track');
  const list = formats.filter((f) => hooks[f.id]).slice(0, 8);
  if (!track || !list.length) return;
  track.replaceChildren(...list.map((f) => card(f, hooks[f.id])), card(list[0], hooks[list[0].id])); // a copy of the first closes the loop
  if (reduce) return;
  const bar = root.querySelector('.lp-bar i');
  const like = root.querySelector('.lp-like');
  const DWELL = 3000;
  let i = 0;
  const restartBar = () => { if (!bar) return; bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run'); };
  restartBar();
  setInterval(() => {
    if (document.hidden) return;
    i++;
    track.classList.add('move');
    track.style.transform = `translateY(${-i * 100}%)`;
    like?.classList.toggle('on', i % 2 === 1);
    restartBar();
    if (i === list.length) setTimeout(() => { track.classList.remove('move'); track.style.transform = 'translateY(0)'; i = 0; }, 700);
  }, DWELL);
  // A gentle tilt towards the pointer on devices that have one.
  const stage = root.querySelector('.lp-stage');
  const device = root.querySelector('.lp-phone');
  if (stage && device && matchMedia('(hover: hover)').matches) {
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      device.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width) - 0.5) * 14}deg`);
      device.style.setProperty('--rx', `${(0.5 - ((e.clientY - r.top) / r.height)) * 10}deg`);
    });
    stage.addEventListener('pointerleave', () => { device.style.setProperty('--ry', '0deg'); device.style.setProperty('--rx', '0deg'); });
  }
}

function ticker(root, formats) {
  const names = formats.map((f) => f.name);
  const half = Math.ceil(names.length / 2);
  for (const [id, part] of [['#lp-row-a', names.slice(0, half)], ['#lp-row-b', names.slice(half)]]) {
    const row = root.querySelector(id);
    if (!row || !part.length) continue;
    const strip = el('div', 'lp-strip');
    for (const n of [...part, ...part]) strip.append(el('span', null, n)); // twice: the loop is seamless at -50%
    row.replaceChildren(strip);
  }
}

function countUp(node) {
  const to = Number(node.dataset.count);
  if (!Number.isFinite(to) || reduce) return;
  const t0 = performance.now(), ms = 900;
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    node.textContent = String(Math.round(to * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  node.textContent = '0';
  requestAnimationFrame(tick);
}

function reveals(root) {
  const items = [...root.querySelectorAll('[data-reveal]')];
  if (reduce || !('IntersectionObserver' in window)) { items.forEach((n) => n.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      e.target.querySelectorAll('[data-count]').forEach(countUp);
      io.unobserve(e.target);
    }
  }, { root, threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
  // Tiles in a row arrive one after another.
  items.forEach((n, k) => { n.style.setProperty('--d', `${(k % 3) * 70}ms`); io.observe(n); });
}

function quiz(root) {
  const box = root.querySelector('#lp-quiz');
  if (!box) return;
  const note = box.querySelector('small');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const right = b.dataset.k === '1';
    box.querySelectorAll('button').forEach((x) => { x.disabled = true; x.classList.toggle('ok', x.dataset.k === '1'); x.classList.toggle('bad', x === b && !right); });
    note.textContent = right ? 'Correct. Every push has an equal push back.' : 'Not quite: it pushes back just as hard. In the app, this one would come back later.';
    box.classList.add('done');
  }));
}

function quotes(root) {
  const qs = [...root.querySelectorAll('#lp-quotes blockquote')];
  if (qs.length < 2 || reduce) return;
  let i = 0;
  setInterval(() => { if (document.hidden) return; qs[i].classList.remove('on'); i = (i + 1) % qs.length; qs[i].classList.add('on'); }, 3400);
}

export function initLanding(root, formats = [], hooks = {}) {
  if (root.dataset.ready) return;
  root.dataset.ready = '1';
  phone(root, formats, hooks);
  ticker(root, formats);
  reveals(root);
  quiz(root);
  quotes(root);
  const nav = root.querySelector('.lp-nav');
  root.addEventListener('scroll', () => nav?.classList.toggle('stuck', root.scrollTop > 12), { passive: true });
  // In-page links scroll the landing itself (it is the scroller, not the window).
  root.querySelectorAll('.lp-links a').forEach((a) => a.addEventListener('click', (e) => {
    const target = root.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }));
}
