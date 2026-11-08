// Public lesson page (/v/:id): fetches the lesson from the public endpoint and plays it in
// Vidmoat's embed player with the same protocol as the app (player.js). Playback starts on the
// viewer's first tap: iOS keeps the player's audio suspended until a gesture, and a tap also
// lets the frame mount under user activation. The quick check holds the video at the question
// like the feed does, without any telemetry: this viewer has no session.
import { VidmoatPlayer } from '/player.js';

const $ = (sel, root = document) => root.querySelector(sel);
const main = $('main.watch');
const stage = $('.stage');
if (main && stage) init();

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v); }
  node.append(...children);
  return node;
}

function init() {
  const id = main.dataset.video;
  const origin = main.dataset.playerOrigin;
  const playBtn = $('.play', stage);
  const note = $('.note', stage);
  const quizBox = $('.quiz', stage);
  const bar = $('.bar', stage);
  const state = { item: null, player: null, wantStart: false, started: false, held: false, answered: false, ended: false, duration: 0 };

  const setState = (s) => { stage.dataset.state = s; };
  const say = (text) => { note.textContent = text || ''; note.hidden = !text; };
  setState('idle');

  // Load the lesson straight away so the first tap only has to mount the player.
  const lesson = fetch(`/api/public/videos/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'This lesson is not available.' : 'Could not load the lesson.'))))
    .then((body) => { state.item = body.item; state.duration = body.item?.duration || 0; return body.item; })
    .catch((err) => { say(err.message); return null; });

  function mount(item) {
    if (state.player) return;
    setState('loading');
    state.player = new VidmoatPlayer($('.player-host', stage), origin, {
      onLoaded: () => { stage.dataset.loaded = 'true'; say(''); state.player.play(); },
      onState: ({ time, playing }) => onState(time, playing),
      onRetry: (n) => say(n === 1 ? 'Slow connection. Loading once more…' : 'Still loading. One more try…'),
      onError: (msg) => { setState('paused'); say(/taking too long|could not load/i.test(msg) ? 'This one is slow to load. Try again in a moment.' : msg); },
    });
    state.player.load(item.document, 0);
  }

  function onState(time, playing) {
    const q = state.item?.quiz;
    const duration = state.duration;
    if (bar) bar.style.transform = `scaleX(${duration ? Math.min(1, time / duration) : 0})`;
    if (!state.held) setState(playing ? 'playing' : state.ended ? 'ended' : 'paused');
    updateQuiz(time);
    // Hold at the end of the question until the viewer answers or skips (never speak the answer first).
    if (q?.hold != null && !state.answered && !state.held && time >= q.hold && time < q.reveal) {
      state.held = true;
      state.player.pause();
      state.player.seek(q.hold);
      quizBox.dataset.held = 'true';
      setState('paused');
      return;
    }
    if (duration && time >= duration - 0.15 && !state.ended) {
      state.ended = true;
      state.player.pause();
      state.player.seek(0);
      setState('ended');
    }
  }

  function updateQuiz(time) {
    const q = state.item?.quiz;
    if (!q || q.from == null || q.reveal == null) { quizBox.hidden = true; return; }
    const open = time >= q.from && time < q.reveal + (state.answered ? 2.5 : 0);
    if (open && quizBox.hidden) {
      quizBox.hidden = false;
      quizBox.dataset.held = 'false';
      if (!$('.quiz-options', quizBox).childElementCount) {
        $('.quiz-options', quizBox).replaceChildren(...q.options.map((opt, i) =>
          el('button', { type: 'button', class: 'quiz-opt', onclick: () => answer(i) }, el('b', {}, 'ABC'[i]), opt)));
        $('.quiz-skip', quizBox).onclick = () => release();
      }
    }
    if (!open && !quizBox.hidden) quizBox.hidden = true;
  }
  function release() {
    state.answered = true;
    const wasHeld = state.held;
    state.held = false;
    quizBox.dataset.held = 'false';
    if (wasHeld) state.player?.play();
  }
  function answer(i) {
    if (state.answered) return;
    state.answered = true;
    const q = state.item.quiz;
    const correct = i === q.answerIndex;
    quizBox.querySelectorAll('.quiz-opt').forEach((b, k) => {
      b.disabled = true;
      b.classList.toggle('right', k === q.answerIndex);
      b.classList.toggle('wrong', k === i && !correct);
    });
    $('.quiz-feedback', quizBox).textContent = correct ? 'Correct! 🎉' : `Not quite: it's ${'ABC'[q.answerIndex]}.`;
    setTimeout(release, 700);
  }

  async function start() {
    if (state.player) {
      // Second tap and on: pause / resume, or replay from the start.
      if (state.held) return;
      if (state.ended) { state.ended = false; state.answered = false; quizBox.hidden = true; state.player.seek(0); state.player.play(); setState('playing'); return; }
      if (state.player.playing) { state.player.pause(); setState('paused'); } else { state.player.play(); setState('playing'); }
      return;
    }
    setState('loading');
    const item = await lesson;
    if (!item?.document) { setState('idle'); return; }
    mount(item);
  }

  playBtn.addEventListener('click', start);
  // Taps on the stage itself (the frame ignores pointer events) toggle playback once started.
  stage.addEventListener('click', (e) => { if (state.player && !e.target.closest('.play, .quiz')) start(); });
}
