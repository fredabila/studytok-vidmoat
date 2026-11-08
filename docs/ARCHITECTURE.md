# Architecture

StudyTok is a vertical feed of short study videos that are **written and produced while the
student scrolls** and **played live** in Vidmoat's embed player (no MP4 renders). This page
follows one swipe through the code.

```
browser (public/)                      server (server/)                         outside
───────────────────                    ─────────────────────────────────────    ───────────────────
app.js  ── GET /api/feed ───────────▶  app.js → feed/index.js nextItems()
                                         ├─ feed/ranking.js  pickUnits()        (pure: which unit)
                                         ├─ core/db.js       readyIds()         Upstash Redis / local file
                                         ├─ feed/ranking.js  scoreVideo()       (pure: which video)
                                         └─ video/generator.js startVideo()  ─▶ lessons/index.js nextLesson()
                                                                                  ├─ queue (Redis) or
                                                                                  ├─ lessons/claude.js ──▶ Claude (structured output)
                                                                                  └─ lessons/bank.js (offline)
                                                                                video/voice.js ──▶ Vidmoat speech + transcription
                                                                                video/media.js ──▶ Vidmoat stock search + import
                                                                                video/sfx.js, music pool
                                                                                video/formats.js scenes → video/compose.js commands
                                                                                ──▶ POST /v1/projects, GET ?view=document ──▶ Redis
app.js  ◀── { items: [...document] } ──  feed/index.js publicVideo()
player.js ── postMessage ───────────▶  Vidmoat /embed/player (plays the document)
telemetry.js ── POST /api/events ───▶  feed/events.js ingest() → aggregates (stats, signals, session, progress)
```

## 1. Identity and profile (`core/auth.js`, `feed/index.js`)

Students sign in with Vidmoat (OAuth, PKCE, `account.read` only). The callback links or
restores a StudyTok user (`user:{id}`) and sets a one-year cookie. Onboarding stores a
profile (level, country, institution, program, exam), the chosen course units, interests and
preferences. Sign-in is required by default (`STUDYTOK_REQUIRE_SIGNIN`).

## 2. Curriculum (`curriculum/`)

`catalog.js` has built-in programs with ordered units; `research.js` asks Claude (with web
search) what an institution's course actually covers and caches the result per
institution + program; `index.js` resolves whichever applies and looks units up by id.
Custom topics typed by a student become open-ended units (`cu:<hash>`).

## 3. The feed page (`feed/index.js nextItems`)

1. **Candidates**: the student's course units (in order, grouped per program) plus interest
   topics.
2. **Which unit** (`ranking.js pickUnits`): affinity + syllabus frontier + spaced repetition −
   recency, × "less"; a decaying exploration share.
3. **Which video** (`ranking.js scoreVideo`): among that unit's ready, unseen videos, the one
   with the best quality × taste × diversity × fatigue × difficulty × freshness for this
   student right now (signals and session come from `events.js`).
4. **Ready first**: ready videos are served before anything that still has to be generated;
   missing units are started in the background and a library starter fills the slot.
5. The response carries `why` (the score parts) so the app can explain the pick.

## 4. Making a video (`video/generator.js`)

* `lessons/index.js` returns the next lesson for the unit + audience: a queued episode, else a
  batch from Claude (several episodes per call, in a rotation of **formats**), else the
  offline bank.
* In parallel: narration (`voice.js`), ambient/beat/item media (`media.js`), the sound kit
  (`sfx.js`) and a music bed in the format's mood.
* `formats.js` turns the lesson into **scenes**; `compose.js` plans the timeline against the
  narration (inserting pauses as cuts) and renders each scene with the format's **skin** into
  Vidmoat commands; `visuals.js` holds the HTML cards.
* One `POST /v1/projects` creates the project with all commands; `GET ?view=document`
  fetches the playable document, which is stored in Redis and filed under the unit + level
  (`ready:{key}`) so everyone on that unit can be served it.

## 5. Playing (`public/player.js`)

The document is handed to Vidmoat's `/embed/player` over `postMessage`
(`vidmoat.player.v1`: hello → document → loaded → state). The app mounts players only for
the active slide ±1, holds the video at the quiz until the viewer answers, and loops.

**Sound on iOS.** The player's audio runs through a Web Audio context that iOS keeps suspended
until a user gesture happens *inside the player's own frame*. The app's gesture layer sits over
the frame, so on iOS the first ready slide opens a hole in it ("Tap here for sound"); when the
tap lands in the frame (focus moves into it) the document is re-sent and playback restarts under
that gesture. Once per page load; `sound_unlock` is logged. The cleanest fix lives in the
player itself (resume the AudioContext on any pointer event inside the frame, and on the
`play` message when the frame already has sticky activation); the app-side gate stays as a
safety net.

## 6. Learning from viewers (`public/telemetry.js`, `feed/events.js`)

The app batches fine-grained events (impressions, heartbeats, scene changes, how a video was
left, quiz timing, reactions, settings changes…) to `POST /api/events`. `ingest()` folds them
into per-video and per-format counters, per-unit learning state (Leitner boxes), per-student
tastes (`signals`) and the current `session`, plus a capped raw log. Those feed straight back
into step 3 and into the format rotation of step 4. See [EVENTS.md](EVENTS.md) and
[ALGORITHM.md](ALGORITHM.md).

## Playback performance

The embed player composites the whole document live in the viewer's browser: every video layer
is decoded, every filter is a shader, every HTML card is rasterised. Phones notice. What keeps
it smooth:

* **One live player.** `public/app.js syncPlayers` mounts a player only for the active lesson;
  the next one is mounted (paused, loading) when the viewer passes the halfway point, and the
  previous one is unmounted at once.
* **One decoding video at a time.** `compose.js` cuts the ambient clip out wherever a
  full-bleed clip covers it, and applies the colour grade to the ambient layer only.
* **720p footage by default.** `media.js` picks the Pixabay variant that fits
  `STUDYTOK_FOOTAGE_MAX` (1280 = 720p); images stay full resolution. `STUDYTOK_FPS` (24) sets
  the project frame rate.
* **No blur filters** in HTML cards (`backdrop-filter` is expensive on mobile GPUs).

If a device is still too slow, the remaining lever is rendering popular library videos to MP4
with `POST /v1/projects/{id}/render` and playing the file instead of the document (costs a
render per video and a plan with exports); StudyTok does not do that today.

## The admin sheet (`core/sheet.js`)

An optional mirror of students, joins and daily numbers into a Google Sheet, written by POSTing
rows to a bound Apps Script (`scripts/sheet/Code.gs`). `syncUser()` refreshes a student's row
(throttled to once per ten minutes, immediately on sign-in, profile save and billing changes) and
appends milestones to a Joins tab; `syncDaily()` runs from the cron; `POST /api/admin/sheet/resync`
rebuilds the Users tab from the `users` index. Every call is fire-and-forget through `waitUntil()`
and never fails a request. Off unless `STUDYTOK_SHEET_URL` and `STUDYTOK_SHEET_SECRET` are set.

## Who pays (`core/billing.js`)

Each student's first videos are made on StudyTok's key; then they connect their own Vidmoat
account and the generator runs inside `withCredential(token)`, so the same pipeline makes the
video on their account. Out-of-credit answers from Vidmoat pause that student's generation
and the app sends them to buy credits or upgrade. See [BILLING.md](BILLING.md).

## Storage (`core/kv.js`, `core/db.js`)

A tiny Redis-command interface (`get/set/sadd/zadd/hincrby/lpush…`) backed by Upstash Redis
in production or a JSON file locally (`data/kv.json`; `STUDYTOK_KV_FILE=memory` in tests).
Key families are listed at the top of `core/db.js` and `feed/events.js`.

## Deployment

* **Vercel**: `api/index.js` is one Function serving every `/api/*` route (rewrite in
  `vercel.json`); `public/` is static; `waitUntil` keeps generation running after the
  response; a daily cron tops up popular units.
* **Anywhere else**: `node server/index.js` serves both.

## Costs, roughly

Per new video: ~15 credits of speech + 5 of transcription on Vidmoat, a Claude call per batch
of episodes (shared by everyone on that unit), free stock media and preview frames. Playing
a stored video costs nothing.
