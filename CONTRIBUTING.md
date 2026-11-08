# Contributing to StudyTok

Thanks for helping. StudyTok is a small, dependency-light Node app (no framework, no bundler,
no build step), so most contributions are a single pull request against `main`. This guide
covers how the code is laid out, how to run and test it, and what a good PR looks like.

## Quick start

```bash
git clone https://github.com/fredabila/studytok-vidmoat
cd studytok-vidmoat
npm install
cp .env.example .env         # add VIDMOAT_API_KEY (a free test key works) and, ideally, ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000, restarts on change
npm test                     # ~45 unit tests, no network
```

For local development without a Vidmoat account to sign in with, set `STUDYTOK_REQUIRE_SIGNIN=false`
in `.env`: the app then lets you set up a guest profile straight from the onboarding screen.

Requirements: Node 22.10+ (uses `--env-file-if-exists`, `node:test`, `Array.prototype.findLast`).

## How the code is organised

```
server/
  app.js             the HTTP API (routes, CSP, cookies); api/index.js wraps it for Vercel, server/index.js for local
  core/              config, KV storage (Upstash Redis or a local JSON file), the data model, the Vidmoat and Claude clients, OAuth
  curriculum/        study levels, the built-in program catalog, course research with web search, topics, unit lookup
  lessons/           the lesson schema + sanitiser, the Claude episode writer, the episode queue, the offline bank, format samples
  video/             formats (scenes + skins), the composer (lesson → Vidmoat commands), visuals (HTML cards), narration, media, sfx, the generator
  feed/              ranking (the algorithm, pure functions), the feed (profiles, pages, library), events (ingestion + aggregates)
public/              the PWA: index.html, app.js (one module), telemetry.js, player.js (embed protocol), styles.css, sw.js, icons
scripts/             preview.mjs (build a lesson into a real project and grab frames), warm.mjs (pre-generate a library)
test/                node:test suites: core (schema, composer, visuals, narration), recommend (ranking stage 1), events (ingestion + ranking stage 2), feed, auth
docs/                ARCHITECTURE, FORMATS, EVENTS, ALGORITHM
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first: it walks one request from "swipe" to
"video playing" through those folders.

### Conventions

* **ES modules, modern Node, no transpiling.** Keep the dependency list tiny (today: the
  Anthropic SDK, Upstash Redis, `@vercel/functions`, zod). Prefer `node:` built-ins.
* **Pure where it matters.** `feed/ranking.js`, `video/compose.js`, `video/formats.js` and
  `lessons/schema.js` do no I/O: they take data, return data, and are unit-tested that way.
  Keep them pure; put network calls in the modules that already do them.
* **Comments explain why.** Every module starts with a short header saying what it is for and
  how it fits; functions that encode a product decision say which one.
* **Small, readable diffs.** Two-space indent, single quotes, semicolons, ~120-column lines,
  no reformatting of untouched code.
* **Never spend a user's money by accident.** Anything that calls Vidmoat or Claude must be
  behind an explicit action (a feed request, a cron, a script) and must degrade when it fails
  (a lesson from the offline bank, a silent video, a cached clip).
* **Privacy.** Events carry a StudyTok user id and coarse device context only (see
  [docs/EVENTS.md](docs/EVENTS.md)). Do not add anything that identifies a person or leaves
  the server.

## Common contributions

### Add a video format

1. Add an entry to `FORMATS` in `server/video/formats.js`: `name`, `tag`, `blurb`, `spec` (what
   Claude must fill), `weights` (per topic), `skin` (fonts, captions preset, grade, transition,
   music moods, voice, card theme) and `scenes(lesson)`.
2. If it needs a new on-screen card, add a renderer to `server/video/visuals.js` and a `kind`
   branch in `server/video/compose.js`.
3. If it needs new lesson fields, add them to `LessonSchema` and `sanitizeLesson` in
   `server/lessons/schema.js` (with a fallback when the fields are missing).
4. Add a hand-written sample to `server/lessons/samples.js`, then check it against the real
   API: `npm run preview -- --format=<id>` saves frames to `data/frames/`.
5. `npm test` covers every format automatically (compose, narration, pauses).

Details in [docs/FORMATS.md](docs/FORMATS.md).

### Add a program to the catalog

`server/curriculum/catalog.js`: a program has an `id`, `level`, `name`, `aliases` (what
students type), a `topic` per unit and 6–14 ordered units with a one-line `summary`. Keep the
order pedagogical: the feed walks it.

### Add an event or a ranking signal

Events: add the type to `EVENT_SPECS` in `server/feed/events.js` (validation), fold it into
an aggregate in `ingest()`, emit it from `public/app.js` with `track()`, document it in
[docs/EVENTS.md](docs/EVENTS.md), and test it in `test/events.test.js`.

Ranking: the algorithm is [docs/ALGORITHM.md](docs/ALGORITHM.md) and lives in
`server/feed/ranking.js`. Add a term to `scoreUnits` (which unit) or `scoreVideo` (which
video of that unit), return it in `parts` so the *Why* sheet can explain it, and add a test
that shows it moves the score the way you intend. Please tune with data from `/api/stats`
or the `events:log` list rather than by feel.

### Change the UI

`public/app.js` is one module with sections (onboarding, feed state, slides, players, quiz,
sheets, tune, library, profile, landing, boot). `styles.css` is the "study notebook" design:
paper, ink, a highlighter yellow, Fraunces for headings, Inter for text, JetBrains Mono for
labels. No purple gradients. Test on a phone-sized viewport; the feed is a paging controller,
not native scroll.

## Testing

* `npm test` runs everything in `test/` with `node:test`. Tests use the in-memory KV backend
  and never touch the network; keep it that way (mock `fetch` as `test/auth.test.js` does).
* For anything that changes what a video looks like, run `npm run preview -- <topic>` or
  `npm run preview -- --format=<id>` and look at the frames. Preview frames are free but
  limited to 10 per minute per key; project creation and stock imports are free.
* For feed or UI changes, run the app locally and try the flow on a phone-sized window.
  Playwright works well for scripted checks (Chromium is all you need).

## Pull requests

* Branch from `main`; one topic per PR.
* Title in the imperative ("Add a timeline card to the story format"); the body says what
  changed, why, and how you checked it (tests, preview frames, screenshots).
* `npm test` must pass. If you touched the composer, include a preview frame.
* Update docs that describe what you changed (README, docs/*, `.env.example` for new settings).
* No secrets, no `data/` files, no generated frames in the diff.

## Reporting bugs and proposing features

Use the issue templates. For a bug, include the browser/device, what you expected, what
happened, and (for generation problems) the `/api/health` output and the video id. For a
feature, say which student problem it solves before how.

## Credits and costs

Every generated video costs Vidmoat credits (speech, transcription) and Claude tokens. When
testing generation, use `STUDYTOK_VOICE=false` to skip narration, or `STUDYTOK_READY_AHEAD=0`
to stop prefetching, and keep an eye on `/api/health`.

## Code of conduct

Be kind and constructive; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
