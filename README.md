# StudyTok

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
feed request ─► algorithm picks units ─► unseen ready video for that unit+level?  ── yes ─► serve
                (recommend.js)                         │ no
                                                       ▼
   lesson: queued episode, or Claude writes 3 progressive episodes for the unit (1 call)
   in parallel: narration (Vidmoat speech + word timings) · teaching visuals (SVG diagrams,
   steps, timelines, comparisons, equations, stats) · Commons photos / stock footage ·
   CC0 sound effects · music bed (ducked under the voice)
   -> commands -> POST /v1/projects (1 call) -> GET ?view=document -> Redis -> /embed/player
```

## What a video looks like (25 to 45 seconds)

1. **Hook**: a surprising true line, narrated, with the key phrase in the topic colour.
2. **3 to 4 beats**: a big key term, a **teaching visual** (a labelled diagram, numbered steps,
   a timeline, a comparison table, an equation, a stat counter, or a real photo from Wikimedia
   Commons when seeing the real thing teaches), and word-by-word captions synced to the voice.
3. **Quick check**: the question is read out, then a 3-second think pause with a ticking clock.
   Viewers can **tap their answer** in the app.
4. **Reveal**: a ding, the correct option lights up, and the narrator explains why.
5. **Remember**: the one-line takeaway. Then it loops.

Sound: the narration (Vidmoat speech: the cheapest available voice), whooshes on section changes, a pop on each key
term, a clock under the think pause, a ding on the answer, and a CC0 music bed ducked under the voice.

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
* **Sign in with Vidmoat** (optional): identity only. StudyTok requests just the read-only
  `account.read` scope, reads the account's name and email once and discards the tokens, so it
  can never spend a student's Vidmoat credits. Signing in links the current profile to the
  Vidmoat account; signing in on another device restores it. Without sign-in, StudyTok works
  as a guest with a one-year cookie.

## The algorithm (`server/recommend.js`)

Every feed slot scores each of the student's units (course units plus optional interest topics):

| Signal | What it does |
| --- | --- |
| **Affinity** | Thompson sample from Beta(completes + 2·likes + correct answers + 1, skips + 3·"less" + ½·wrong + 1): units the student engages with come up more, uncertain ones still get explored. |
| **Progress** | The syllabus frontier: in each course, the first units not yet learned get a boost that decays along the course order, so the feed walks the syllabus. |
| **Review** | Spaced repetition (Leitner boxes): a unit is due again 1, 3, 7 or 21 days after a correct answer, and 20 minutes after a wrong one. |
| **Recency** | Just-served units are pushed back to keep the feed varied. |
| **Less** | "Show me less" multiplies a unit down (×0.35 each time). |

Plus 10% exploration. Within a unit, videos are chosen by a smoothed quality score from everyone's
completions, likes, saves and quiz answers. Mastery per unit (shown in the Library) combines quiz
accuracy and completions.

## Speed

* **Library first**: an unseen ready video for the unit and level is served instantly. Videos are
  shared by everyone on the same unit and level (and exam).
* **Episode queue**: one Claude call writes 3 episodes for a unit; the next two videos skip the
  Claude step.
* **Generate ahead**: each feed request also starts the units likely to come next
  (`STUDYTOK_READY_AHEAD`, default 3 per viewer).
* **Caches**: stock imports, the sound-effects kit and a music pool are imported once and reused.
* **Cron**: `/api/cron/topup` (daily on Vercel) keeps the most-watched units stocked.
* `npm run warm -- 1 cat:hs-biology --level=high-school --exam=WASSCE` pre-generates a course.

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

## Files

| File | What it does |
| --- | --- |
| `server/levels.js`, `server/catalog.js` | Study levels, and built-in programs (high-school subjects, university programs) with ordered units. |
| `server/research.js`, `server/curriculum.js` | Web-search research of an institution's course into units (cached and shared), catalog matching, unit lookup. |
| `server/lessons/` | Lesson schema (beats with visual specs), Claude episode writer (structured output), episode queue with a lock, offline bank. |
| `server/visuals.js` | Teaching-visual templates (HTML/CSS/inline SVG via `addHtmlElement`, stat counters) and the SVG sanitizer. |
| `server/voice.js` | Narration script, Vidmoat speech + transcription, section alignment to pauses, credit floor. |
| `server/sfx.js`, `server/media.js` | CC0 sound kit; stock/Commons media ranking, import cache, music pool. |
| `server/compose.js` | Lesson + media + voice → Vidmoat commands (audio-driven timeline, think pause, captions, quiz, sfx, ducked music). |
| `server/recommend.js`, `server/feed.js` | The algorithm; profiles, feed pages, generate-ahead, events → progress, library, cron top-up. |
| `server/generator.js` | The build pipeline with retries. |
| `server/kv.js`, `server/db.js` | Upstash Redis (or a local file with the same commands) and the data model. |
| `server/auth.js` | Sign in with Vidmoat: self-registered OAuth client, code + PKCE, `account.read` only, no stored tokens. |
| `server/app.js`, `api/index.js`, `server/index.js` | The API, the Vercel Function, the local server. |
| `public/` | Onboarding, the paging feed with live players and tap-to-answer quizzes, Library, Profile; `sw.js` + `manifest.webmanifest` + `icons/` for the PWA. |

## Notes

* **Embedding origin**: the player requires `parentOrigin` to be https (http only on localhost).
* **Vidmoat projects**: each video is a real project on your account, so you can open it in the
  editor. `VIDMOAT_DELETE_PROJECTS=true` deletes them once the document is stored.
* **Sound**: browsers allow sound only after a tap; onboarding counts as one, and returning
  viewers get a single "Tap to start" screen.
