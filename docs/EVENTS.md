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
  (`4g`…), time zone, language, platform (`ios` / `android` / `desktop`), screen orientation,
  battery level bucket (`low`/`mid`/`high`) and charging, and the current **posture**.

## Device sensors (`public/sensors.js`)

With the viewer's permission (iOS asks; it is requested on the first tap in the feed), the motion
sensors are sampled on the device and reduced to one word, which is all that is sent:

| Posture | Meaning | What the ranking does with it |
| --- | --- | --- |
| `hand` | held upright, still | neutral |
| `flat` | lying on a table or bed, screen up | late at night: calmer, gentler formats |
| `moving` | walking or in a vehicle (steady shake) | formats the narration carries win over dense cards |
| `unknown` | no motion data (desktop, no permission) | neutral |

A **drop** (near free-fall followed by a hard impact) pauses the video and is counted. Raw
acceleration samples never leave the device, and nothing is recorded when permission is refused.
* Every event has `type`, `at` (ms epoch) and `seq`; video events have `videoId`. Unknown
  types and fields are dropped, numbers are clamped, strings truncated (`cleanEvent`).
* Nothing identifies a person beyond the StudyGraph user id (the cookie). Nothing is sent to a
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
| `heartbeat` | `t`, `watched`, `loops`, `posture` | every 5 s while playing |
| `scene` | `sceneId`, `kind`, `t` | playback entered a new scene (hook, beat2, quizQ…) |
| `pause` / `resume` | `t`, `by` tap/quiz/player | playback state changed |
| `loop` | `loops` | the video wrapped around |
| `complete` | | reached the end |
| `leave` | `t`, `watched`, `maxT`, `pct`, `loops`, `dir` next/prev, `early`, `posture` | the viewer moved on (one per view) |
| `drop` | `videoId`, `t` | the motion sensors saw a free-fall followed by an impact (the video pauses) |
| `sensors` | `motion` | whether motion data is flowing after the permission prompt |
| `refresh` | `where` feed/library/profile | a refresh button or pull-to-refresh |
| `level_up` | `unitId` | a unit crossed the mastery line (the burst) |
| `recap_share` | `week` | the weekly recap was shared |
| `rewatch` | | the viewer swiped back to a video they had viewed |
| `like` / `unlike` / `save` / `unsave` | `t`, `by` button/double-tap | reactions |
| `less` | `t` | "show me less" |
| `why_open` | | opened the *Why* sheet |
| `lesson_share` | `by` sheet/copy | shared the public link to a lesson (`/v/:id`) |
| `moment_view` / `moment_cta` | `id`, `kind` / `id`, `action` | a card between lessons was seen / its button tapped |
| `recall_view` / `recall_skip` | `id` (the lesson's video id) | a recall card was seen / skipped |
| `recall_answer` | `id`, `correct`, `ms` | answered a recall card (right twice retires the question) |
| `reset` | `scope` feed/everything | the student started over from the Profile |
| `play_pref` | `key`, `value` | a Playback choice in Tune (captions, music, narration audio, recall mode) |
| `gaps_on` | `auto` | a lesson played in recall mode (key terms hidden) |
| `gaps_reveal` | `t` | the viewer revealed the hidden terms |
| `chapter_seek` | `from`, `to` | tapped a scene marker on the progress bar |
| `quiz_stamp` | | the viewer's quiz answer was stamped into the video over the reveal |
| `style_set` | `styles`, `where` | the student said how they like to learn (onboarding sends it with the profile) |
| `style_action` | `action` | a suggestion on the learning-profile card was tapped |
| `game_view` / `game_open` | `id`, `game` / `game` | a mini game was shown / started from the Library |
| `game_result` | `id`, `game`, `score`, `total`, `wrong` (item indices), `ms` | a mini game was finished (moves mastery; missed lessons return as recall cards) |
| `drift` | `d` seconds, `t` | the player's picture and audio clocks were more than 0.25 s apart (worst gap, once per view) |
| `pack_add` / `pack_remove` | `slug`, `by` library/link | a community pack joined or left the course |
| `pack_link` | `slug` | the pack's call to action was tapped |
| `library_search` | `q` | typed in the Library search box |
| `explore_open` / `explore_search` | / `q` | opened the Explore tab / searched the packs |
| `notes_open` / `notes_copy` | | opened / copied a lesson's notes |

Every `leave` and `quiz_answer` is also joined to the decision that served the video (`feed/calibration.js`): per ranking rule and bucket, by posture and by local hour. See docs/ALGORITHM.md › Calibration.
| `plan_open` | `unitId` | opened a unit's study plan from the Library |
| `quiz_shown` / `quiz_hold` | `t` | options appeared / the video was held at the question |
| `quiz_answer` | `choice`, `correct`, `ms` (time to answer) | tapped an option |
| `quiz_skip` | `ms` | tapped Skip |
| `tune_open` | | opened the Tune sheet |
| `pref_change` | `key`, `value` | changed a lesson preference |
| `interest_toggle` | `topic`, `on` | followed / unfollowed a topic |
| `custom_add` / `custom_remove` | `title` / `unitId` | custom topics |
| `channel_view` | `handle`, `source` slide/card/link/app | opened a course profile (also leans the feed, ALGORITHM.md "intent") |
| `channel_follow` / `channel_unfollow` | `handle`, `source` | followed / unfollowed a course profile (state changes via `POST`/`DELETE /api/channels/:handle/follow`) |
| `channel_play` / `channel_lesson_open` | `handle`, `from` / `id` | played a profile's lessons as a feed, from the start / from one tile |
| `channel_share` | `handle`, `by` | shared a profile link |
| `channel_rename` | `handle`, `from` | the student who brought a course changed its handle |
| `explore_tile_open` | `id`, `pos`, `topic`, `why` | opened a lesson from the Explore grid (leans the grid towards its topic) |
| `explore_topic` | `topic` | picked a topic chip in Explore |
| `explore_course_open` | `handle`, `where` | opened a suggested course |
| `search_submit` / `search_pick` | `q`, `results`, `where` / `type`, `value` | ran a search / picked a typeahead suggestion |
| `settings_open` | `card` | opened a settings row on the Profile tab |
| `more_open` | | opened the ⋯ menu on a lesson (why, notes, show less, tune, the course) |
| `channel_avatar` | `handle`, `outcome` set/rejected/error | the student who brought a course changed its picture |
| `goal_reached` | `goal` | the daily goal was reached |
| `upnext_shown` / `upnext_tap` | | the "Up next" line near the end of a lesson was shown / tapped |
| `channel_search` | `q`, `results` | searched course profiles (Explore, or adding a topic that already exists) |
| `unit_toggle` | `unitId`, `on` | ticked / unticked a unit in the Library |
| `library_open` | `tab` course/saved/history | Library tab |
| `profile_open`, `studies_edit` | | Profile |
| `push_enabled` / `push_disabled` | | reminders turned on / off from the Profile card (`public/push.js`) |
| `player_error` | `msg` | the embed player failed |
| `gen_wait` | `ms`, `outcome` ready/failed/gave_up | how long a viewer waited on a generating slide |
| `skip` | | legacy: an early leave (the app now sends `leave` with `early: true`) |

## Aggregates (what `ingest()` writes)

| Key | Type | Contents |
| --- | --- | --- |
| `video:{id}:stats` | hash | `impressions views heartbeats completes leaves watchSec pctSum wf0..wf4 skips loops rewatches pauses likes saves less whyOpens quizShown quizHeld quizRight quizWrong quizSkips answerMs choice0..2 dir_next dir_prev errors` |
| `video:{id}:scenes` | hash | sceneId → viewers who reached it (the drop-off curve) |
| `stats:format:{format}` and `stats:format:{format}:{topic}` | hash | `views completes leaves pctSum skips loops rewatches likes saves less quizRight quizWrong quizSkips` |
| `stats:format:{format}:leaveAt` | hash | scene kind → how many viewers left the video there (`end` = watched through): the drop-off curve per format |
| `stats:hook:{style}` and `stats:hook:{style}:{topic}` | hash | `n pctSum early` per hook style (curiosity, challenge, number, question, pain, claim, story, secret) |
| `stats:voice:{voiceId}`, `stats:music:{mood}` | hash | `n pctSum`: how each narrator voice and music mood holds attention |
| `stats:device` | hash | `drops motionOn motionOff` |
| `user:{id}:signals` | JSON | per-format and per-topic `{views completes likes saves skips less right wrong loops rewatches n pctSum}`, per-hook-style and per-posture `{n pctSum early}`, `watch {n pctSum completes early}`, `quiz {n right msSum skips}`, `hours[24]`, `days`, `weeks` (recaps), `sessions`, `prefs` |
| `user:{id}:session` | JSON | `sid startedAt lastAt served viewed lastFormats[] lastTopics[] wrongStreak rightStreak earlyStreak posture hour night` (a session ends after 30 quiet minutes or a new page load) |
| `user:{id}:progress` | JSON | per-unit learning state (`ranking.js applyEvent`): views, completes, skips, likes, less, quiz right/wrong, Leitner box and due time, watch fraction |
| `user:{id}:seen|liked|saved|answered` | set | once-per-viewer guards |
| `popular:units` | zset | views per unit key (cron top-up) |
| `events:log` | list | the last 20,000 raw events (JSON strings) |
| `events:day:{YYYY-MM-DD}` | hash | event counts per type per day |
| `stats:generation` | hash | `waitedReady waitedGaveUp waitMs` |

`watch fraction` (`pct`) is `max(furthest point reached, seconds watched) / duration`, so a
viewer who looped counts as 1.0, not 2.0.

## Funnel and operations counters (`events:day:{date}`)

Besides the client events, a few server-side counters land in the same daily hash and surface in
the Google Sheet's Daily tab: `funnel_landing` (and `funnel_landing_ref` when the visitor came
with an invite link), `funnel_signin_click`, `funnel_joined` / `funnel_signed_in` (the OAuth
callback), `funnel_setup` (first profile save with units), `funnel_install_prompt` /
`funnel_installed`, `referred` (a sign-up credited to an invite), `gen_ready` / `gen_failed`
(video generation outcomes), `channel_autofollow` / `channel_follow_state` /
`channel_unfollow_state` (follow changes), `profile_page_view` (public `/@handle` pages),
`breather_view` and `push_sent` (Web Push reminders delivered by
`core/push.js remindDue()`; the sheet's *Reminders sent*). The landing steps arrive through
`POST /api/funnel` before there is a session; they carry no identifier.

## Invite links

`?ref=<member number>` on any URL is remembered by the app (a cookie for the sign-in round trip,
localStorage for the profile save) and recorded once on the new student's user record as
`referredBy`; the inviter's count is in the `referrals` hash. Shown on the Profile ("Invite a
friend") and in the Users sheet (Invited by, Invites).

## Reading the data

* `GET /api/stats` (public, anonymous): per-format completion rate, mean watch fraction, quiz
  accuracy, likes and saves; per-format drop-off by scene kind (`leaveAt`); hook-style and
  narrator-voice performance; device counters; event counts per day for the last 14 days;
  generation waits.

## What the app learns from this (closing the loop)

* **Hooks** → `hookGuidance(topic)` tells the writer which opening styles hold attention on that
  topic and which get skipped (and, per student, which they watch longest after).
* **Sound** → `bestVoiceFor()` switches a format to a narrator voice that clearly holds attention
  better, once there are 40+ views of evidence.
* **Formats** → `formatPerformance(topic)` weights the format rotation.
* **Context** → the ranking's `context` term reads the session's posture and hour.
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
