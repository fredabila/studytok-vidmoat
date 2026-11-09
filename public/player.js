// Thin wrapper around Vidmoat's embeddable app player (/embed/player), following the protocol in
// https://developer.vidmoat.com/developer/docs/preview :
//   parent -> player: {channel, type:'hello'|'document'|'play'|'pause'|'seek', ...}
//   player -> parent: {channel, type:'ready'|'loaded'|'state'|'error', ...}
// The player only ever receives the document we send. No API key enters the frame.

const CHANNEL = 'vidmoat.player.v1';

export class VidmoatPlayer {
  /**
   * @param {HTMLElement} host   element the iframe is appended to
   * @param {string} origin      player origin, e.g. https://www.vidmoat.com
   * @param {object} handlers    { onReady, onLoaded, onState({time, playing}), onError(message) }
   */
  constructor(host, origin, handlers = {}) {
    this.origin = origin;
    this.handlers = handlers;
    this.ready = false;
    this.loaded = false;
    this.revision = 0;
    this.pending = null; // document waiting for 'ready'
    this.doc = null;     // the document last sent, for retries
    this.retries = 0;
    this.wantPlay = false;
    this.time = 0;
    this.playing = false;

    const iframe = document.createElement('iframe');
    iframe.src = `${origin}/embed/player?parentOrigin=${encodeURIComponent(location.origin)}`;
    iframe.allow = 'autoplay; fullscreen';
    iframe.title = 'Video';
    iframe.tabIndex = -1;
    this.iframe = iframe;
    host.appendChild(iframe);

    this.onMessage = (event) => {
      // Accept only messages from this exact frame, origin and channel.
      if (event.source !== iframe.contentWindow || event.origin !== origin || event.data?.channel !== CHANNEL) return;
      const m = event.data;
      if (m.type === 'ready') {
        this.ready = true;
        clearInterval(this.hello);
        clearTimeout(this.timeout);
        this.handlers.onReady?.();
        if (this.pending) this.load(this.pending);
      } else if (m.type === 'loaded' && m.revision === this.revision) {
        this.loaded = true;
        this.handlers.onLoaded?.();
        if (this.wantPlay) this.play();
      } else if (m.type === 'state' && Number.isFinite(m.time)) {
        this.time = m.time;
        this.playing = !!m.playing;
        // audioTime: the player's audio clock (vidmoat.player.v1 since Nov 2026); null when no audio is running.
        this.handlers.onState?.({ time: m.time, playing: !!m.playing, audioTime: Number.isFinite(m.audioTime) ? m.audioTime : null });
      } else if (m.type === 'error') {
        const message = String(m.message || 'The player could not load this video.');
        // "The media is taking too long to load": the player waited 15 s for every clip at the
        // current time to have a decoded frame. Phones (iOS especially) can take longer than that
        // while other media is downloading, and the fetched media stays in the frame, so re-sending
        // the document is usually enough. Two tries before giving up.
        if (/taking too long/i.test(message) && this.doc && this.retries < 2) {
          this.retries++;
          this.handlers.onRetry?.(this.retries);
          setTimeout(() => this.load(this.doc, this.time || 0), 800);
          return;
        }
        this.handlers.onError?.(message);
      }
    };
    window.addEventListener('message', this.onMessage);

    // Handshake: once the frame has loaded, keep saying hello until the player answers 'ready'.
    iframe.addEventListener('load', () => {
      if (this.ready) return;
      this.post({ type: 'hello' });
      clearInterval(this.hello);
      this.hello = setInterval(() => this.post({ type: 'hello' }), 800);
    });
    this.timeout = setTimeout(() => { if (!this.ready) this.handlers.onError?.('The player is taking too long to connect.'); }, 25000);
  }

  post(data) {
    this.iframe.contentWindow?.postMessage({ channel: CHANNEL, ...data }, this.origin);
  }

  load(doc, time = 0) {
    this.doc = doc;
    if (!this.ready) { this.pending = doc; return; }
    this.pending = null;
    this.loaded = false;
    this.post({ type: 'document', document: doc, revision: ++this.revision, time });
  }

  play() {
    this.wantPlay = true;
    if (this.loaded) this.post({ type: 'play' });
  }

  pause() {
    this.wantPlay = false;
    if (this.loaded) this.post({ type: 'pause' });
  }

  seek(time) {
    if (this.loaded) this.post({ type: 'seek', time });
  }

  destroy() {
    clearInterval(this.hello);
    clearTimeout(this.timeout);
    window.removeEventListener('message', this.onMessage);
    this.iframe.remove();
  }
}
