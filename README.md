# StudyTok

**Live at [studytok.vidmoat.com](https://studytok.vidmoat.com)**, a Vidmoat product, open source under the MIT licence.

A TikTok-style vertical feed of short study videos that follows **your actual syllabus**.
Students pick their level (middle school to postgraduate, professional, or just curious), their
country, school and course or subjects, and the exam they are preparing for. StudyTok matches the
course to a built-in catalog, or **researches what that institution teaches** (Claude with web
search), then generates narrated lessons unit by unit as they scroll. Videos are made with the
[Vidmoat API](https://developer.vidmoat.com/developer/docs) and play **live in Vidmoat's embed
player**: nothing is ever exported to MP4.

```
onboarding: level -> country / school / course / exam -> syllabus (catalog match or web research)
                                                           │ cached per course, shared by classmates
feed request ─► algorithm picks units ─► best unseen ready video for that unit+level?  ── yes ─► serve
                (feed/ranking.js)                      │ no
                                                       ▼
   lesson: queued episode, or Claude writes 3 progressive episodes for the unit (1 call)
   in parallel: narration (Vidmoat speech + word timings) · teaching visuals (SVG diagrams,
   steps, timelines, comparisons, equations, stats) · Commons photos / stock footage ·
   CC0 sound effects · music bed (ducked under the voice)
   -> commands -> POST /v1/projects (1 call) -> GET ?view=document -> Redis -> /embed/player
```

## Thirty-two video formats (15 to 50 seconds each)

Every lesson is written in one of thirty-two **formats** (`server/video/formats.js`), each with its own
structure, typography, caption preset, colour grade, transitions, music mood, narrator voice and
card theme, so the feed feels like TikTok rather than one template on repeat:

| Format | What happens on screen |
| --- | --- |
| **Explainer** | Hook, 3-4 beats each with a teaching visual (diagram, steps, timeline, compare, definition, equation, stat, or a real photo), quick check, takeaway. Montserrat, karaoke captions, lo-fi piano. |
| **Myth vs fact** | A belief stamped MYTH, the truth stamped FACT, two reasons why, a myth-or-fact check. Anton, boxed captions, moody grade, glitch cuts, suspense music. |
| **5 things** | Rapid-fire facts with a numbered counter over full-bleed footage, a ticked recap, a check. Bungee, comic captions, whip-pans, upbeat music. |
| **Exam drill** | A real exam-style question on a paper card, a pause to try it, the worked solution step by step, the common mistake, a marks tip. Oswald, calm piano. |
| **Story** | Chapters with datelines and real photos, letterboxed, cinematic grade, serif titles, orchestral music. |
| **Flash drill** | Four question/answer cards with a beat to answer each; paper cards that flip to the accent colour. Handwritten captions, lo-fi beat. |
| **Why?** | One big why, answered as BECAUSE → WHICH MEANS → SO. Archivo Black, teal grade, zoom cuts. |
| **DM thread** | A student texts a tutor; the answer unfolds bubble by bubble. Inter, matte grade, push cuts. |

The second wave adds the hooks short video runs on: **3 levels** (kid → student → expert),
**Spot the mistake** (a worked answer with one wrong step, held while you hunt), **Tier list**,
**This or that**, **POV** ("you are a red blood cell"), **Hot take**, **Countdown** (3 → 1),
**Speedrun** (the unit in 30 s), **Guess first** (the question before any teaching) and
**Would you rather**; and a third wave shaped by the event data: **One thing** (15 s),
**Cheat sheet**, **Predict** (what happens next?), **Analogy**, **Mistakes**, **Timeline** and
**Challenge** (ten seconds). A fourth wave is for tired brains and curious ones: **Like I am
five** (the kid version, then the real one), **Mnemonic** (a memory hook that fills a card),
**In real life** (three places you will meet the idea), **What if** (a counterfactual chain),
**Wait, what?** (one astonishing true fact), **Before and after** and **True or false**. The
writer labels each hook's style and is told which styles hold attention on the topic; it rotates
them and opens a loop in every episode that it closes late. Full table in
[docs/FORMATS.md](docs/FORMATS.md).

**Breathers.** When the events say a student is about to drop off (two early leaves in a row,
three wrong answers, a long session with nothing light), the next slot is a *breather*: one
short, fun, still-accurate video from next door to their subject (animal superpowers for a
biology student, famous bugs for computer science), written in a light format with no exam
framing, then straight back to the syllabus. Never two within six videos, never counted towards
mastery, and switched off for anyone who says "less" to them. See
[docs/ALGORITHM.md](docs/ALGORITHM.md#breathers).

**Moments.** Every so often (never before the fourth lesson of a session, at most one every six
lessons and three a day) the feed shows an animated card from Noti: a tip about the app that fits
where the student is (save a lesson, teach the feed, install it, turn on reminders), a piece of
news, or an offer (free lessons left, invite a classmate). Offers and news can be posted at
runtime without a deploy. See [docs/ALGORITHM.md](docs/ALGORITHM.md#moments).

Claude writes each batch of episodes in a rotation of formats weighted by topic (maths leans on
exam drills, history on stories) and steered away from what the unit used most recently; the
feed also never serves the same format twice in a row. Each video carries a format badge.

**Quick check**: the question and options are read out, then the app **holds the video** until
the viewer taps an answer (or Skip), so the answer is never spoken before they have tried.
Questions must be self-contained and specific; options parallel and plausible.

Sound: the narration (a different Vidmoat/OpenAI voice per format), whooshes on cuts, a pop on
each key term, a clock under think pauses, a ding on the answer, and a CC0 music bed in the
format's mood, ducked under the voice. `npm run preview -- --format=<id>` builds the sample
lesson of any format (`server/lessons/samples.js`) into a real project and saves frames.

## The app

* **Installable (PWA)**: a manifest, maskable icons and a service worker (`public/sw.js`)
  that caches the app shell (never the API), so StudyTok installs to the home screen and opens
  full screen. Profile → *Install StudyTok* (Android/desktop), or Share → *Add to Home Screen*
  on iPhone.
* **Feed controls**: a paging controller, not native scroll-snap. Drag or flick one lesson at
  a time; on desktop one wheel/trackpad gesture moves exactly one lesson (momentum is ignored),
  plus ↑/↓ keys and on-screen buttons. Tap to pause, double-tap to like, tap answers during the
  quick check. Ready videos are moved ahead of ones still being made.
* **Tabs**: For You · Library (course progress rings, saved, history) · Profile (sign-in,
  install, edit studies). Each lesson shows "Unit n of N", and a *Why* sheet explains why the
  algorithm picked it.
* **Landing page**: new visitors see what StudyTok is (sample cards of every format, how it
  works, what's inside), an *Install the app* button and *Continue with Vidmoat*, with a footer
  crediting Vidmoat, a Buzz Innovations Ltd. company, and linking to this repository.
* **Age**: onboarding asks who the profile is for and their age. Vidmoat accounts are for
  adults, so anyone under 18 is set up by a parent or guardian ("My child") on the adult's
  account, with consent recorded; under-13s get their own, gentler lessons (own lesson key, no
  opinion-led formats) and the writer is told the viewer's age for every episode.
* **Credits**: each student's first `STUDYTOK_FREE_VIDEOS` (15) videos are made on your Vidmoat
  key; then they connect their own Vidmoat account (*Use my Vidmoat account*: the same OAuth
  flow with the generation scopes, tokens sealed at rest) and every video they trigger spends
  their credits. When they run out, the app points them to credit packs or a plan upgrade on
  Vidmoat; the shared library keeps playing meanwhile. See [docs/BILLING.md](docs/BILLING.md).
* **Sign in with Vidmoat** (required by default): identity only. StudyTok requests just the
  read-only `account.read` scope, reads the account's name and email once and discards the
  tokens, so it can never spend a student's Vidmoat credits. The account is the student's
  identity across devices. Set `STUDYTOK_REQUIRE_SIGNIN=false` to allow guest profiles again
  (local development without a Vidmoat account).

## Personalization

* **Your own topics**: any topic in the student's own words ("Python decorators", "The Ashanti
  Empire") becomes an open-ended unit Claude writes fresh episodes for. Add them from the
  **Tune** button on any video or from the Library; add them *into* a course, and they join
  that syllabus. Everyone who adds the same topic shares its lessons.
* **Editable courses**: in the Library, tick units off and on, add topics to a course, remove
  your own. Interests can be changed any time.
* **Preferences** (Tune): narration on/off, length (quick 20-30 s / standard / deep 45-60 s),
  visuals (mixed / diagrams only / real footage), difficulty (a step easier or harder than the
  level). Length, visuals and difficulty change the lesson Claude writes; narration changes the
  video. Non-default settings are part of the lesson key, so defaults stay shared and custom
  settings are shared with students who chose the same.

## No waiting

* **Ready-first**: a feed page is filled with ready, unseen videos for the student's likely
  units before anything that still has to be made; the missing units generate in the
  background and appear when ready. A brand-new library falls back to any ready starter for
  the level, labelled "while you wait", with a note saying which lesson is being made.
* **Prefetch at setup**: the first units start generating the moment the profile is saved.
* `STUDYTOK_READY_AHEAD` (default 4) videos are kept generating ahead of each viewer.
* Sharper footage: candidates are ranked by how much they must be scaled up for a 1080x1920
  canvas; Pixabay's 1080p variant is fetched instead of the 720p one; backgrounds fall back to
  high-resolution photos with a slow push-in rather than upscaled 720p video.

## The algorithm (`server/feed/ranking.js`)

Two stages per feed slot, both pure functions with tests; the full write-up is
[docs/ALGORITHM.md](docs/ALGORITHM.md).

**Which unit** = affinity + syllabus progress + spaced-repetition review − recency, × "less":

| Signal | What it does |
| --- | --- |
| **Affinity** | Thompson sample from Beta(completes + 2·likes + correct answers + watch fraction + 1, skips + 3·"less" + ½·wrong + unwatched fraction + 1), shrunk toward neutral until there is evidence. |
| **Progress** | The syllabus frontier: in each course, the first units not yet learned get a boost that decays along the course order, so the feed walks the syllabus. |
| **Review** | Spaced repetition (Leitner boxes): a unit is due again 1, 3, 7 or 21 days after a correct answer, and 20 minutes after a wrong one. |
| **Recency** | Just-served units are pushed back to keep the feed varied. |
| **Less** | "Show me less" multiplies a unit down (×0.35 each time). |

Plus exploration that starts at 0 for a new student and decays from 15% toward 3%.

**Which video** of that unit = quality × taste × diversity × fatigue × difficulty × freshness:
everyone's watch fraction, completions, likes, saves and quiz accuracy on the video
(Bayesian-smoothed); the student's own taste for the format and topic (Thompson sample from
their signals); not the same format twice in a row; lighter formats late in a session; gentler
formats after wrong answers and exam drills on a right streak; a small bonus for new videos.
The *Why* sheet shows the parts.

**Review sessions.** When spaced repetition brings a unit back, the feed serves retrieval
practice (flashcards, true or false, a ten-second challenge, an exam drill) from a separate
review pool written for recall, not another explainer; and the writer is told when a topic's
quick checks are too easy or too hard. **Daily goal**: three lessons a day, shown as a ring on
the Profile and Library, with Noti warning when a streak is about to lapse or units are due.
See [docs/ALGORITHM.md](docs/ALGORITHM.md#review-sessions-retrieval-practice).

## Events

The app reports everything a viewer does, plus coarse device context (with permission, a one-word
posture from the motion sensors: held, lying flat, moving; a drop pauses the video). Per-scene
drop-off, hook-style, voice and music performance feed back into the writer, the narrator choice
and the ranking's context term. The app reports it TikTok-style: impressions, view starts, 5-second
heartbeats, scene changes, pauses, loops, how far each video got and how it was left, quiz
timing and answers, reactions, "less", sheet opens, every preference change, library and
profile use, install prompts, sessions. `server/feed/events.js` folds them into per-video,
per-format, per-unit and per-student aggregates (the ranking's inputs), a per-scene drop-off
curve, daily counts and a capped raw log; `GET /api/stats` publishes anonymous aggregates.
The full taxonomy is [docs/EVENTS.md](docs/EVENTS.md).

## Speed

* **Library first**: an unseen ready video for the unit and level is served instantly. Videos are
  shared by everyone on the same unit and level (and exam).
* **Episode queue**: one Claude call writes 3 episodes for a unit; the next two videos skip the
  Claude step.
* **Generate ahead**: each feed request also starts the units likely to come next
  (`STUDYTOK_READY_AHEAD`, default 3 per viewer).
* **Caches**: stock imports, the sound-effects kit and a music pool are imported once and reused.
* **Cron**: `/api/cron/topup` (daily on Vercel) keeps the most-watched units stocked;
  `/api/cron/remind` sends Web Push reminders (streak at risk, reviews due) to students who
  installed the app and opted in (`docs/ARCHITECTURE.md`, "Reminders"; needs VAPID keys).
* `npm run warm -- 1 cat:hs-biology --level=high-school --exam=WASSCE` pre-generates a course.

## Playback performance

The live player decodes every layer in the browser, so documents are kept light: one live
player at a time (the next preloads at the halfway point), the ambient clip is cut out under
full-bleed footage, grades apply to one layer, footage is capped at 720p
(`STUDYTOK_FOOTAGE_MAX`) while images stay sharp, and projects run at 24 fps (`STUDYTOK_FPS`).
Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#playback-performance).

## Costs per new video

| Item | Cost |
| --- | --- |
| Lesson (Claude, ⅓ of a 3-episode call) | Anthropic API usage |
| Course research (once per course, shared) | Anthropic API usage + web search |
| Narration | 8 (Grok) or 15 (OpenAI) Vidmoat credits: `auto` picks the cheapest available, capped at `STUDYTOK_VOICE_MAX_CREDITS` |
| Exact caption timing | 5 Vidmoat credits (`STUDYTOK_VOICE_TIMING=estimated` skips this) |
| Stock search/import, projects, commands, preview, playback | Free (Vidmoat rate limit) |

Narration is skipped automatically when the Vidmoat balance would drop below
`STUDYTOK_MIN_CREDITS` (default 40); videos are then made with captions, sound effects and music
only. Set `STUDYTOK_VOICEOVER=false` to turn narration off entirely.

## Run it locally

Requires Node.js 22.10+.

```bash
npm install
```

```bash
cp .env.example .env   # set VIDMOAT_API_KEY, and ANTHROPIC_API_KEY for lessons + research
```

```bash
npm start              # http://127.0.0.1:3000
```

Locally, data lives in `data/kv.json`. Set the Upstash variables in `.env` to use Redis instead.
`npm run preview -- <topic> [lessonIndex]` builds one bank lesson as a real project and saves exact
frames to `data/frames/`. Tests:

```bash
npm test
```

## Deploy to Vercel

`public/` is served as static files, and `api/index.js` is one Vercel Function for every `/api/*`
route (`vercel.json`). Generation and research keep running after the response via `waitUntil()`.

1. **Import the repo** at vercel.com/new (framework preset **Other**).
2. **Storage**: Project → **Storage** → **Upstash for Redis** → create and connect. Any variable
   prefix works; `/api/health` shows which variable it found.
3. **Environment variables**: `VIDMOAT_API_KEY` (required), `ANTHROPIC_API_KEY` (recommended),
   `CRON_SECRET` (any random string, for the daily top-up), and any tuning from `.env.example`.
   **Sign in with Vidmoat** needs no setup: on the first sign-in StudyTok registers its own OAuth
   client with Vidmoat (`POST /api/oauth/register`, once per domain) and keeps it in Redis.
4. **Deploy**, then open `/api/health`: `"ok": true`, `"storage": "redis"`, `"lessons": "claude"`.
5. **Optional: a Google Sheet of your students.** StudyTok can mirror every student, every join
   and a daily summary into a spreadsheet you own, written through a tiny Apps Script, so there
   is no database or admin panel to run. Setup in [scripts/sheet/README.md](scripts/sheet/README.md).

## Files

```
server/app.js        the API (api/index.js wraps it for Vercel; server/index.js serves it locally)
server/core/         config, KV (Upstash Redis or a local file), data model, Vidmoat + Claude clients, Sign in with Vidmoat
server/curriculum/   levels, program catalog, course research, topics, unit lookup
server/lessons/      lesson schema + sanitiser, Claude episode writer, episode queue, offline bank, format samples
server/video/        formats (scenes + skins), composer, HTML cards, narration, media, sfx, generator
server/feed/         ranking (the algorithm), feed pages + profiles + library, events
public/              the PWA: app.js, telemetry.js, player.js, styles.css, sw.js, icons
scripts/             preview.mjs (real frames of any lesson or format), warm.mjs
test/                node:test suites (no network)
docs/                ARCHITECTURE · FORMATS · EVENTS · ALGORITHM
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a request walkthrough and
[CONTRIBUTING.md](CONTRIBUTING.md) for how to work on it.

## Notes

* **Embedding origin**: the player requires `parentOrigin` to be https (http only on localhost).
* **Vidmoat projects**: each video is a real project on your account, so you can open it in the
  editor. `VIDMOAT_DELETE_PROJECTS=true` deletes them once the document is stored.
* **Sound**: browsers allow sound only after a tap; onboarding counts as one, and returning
  viewers get a single "Tap to start" screen.

## Help and FAQ

Plain-language answers for students and parents (what StudyTok is, how the feed chooses, quiz holds, credits, installing, privacy and data deletion) are in [docs/FAQ.md](docs/FAQ.md).

## Contributing and license

StudyTok is open source under the [MIT license](LICENSE). Issues and pull requests are
welcome: start with [CONTRIBUTING.md](CONTRIBUTING.md). Built by
[Vidmoat](https://www.vidmoat.com), a Buzz Innovations Ltd. company.
