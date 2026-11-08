# Events

Everything the ranking learns from starts as an event from the app. This page is the
contract between `public/telemetry.js` (what is sent), `server/feed/events.js` (what is
accepted and how it is aggregated) and anyone analysing the data.

## Transport

* `public/telemetry.js` queues events with `track(type, fields)` and posts batches to
  `POST /api/events` every 4 s, when 25 are queued, and on `pagehide`/hidden
  (`navigator.sendBeacon`, `text/plain` body).
* A batch is `{ ctx, events: [...] }`. `ctx` is coarse device context: a per-page-load
  session id, viewport, device pixel ratio, standalone (installed) flag, connection type
  (`4g`…), time zone, language, platform (`ios` / `android` / `desktop`).
* Every event has `type`, `at` (ms epoch) and `seq`; video events have `videoId`. Unknown
  types and fields are dropped, numbers are clamped, strings truncated (`cleanEvent`).
* Nothing identifies a person beyond the StudyTok user id (the cookie). Nothing is sent to a
  third party.

## Taxonomy

| Event | Fields | When |
| --- | --- | --- |
| `session_start` | `source` app/browser, `entry` feed/link/library/profile, `ageBand` under13/13-17/18+ | page load |
| `app_hidden` / `app_visible` | | tab or app goes to / returns from the background |
| `install` | `outcome` accepted/dismissed | after the install prompt |
| `signin_click` | `where` | a sign-in button |
| `load_more` | `count`, `ms`, `ready`, `generating` | a feed page arrived |
| `end_reached` | | the viewer hit the end-of-feed slide |
| `impression` | `slot`, `nth`, `status`, `format` | a slide was added to the track |
| `view` | `nth`, `format`, `source` feed/library | active and ready for 1 s (once per viewer per video) |
| `heartbeat` | `t`, `watched`, `loops` | every 5 s while playing |
| `scene` | `sceneId`, `kind`, `t` | playback entered a new scene (hook, beat2, quizQ…) |
| `pause` / `resume` | `t`, `by` tap/quiz/player | playback state changed |
| `loop` | `loops` | the video wrapped around |
| `complete` | | reached the end |
| `leave` | `t`, `watched`, `maxT`, `pct`, `loops`, `dir` next/prev, `early` | the viewer moved on (one per view) |
| `rewatch` | | the viewer swiped back to a video they had viewed |
| `like` / `unlike` / `save` / `unsave` | `t`, `by` button/double-tap | reactions |
| `less` | `t` | "show me less" |
| `why_open` | | opened the *Why* sheet |
| `quiz_shown` / `quiz_hold` | `t` | options appeared / the video was held at the question |
| `quiz_answer` | `choice`, `correct`, `ms` (time to answer) | tapped an option |
| `quiz_skip` | `ms` | tapped Skip |
| `tune_open` | | opened the Tune sheet |
| `pref_change` | `key`, `value` | changed a lesson preference |
| `interest_toggle` | `topic`, `on` | followed / unfollowed a topic |
| `custom_add` / `custom_remove` | `title` / `unitId` | custom topics |
| `unit_toggle` | `unitId`, `on` | ticked / unticked a unit in the Library |
| `library_open` | `tab` course/saved/history | Library tab |
| `profile_open`, `studies_edit` | | Profile |
| `player_error` | `msg` | the embed player failed |
| `gen_wait` | `ms`, `outcome` ready/failed/gave_up | how long a viewer waited on a generating slide |
| `skip` | | legacy: an early leave (the app now sends `leave` with `early: true`) |

## Aggregates (what `ingest()` writes)

| Key | Type | Contents |
| --- | --- | --- |
| `video:{id}:stats` | hash | `impressions views heartbeats completes leaves watchSec pctSum wf0..wf4 skips loops rewatches pauses likes saves less whyOpens quizShown quizHeld quizRight quizWrong quizSkips answerMs choice0..2 dir_next dir_prev errors` |
| `video:{id}:scenes` | hash | sceneId → viewers who reached it (the drop-off curve) |
| `stats:format:{format}` and `stats:format:{format}:{topic}` | hash | `views completes leaves pctSum skips loops rewatches likes saves less quizRight quizWrong quizSkips` |
| `user:{id}:signals` | JSON | per-format and per-topic `{views completes likes saves skips less right wrong loops rewatches n pctSum}`, `watch {n pctSum completes early}`, `quiz {n right msSum skips}`, `hours[24]`, `sessions`, `prefs` |
| `user:{id}:session` | JSON | `sid startedAt lastAt served viewed lastFormats[] lastTopics[] wrongStreak rightStreak earlyStreak` (a session ends after 30 quiet minutes or a new page load) |
| `user:{id}:progress` | JSON | per-unit learning state (`ranking.js applyEvent`): views, completes, skips, likes, less, quiz right/wrong, Leitner box and due time, watch fraction |
| `user:{id}:seen|liked|saved|answered` | set | once-per-viewer guards |
| `popular:units` | zset | views per unit key (cron top-up) |
| `events:log` | list | the last 20,000 raw events (JSON strings) |
| `events:day:{YYYY-MM-DD}` | hash | event counts per type per day |
| `stats:generation` | hash | `waitedReady waitedGaveUp waitMs` |

`watch fraction` (`pct`) is `max(furthest point reached, seconds watched) / duration`, so a
viewer who looped counts as 1.0, not 2.0.

## Reading the data

* `GET /api/stats` (public, anonymous): per-format completion rate, mean watch fraction, quiz
  accuracy, likes and saves; event counts per day for the last 14 days; generation waits.
* `events:log` in Redis (`LRANGE events:log 0 -1`) for offline analysis. Each entry is a
  compact JSON object with the user id's first 8 characters, the event, and the video's
  format `f` and topic `tp`.
* `video:{id}:scenes` gives a per-scene drop-off curve: compare `hook` to `quizQ` to see where
  a format loses people.

## Adding an event

1. `EVENT_SPECS` in `server/feed/events.js` (fields and their types).
2. A `case` in `ingest()` if it should change an aggregate.
3. `track('your_event', {...})` in `public/app.js`.
4. A row in the table above and a test in `test/events.test.js`.
