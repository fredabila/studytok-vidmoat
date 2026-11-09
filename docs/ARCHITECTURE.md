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

## Community packs (`curriculum/packs.js`, `content/`)

`content/<slug>/pack.md` files (format and rules in `content/README.md`) are parsed once at
startup into packs: metadata, 2-12 units (`pack:<slug>:<n>`, each with a summary and facts),
pack-wide facts, a quiz bank and labelled assets (served from the repo on GitHub,
`STUDYTOK_CONTENT_BASE`). Vercel bundles the `.md` files with the function (`includeFiles`).
A student adds a pack from the Library (`PATCH /api/me { addPack }`) or by opening `?pack=<slug>`
(kept on the device until setup is done, then sent with the profile); its units join
`user.units` and `user.packs`, grouped as their own course. `getUnit()` resolves pack units
from memory. The lesson writer gets `packContext()`: the pack's words, facts, the assets by file
name (`visual.query: "asset:<file>"`, which `media.js` imports into Vidmoat like stock) and the
quiz bank. `publicVideo` carries `pack: { title, by, link, cta }` for the credit line and the
*Why* sheet. `scripts/content-check.mjs` validates packs and measures asset files (image
dimensions from the file headers, MP4 duration/size/codecs from the boxes, MP3 duration from
the frames) and runs in CI on pull requests.

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
6. **Recall cards** (`feed/recall.js`): a due missed question takes the second slot
   (`{ kind: 'recall', recall: {...} }`), displacing that page's moment. Exam urgency
   (`ranking.js examUrgency`) and the gentle first page after a lapse are decided here too.
7. **Moments** (`feed/moments.js`): when the pacing allows, a tip, news or offer card takes the
   second slot (`{ kind: 'moment', moment: {...} }` in the same `items` array); the app renders
   it (`addMomentSlide`), no video is involved. Extras come from `POST /api/admin/moments`.

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

**Live document edits.** The player only ever sees the document the app hands it, so the app
edits the lesson before it plays and can re-send it at the current time (`prepareDocument`,
`reloadDocument` in `public/app.js`). No new video is made for any of this:

* *Playback choices* (Tune › Playback, kept on the device): captions (text clips on track 6),
  music (the `music` clip) and narration audio (the `voice*` clips) on or off. Changing one
  re-sends the lesson on screen at the same second.
* *Recall mode* ("fill the gaps"): the server lists the lesson's key terms (`terms` on the
  public video: beat terms, item titles, card answers, the quiz answer) and the app replaces
  them in the on-screen text with blanks and drops the narration, turning any explainer into
  retrieval practice. A chip over the video says so; tapping it re-sends the full document at the
  same time (and shows the terms). Default: on for lessons served for review; also "every
  lesson" or off.
* *Chapters*: scene markers from `scenes` on the progress bar; tapping one seeks there.
* *Answer stamp*: while the video is held at the quick check, the student's answer is added as
  a text clip over the reveal ("You said B ✓ Correct") and the document re-sent from the hold.

Events: `play_pref`, `gaps_on`, `gaps_reveal`, `chapter_seek`, `quiz_stamp`.

**Sound on iOS.** The player's audio runs through a Web Audio context that iOS keeps suspended
until a user gesture happens *inside the player's own frame*. The app's gesture layer sits over
the frame, so on iOS the first ready slide opens a hole in it ("Tap here for sound"); when the
tap lands in the frame (focus moves into it) the document is re-sent and playback restarts under
that gesture. Once per page load; `sound_unlock` is logged. The cleanest fix lives in the
player itself (resume the AudioContext on any pointer event inside the frame, and on the
`play` message when the frame already has sticky activation); the app-side gate stays as a
safety net.

## Public lesson pages (`core/watch.js`, `public/watch.js`)

`GET /v/:id` is the one page that needs no session: anyone with the link sees the lesson, with
Open Graph / Twitter tags (title, hook, poster or the app icon) so the link unfurls in chats.
`vercel.json` rewrites `/v/:id` to the function (`?__path=v/:id`, so it reaches `handleApi` as
`/api/v/:id`); the local server forwards the bare path. The HTML is a template string in
`core/watch.js` (every value escaped: titles come from an LLM), styled by `public/watch.css`
and driven by `public/watch.js`, which fetches `GET /api/public/videos/:id` (a `publicVideo()`
twin without viewer fields, `status === 'ready'` only) and plays the document through the same
`player.js` wrapper as the app. Playback starts on the first tap (iOS audio) and the quick check
holds the video like the feed does, without telemetry. Anything not ready is a branded 404.
Each page view bumps `events:day:<date>.share_page_view` (the Daily tab's "Shared lesson
views") and the video's `shareViews` stat. `?ref=<memberNo>` is carried into the call to
action (`/?ref=N`) and shown as "Shared by member #N", never a name.

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

**Audio and video in step.** Inside the embed player every clip is its own media element
slaved to a 33 ms master clock; an element is only corrected once it is more than 0.5 s off
(1.5 s on the mobile path), and at most six upcoming clips are preloaded (fewer on mobile), so a
late clip stalls the picture while narration carries on. The app reduces the load it can: sound
effects (five to eight extra audio elements per lesson) are off by default on phones (Tune ›
Playback), captions, music and narration are optional, and a chapter tap re-issues `play` because
the player's `seek` always pauses. The rest is the player's: driving the master clock from the
narration element, tighter correction thresholds with rate nudges instead of hard seeks, and
preloading every clip of a document under a minute.

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

## Reminders (`core/push.js`, `public/push.js`)

Web Push for students who installed the app (Android/Chrome, desktop, iPhone 16.4+ from the home
screen) and tapped *Enable reminders* on the Profile. `public/push.js` subscribes the device with
the VAPID public key (`GET /api/push/key`) and registers it (`POST /api/push/subscribe`, up to
five devices per student under `push:<userId>`); `public/sw.js` shows the notification and
focuses or opens the app on tap. The cron (`/api/cron/remind` daily, and the top-up cron) runs
`remindDue()`, which walks the `users` index and sends **at most one message per student per 20
hours** (`push:last:<userId>`): *streak at risk* (a 2+ day streak, nothing watched today, between
17:00 and 21:00 in the device's time zone) or *reviews due* (two or more units past their Leitner
due time). Push services answering 404/410 remove that device. Deliveries are counted as
`push_sent` in `events:day:*` (the sheet's *Reminders sent*). Off unless `STUDYTOK_VAPID_PUBLIC`
and `STUDYTOK_VAPID_PRIVATE` are set: the routes answer `{ enabled: false }` and the cron does nothing.

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

Only `main` builds on Vercel (`ignoreCommand` in `vercel.json`): preview builds for every branch push
count towards the plan's deployments-per-day limit, and once it is hit, merges to `main` are
silently skipped until the rolling window frees up (the Pro plan has a far higher limit).

* **Vercel**: `api/index.js` is one Function serving every `/api/*` route (rewrite in
  `vercel.json`); `public/` is static; `waitUntil` keeps generation running after the
  response; a daily cron tops up popular units and a second one sends reminders.
* **Anywhere else**: `node server/index.js` serves both.

## Costs, roughly

Per new video: ~15 credits of speech + 5 of transcription on Vidmoat, a Claude call per batch
of episodes (shared by everyone on that unit), free stock media and preview frames. Playing
a stored video costs nothing.
