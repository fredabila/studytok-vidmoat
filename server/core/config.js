// Central configuration, read once from the environment.
// Copy .env.example to .env and fill in VIDMOAT_API_KEY (server-only, never sent to the browser).

const bool = (v, d = false) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',
  // Local file storage (used only when Upstash Redis is not configured). Vercel's filesystem is
  // read-only apart from /tmp, and /tmp is not shared or kept: connect Upstash in production.
  dataDir: process.env.STUDYTOK_DATA_DIR || (process.env.VERCEL ? '/tmp/studytok/' : new URL('../../data/', import.meta.url).pathname),

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

  // Sign in with Vidmoat (identity only: scope account.read, never credits).
  oauth: {
    // On by default: without client credentials StudyTok registers its own client with Vidmoat
    // (dynamic client registration). Set STUDYTOK_VIDMOAT_SIGNIN=false to hide sign-in.
    enabled: bool(process.env.STUDYTOK_VIDMOAT_SIGNIN, true),
    // Sign-in is the only way in (guests cannot set up a feed). Set STUDYTOK_REQUIRE_SIGNIN=false
    // to allow guest profiles again, e.g. for local development without a Vidmoat account.
    required: bool(process.env.STUDYTOK_REQUIRE_SIGNIN, true),
    clientName: process.env.STUDYTOK_OAUTH_CLIENT_NAME || 'StudyTok',
    clientId: process.env.VIDMOAT_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.VIDMOAT_OAUTH_CLIENT_SECRET || '',
    publicUrl: (process.env.STUDYTOK_PUBLIC_URL || '').replace(/\/$/, ''),
  },

  // Who pays for videos (server/core/billing.js): a free allowance on StudyTok's key, then the
  // student's own Vidmoat account.
  billing: {
    freeVideos: num(process.env.STUDYTOK_FREE_VIDEOS, 15),
    tokenSecret: process.env.STUDYTOK_TOKEN_SECRET || '',
    billingUrl: process.env.STUDYTOK_VIDMOAT_BILLING_URL || 'https://www.vidmoat.com/pricing',
  },

  anthropic: {
    // When unset, lessons come from the built-in offline bank (server/lessons/bank.js).
    enabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: process.env.STUDYTOK_LESSON_MODEL || 'claude-opus-5-5',
    effort: process.env.STUDYTOK_LESSON_EFFORT || 'low',
    // Researching an institution/course with web search (cached per program).
    researchModel: process.env.STUDYTOK_RESEARCH_MODEL || process.env.STUDYTOK_LESSON_MODEL || 'claude-opus-5-5',
    researchEffort: process.env.STUDYTOK_RESEARCH_EFFORT || 'medium',
    // Episodes written per Claude call for a unit (more = fewer calls, longer first wait).
    episodesPerCall: num(process.env.STUDYTOK_EPISODES_PER_CALL, 3),
  },

  voice: {
    // Narration via Vidmoat POST /v1/ai/speech (up to 1,000 characters per video).
    // 'auto' picks the cheapest provider that is available right now (Grok 8 credits, OpenAI 15)
    // within maxCredits; naming a voice pins its provider, so leave STUDYTOK_VOICE_ID empty
    // with 'auto'. Cartesia (45) is excluded by the default cap.
    enabled: bool(process.env.STUDYTOK_VOICEOVER, true),
    provider: process.env.STUDYTOK_VOICE_PROVIDER || 'auto',
    voiceId: process.env.STUDYTOK_VOICE_ID || '',
    maxCredits: num(process.env.STUDYTOK_VOICE_MAX_CREDITS, 15),
    // OpenAI voices only: how to deliver the narration.
    instructions: process.env.STUDYTOK_VOICE_INSTRUCTIONS || 'A warm, clear teacher explaining to a student: upbeat but calm, natural pace, slight pauses between sentences.',
    // 'exact': transcribe the narration for word timings (5 more credits; precise captions and
    // a clean pause before the quiz answer). 'estimated': free, timings estimated from text.
    timing: process.env.STUDYTOK_VOICE_TIMING === 'estimated' ? 'estimated' : 'exact',
    // Never let narration take the balance below this; videos are made silent instead.
    minCredits: num(process.env.STUDYTOK_MIN_CREDITS, 40),
  },

  generation: {
    // How many videos can be generated at once across all users.
    concurrency: num(process.env.STUDYTOK_GEN_CONCURRENCY, 2),
    // How many ready-or-generating videos to keep ahead of each viewer.
    prefetch: num(process.env.STUDYTOK_PREFETCH, 3),
    // Playback performance (docs/ARCHITECTURE.md, "Playback performance"): the live player decodes
    // every video layer in the viewer's browser, so footage is capped at this many pixels on its
    // long edge (1280 = 720p; 1920 allows 1080p and looks sharper but plays slower on phones).
    footageMax: num(process.env.STUDYTOK_FOOTAGE_MAX, 1280),
    fps: num(process.env.STUDYTOK_FPS, 24),
    // Add a CC0 stock music bed and sound effects under each video.
    music: bool(process.env.STUDYTOK_MUSIC, true),
    sfx: bool(process.env.STUDYTOK_SFX, true),
    // Ready videos to keep queued ahead of each viewer (generated in the background).
    readyAhead: num(process.env.STUDYTOK_READY_AHEAD, 4),
    // Automatic retries for a failed generation.
    retries: num(process.env.STUDYTOK_GEN_RETRIES, 1),
    // Prefer reusing an unseen library video over generating a new one when one exists.
    reuseLibrary: bool(process.env.STUDYTOK_REUSE_LIBRARY, true),
  },
};
