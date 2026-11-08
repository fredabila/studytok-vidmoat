// Central configuration, read once from the environment.
// Copy .env.example to .env and fill in VIDMOAT_API_KEY (server-only, never sent to the browser).

const bool = (v, d = false) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',
  // Local file storage (used only when Upstash Redis is not configured). Vercel's filesystem is
  // read-only apart from /tmp, and /tmp is not shared or kept: connect Upstash in production.
  dataDir: process.env.STUDYTOK_DATA_DIR || (process.env.VERCEL ? '/tmp/studytok/' : new URL('../data/', import.meta.url).pathname),

  vidmoat: {
    apiKey: process.env.VIDMOAT_API_KEY || '',
    baseUrl: (process.env.VIDMOAT_API_BASE || 'https://api.vidmoat.com').replace(/\/$/, ''),
    // Origin of the embeddable app player (/embed/player). The browser talks to it over postMessage.
    playerOrigin: (process.env.VIDMOAT_PLAYER_ORIGIN || 'https://www.vidmoat.com').replace(/\/$/, ''),
    // Delete the Vidmoat project once its document is cached locally. Keeps your project list
    // clean, but you lose the ability to open/render that video in Vidmoat later.
    deleteProjectsAfterCache: bool(process.env.VIDMOAT_DELETE_PROJECTS, false),
    // Optional workspace id to file generated projects into (PUT /v1/projects/{id}/workspace).
    workspaceId: process.env.VIDMOAT_WORKSPACE_ID || '',
  },

  anthropic: {
    // When unset, lessons come from the built-in offline bank (server/lessons/bank.js).
    enabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: process.env.STUDYTOK_LESSON_MODEL || 'claude-opus-5-5',
    effort: process.env.STUDYTOK_LESSON_EFFORT || 'low',
  },

  generation: {
    // How many videos can be generated at once across all users.
    concurrency: num(process.env.STUDYTOK_GEN_CONCURRENCY, 2),
    // How many ready-or-generating videos to keep ahead of each viewer.
    prefetch: num(process.env.STUDYTOK_PREFETCH, 3),
    // Add a CC0 stock music bed under each video.
    music: bool(process.env.STUDYTOK_MUSIC, true),
    // Prefer reusing an unseen library video over generating a new one when one exists.
    reuseLibrary: bool(process.env.STUDYTOK_REUSE_LIBRARY, true),
  },
};
