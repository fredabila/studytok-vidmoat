# The algorithm

`server/feed/ranking.js` is pure (no I/O) and unit-tested; `server/feed/index.js` feeds it
data and `server/feed/events.js` learns from viewers. The feed is built in two stages per
slot, then re-ordered so ready videos come first.

## Stage 1: which unit

For every candidate unit (the student's course units in syllabus order, the units of course
profiles they follow, plus interest topics), with its learning state `s` (`user:{id}:progress`):

```
score = (affinity + progress + review + intent − recency) × lessFactor
```

* **affinity**: a Thompson sample from `Beta(1 + engaged, 1 + disengaged)` where
  `engaged = completes + 2·likes + quizRight + Σ watch fraction` and
  `disengaged = skips + 3·less + 0.5·quizWrong + Σ (1 − watch fraction)`. The sample is
  shrunk toward 0.5 in proportion to the evidence (half weight after 3 signals), so a brand-new
  student's feed is driven by the syllabus, not noise.
* **progress**: the syllabus frontier. Units not yet mastered (`mastery < 0.7`) are ranked per
  program; the first gets 1.0, the next 0.7, 0.4… so the feed walks each course from its start
  (a student with three subjects starts all three). Units of a **followed course profile**
  (kind `follow`, at most 16 per profile, 12 profiles per page) get 0.25; interests get 0.15
  (both 0.5 without a course of their own).
* **intent**: opening a course profile (`GET /api/channels/:handle`) leans the feed towards
  that course for 20 minutes: its units get up to +0.6, fading linearly to 0. This works for
  courses the student studies and for ones they only looked at. Calibration tracks units chosen
  this way under the `follow` and `intent` leads.
* **review**: spaced repetition with Leitner boxes. A correct quiz answer moves the unit up a
  box (due again in 1, 3, 7, 21 days); a wrong one drops it to box 0 (due in 20 minutes).
  When due: +0.6, or +0.9 if the unit has more wrong than right answers.
* **recency**: the unit just served gets −1.6, then −0.9, −0.3, 0, so pages stay varied.
* **lessFactor**: `0.35 ^ less` ("show me less" is strong and compounding).
* **exploration**: a random candidate with probability `exploreRate(served)`: 0 for the first
  8 videos, then 15% decaying toward 3% as the algorithm learns the student.

`mastery(s)` blends quiz accuracy (weighted by how many questions) with exposure
(completions / 3). It drives the frontier and the Library's progress rings.

## Stage 2: which video of that unit

Among the unit's ready videos the student has not seen or been served:

```
score = quality × taste × diversity × fatigue × difficulty × freshness
```

* **quality** (`videoQuality`): everyone's engagement with this video, Bayesian-smoothed:
  `(completes + 2·likes + 2·saves + quizRight + mean watch fraction·leaves + 0.5·loops + 1)
   / (views + skips + 0.5·quizWrong + 2·less + (1 − mean watch fraction)·leaves + 3)`.
  Watch fraction is the strongest signal: a video people watch 90% of is good even if nobody
  tapped like.
* **taste** = `0.5 + 0.7·formatAffinity + 0.3·topicAffinity`, each a shrunk Thompson sample
  from the student's own `signals` for that format / topic (same formula as stage-1 affinity,
  over completes, likes, saves, right answers, watch fraction vs skips, less, wrong answers).
* **diversity**: ×0.6 if the format equals the last one served, ×0.85 for the one before;
  ×0.85 if the topic repeats twice running.
* **fatigue**: after ~6 videos in a session, light formats (rapid fire, flashcards, myth-bust)
  gain up to +25% and heavy ones (exam drill, story) lose up to 25% by the 18th video.
* **difficulty**: two wrong answers in a row favour gentle formats (explainer, why, chat);
  three right in a row favour exam drills and flash drills.
* **freshness**: up to +8% for videos made in the last two weeks.
* **context**: from the session's device posture and hour (see EVENTS.md, *Device sensors*).
  On the move, formats the narration carries (story, POV, chat) gain up to +25% and dense cards
  (spot the mistake, exam drill) lose up to 25%; lying flat late at night, gentle formats win and
  the loud ones drop.

Every part is returned in `why.video` so the *Why* sheet can say, for example, "you tend to
watch Exam drills through" or "something lighter after a long session".

## Closing the loop on production

Three more loops run from the aggregates in EVENTS.md: hook styles that hold attention on a
topic are fed to the writer (`hookGuidance`), narrator voices that hold attention better take
over a format (`bestVoiceFor`), and per-scene drop-off curves (`leaveAt`) show where each format
loses people (today: exposed on `/api/stats` for tuning).

`events.js formatPerformance(topic)` turns the format counters for a topic into a multiplier
(0.6–1.4, shrunk toward 1 with little data) that `lessons/index.js` passes to
`pickFormats()`, so Claude writes more of the formats students on that topic actually watch
through, and fewer of the ones they skip.

## Review sessions (retrieval practice)

When stage 1 picks a unit because it is *due* (the `review` term is positive), stage 2 changes
what "best video" means. Re-reading an explainer is weak revision; producing the answer is
strong. So the pick is scored with a `retrieval` multiplier (`FORMAT_RETRIEVAL`: flashcards and
true/false 1.5, ten-second challenge 1.45, exam drill 1.35, spot-the-mistake 1.3 … explainer
0.7, story 0.7, ELI5 0.65), and the feed first looks in the unit's **review pool**: lessons
written with `audience.review` set, which restricts the writer to `RETRIEVAL_FORMATS` and tells
it to open with a recall prompt, make the student answer before the answer appears, and cover
the two or three facts most likely to be forgotten. Review lessons are filed under their own
lesson key (`…|review`) so they never replace a unit's first explanations.

The writer also hears how quizzes on the topic are going (`quizGuidance`): when nine in ten
quick checks on a topic are answered right it asks for harder distractors and application
questions; when most are wrong it asks for plainer questions the video clearly answers.

## Breathers

Short-video feeds keep people by changing the pace before they leave. StudyGraph does the same,
without drifting away from the course. `feed/breathers.js`:

* **Trigger** (`needsBreather(session, signals)`): the student left the last two videos early
  (`earlyStreak >= 2`), or got three quiz answers wrong in a row (`wrongStreak >= 3`), or has
  watched ten videos this session without anything light. Never within six videos of the last
  breather; never for a student who has said "less" to two breathers or swipes them away
  (mean watch fraction under 35% after three).
* **Pick** (`pickBreather`): a *breather unit* from the topic the student is in right now (70%)
  or one of their course and interest topics: `fun:<topic>:<n>`, three hand-written titles per
  topic ("Animals with real superpowers", "Famous bugs that broke the world", "The strangest
  things ever used as money"). Open units, so the writer picks a fresh subtopic each time, and
  shared like any other unit's videos.
* **Write**: breather episodes use only the light formats (`BREATHER_FORMATS`) and the writer is
  told the student is tired: fun, surprising, true, no exam framing, an easy quiz.
* **Serve**: a ready breather goes first on the page; otherwise one is generated **on the
  house** (never charged to the student or their free allowance, and never generated at all for
  a student on their own Vidmoat account, who only gets library breathers). `noteBreather()`
  records the slot in its own key (`user:{id}:breather`, safe from the events batches that
  rewrite the session), so one signal produces one breather and the next waits six videos. The
  *Why* sheet says why it appeared.
* **Not the syllabus**: breather views never touch unit progress, mastery or level-ups
  (`isBreatherUnit`), but they do feed the student's format and topic tastes and a
  `signals.breathers` counter (watch fraction, "less") that can switch them off.

## Recall cards (your mistakes come back)

The strongest learning signal StudyGraph has is a quick check answered wrong. `feed/recall.js`
keeps those questions (`user:{id}:misses`, at most 40) and brings each one back as a *recall
card* in the feed: the question again, no video, with the lesson's explanation on a wrong
answer and a "Watch the lesson again" button.

* **Schedule**: a miss is due again after 30 minutes (in practice, the next session). Right
  once, it comes back in two days; right twice, it is retired. Wrong again, it resets to 30
  minutes and the card shows how often it was missed.
* **Pacing** (`pickRecall`): never before the second lesson of a session, then one card every
  four lessons at most, only when something is due. A recall card takes the second slot of the
  page and displaces any moment that page would have had.
* **Library**: the Course tab shows "N questions to fix" with a *Fix them now* button that
  queues them all. The sheet's user row carries "To fix".
* **Events**: `recall_view`, `recall_answer` (`id`, `correct`, `ms`), `recall_skip`; a right
  recall answer counts into the session's right streak like a quiz answer. Daily: "Recall
  answers" and "Misses fixed".

## Exam countdown

With an exam date on the profile (`profile.examDate`, optional), `ranking.js examUrgency`
rises from 0 at 45 days out to 1 on the day. It multiplies the review term in `pickUnits` by
`1 + urgency`, gives every started unit a small review pull (`0.3 × urgency`), shrinks the
syllabus-frontier term by up to 30%, and from `urgency ≥ 0.5` every started unit is served in
review mode (retrieval-practice formats). The app shows a countdown chip on the Library hero
and the Profile, and the buddy line turns to revision in the last two weeks.

## Openers and easing back in

The first card of a visit can be an *opener* (`moments.js openerMoment`), at most one a day:

* **Welcome back** after three or more days away ("Your streak starts again today. 3 lessons
  and you are back in it."), and the first page eases in: `scoreVideo` gets `gentle: true`,
  which favours the gentler formats (`FORMAT_GENTLENESS`) for that page only.
* **Countdown** when the exam is within 60 days, once a week: units still to master and how
  many lessons a day cover them.
* **Last time** otherwise: how many lessons and quick checks the previous session had, what is
  due today, the streak or the goal.

Openers bypass the moment pacing (they are the start of the visit) and do not count against
the day's quota.

## Learning profile (`feed/learning.js`, from StudyGraph)

StudyGraph asked students to pick their learning style (Visual, Auditory, Reading/Writing,
Kinesthetic) and passed the answer to its AI. StudyGraph keeps the question, in plain words
(seeing it, hearing it explained, reading it, doing it), and treats the answer as a starting
point only: research has not found that teaching to a self-reported style helps, but matching
to what a student measurably finishes and gets right is ordinary good personalisation.

* **Ways in per format.** Each of the 32 formats is weighted by what it asks of the student
  (`FORMAT_STYLE`: an explainer is 0.6 seeing, 0.4 hearing; a guess-first is 0.8 doing, 0.2
  hearing…), and each game kind likewise.
* **Profile.** For each way in: engagement (watch fraction, completions, likes, saves, loops
  against early leaves, skips and "less") and accuracy (quick checks and game items right),
  scored `0.6 × engagement + 0.4 × accuracy` with Beta-style smoothing. What the student said
  adds a small prior (worth a few lessons). Confidence grows with evidence; "measured" after
  about twelve weighted views.
* **In the feed.** `styleFit` multiplies a video's score by up to ±12 %, scaled by confidence,
  towards formats that use the student's stronger ways in. It is a calibrated rule (`style` in
  the Calibration tab): if students' feeds tilted this way are not watched better, its weight
  shrinks on its own.
* **For the student.** Profile › How you learn best shows the four bars, how far through they
  watch each kind, one line of insight, and an action that fits (diagram-first lessons, narration
  on, a game, lesson notes). They can change what they said at any time. The sheet's user row
  has "Learns best" and "Says they prefer".

## Mini games (`feed/games.js`)

Five games built from lessons the student has already watched, so each is retrieval practice
on their own material and costs nothing to make: **Match it** (a term and its meaning, from
definitions and flashcards), **Put it in order** (step lists, timelines oldest first, cycles,
worked-example steps), **Sort it** (each chip to its side of a compare table), **True or
false?** (six seconds per statement, from true/false cards, myths and facts) and **Fill the
gap** (the lesson's own sentence with its key term blanked, two distractors from other lessons).

* **Pacing**: never before the fifth lesson of a session, then one every seven lessons at most
  and four a day, not the same kind twice running. A game takes the second slot when no recall
  card did, and a moment waits for the next page.
* **Results**: the app checks answers on the device; the server kept which lesson each scored
  item came from (`game:{id}`, two days, one result per game). Each unit behind the game counts
  one quick-check answer (right only if every item from it was right), so games move mastery and
  the spaced-repetition boxes, and up to two missed lessons come back as recall cards.
* **On demand**: Library › Practice games lists the kinds the student's history can make
  (`GET /api/games/next?type=`), with their best score per kind on the device.

## Moments

Between lessons, every so often, the feed shows a *moment*: an animated card from Noti with a
tip about StudyGraph, a piece of news, or an offer. No video is made for it (the app renders it),
so it costs nothing, and it is paced so the feed stays a feed. `feed/moments.js`:

* **Pacing** (`pickMoment`): never before four lessons into the session, then at most one every
  six lessons, at most three a day, never on a page that already carries a breather. Each
  moment has a repeat window (14 to 120 days) and is not shown again inside it. The marker
  lives in `user:{id}:moments` (like the breather's, safe from the events batches).
* **Eligibility**: every built-in moment has a `when(ctx)` that looks at the student's facts:
  the "save a lesson" tip only before their first save, the install tip only in a browser, the
  keyboard tip only on a computer, the reminders tip only when push is configured and they have
  not turned it on, the free-lessons offer halfway through the allowance, the "unlimited" offer
  once it is used up (never for an own-account student), the invite offer before the first
  invite, and so on.
* **Extras**: offers and news that should not wait for a deploy go to
  `POST /api/admin/moments` (`Authorization: Bearer $STUDYTOK_SHEET_SECRET`) as
  `{ moments: [{ id, type, title, lines[2-3], emoji, mood, theme, cta: { label, action | href },
  repeatDays, until, minWatched }] }`. They are shown ahead of the catalogue and expire on
  `until`. `GET` on the same route lists them.
* **Slot**: a moment takes the second slot of the page, so a lesson always comes first, and it
  never counts as a view, a served video or syllabus progress. `moment_view` and `moment_cta`
  events say which ones get read and tapped (the Daily sheet counts them under "Moments shown").

## Lessons are made for your country (`lessons/index.js` regionOf)

Lessons use everyday examples from the student's country (a trotro fare in Accra, the Tube in
London), so the lesson key carries the country (`|loc:ghana`). A student is served lessons from
two pools only: their country's, and lessons written with no country (examples familiar
anywhere). Another country's lessons are never served by the feed, the starters or Explore. On
a course profile they are labelled "Made for Ghana", and only play when tapped. "No duplicates"
applies to courses, not lessons: one course profile holds every version of its lessons (per
level, country, exam and preference), and the feed picks, or makes, the one written for you.
Lessons made before this were re-filed once under the country of the student they were made
for (`feed/regions.js`).

## Explore (`feed/discover.js`)

* **Grid**: from a shared pool of the newest 400 ready lessons (rebuilt every 10 minutes), the
  ones that suit the student's country, not yet seen, scored
  `(0.35 + quality) × (0.6 + topic taste + Explore taps) × level fit × novelty × freshness × jitter`.
  Novelty is 0.45 for the student's own course (Explore is for what is next door) and 0.8 for
  courses they follow. At most 2 lessons per unit and 4 per course. Each tile says why it was
  picked. Topic chips filter it; topics opened in Explore lean it (`signals.explore`).
* **Courses for you**: the most followed courses with lessons, not yet followed, boosted for
  topics the student likes and their level.
* **Search**: typeahead over courses, lessons (title, hook, unit, key terms; prefix match on the
  last word), topics, packs and popular searches; recent searches stay on the device. Popular
  searches are queries that found something, searched by at least two students, never
  offensive (`search:q:<week>`).

## Course profiles (`feed/channels.js`)

Every course has one public profile with a unique handle: catalog programs and community packs
get an official one (`@hs-biology`, the pack slug); a researched course or a custom topic is
named by the student who brings it to StudyGraph (at onboarding, or when they add the topic).
One course has exactly one profile (`channel:ref:<ref>`), so the next student who researches
the same course or types the same topic is shown the existing profile and follows it instead of
making a duplicate, and both share its lessons.

* **Renaming**: the student who brought a course can change its handle (3 times in 30 days;
  `POST /api/channels/:handle/rename`). Followers, counters, the lesson index and search move
  to the new handle; old handles become aliases (`channel:alias:<old>`) that redirect and can
  never be taken by another course.
* **Following**: students follow every course they study automatically. Following someone
  else's course adds its units to the feed (kind `follow`, above). Unfollowing a course the
  student studies takes it off their course; the choice is remembered so it is not re-followed.
* **Profiles**: `/@handle` is a public, indexable page (grid of lessons, syllabus, Course
  JSON-LD, its own share card at `/og/c/:handle.png`); in the app the same profile opens over
  the feed, and its grid plays as a feed. Lessons are listed from `ready:unit:<unitId>`.
* **Signals**: `channel_view`, `channel_play`, `channel_lesson_open`, `channel_share`,
  `channel_follow` / `channel_unfollow` update `signals.channels[handle]` and the profile's
  counters (`channel:<handle>:stats`); follow state and follower counts change through the API.

## Calibration (`feed/calibration.js`)

Every multiplier in stage 2 started as a judgement call. The calibration loop checks each one
against what students then did:

* **Decisions.** When a video is served, its score parts are kept for a day
  (`decision:{user}:{video}`).
* **Outcomes.** When the student leaves the video (watch fraction, early leave) or answers its
  quick check, the outcome is folded into counters per rule and bucket: did that rule push the
  video *up* (multiplier above 1.02), *down* (below 0.98) or leave it *flat*. Watch fraction is
  also counted by posture (moving, in hand, lying flat; dense versus light formats) and by the
  student's local hour.
* **Lift.** Nightly (with the Daily sheet rows), each rule's *up* bucket is compared with its
  *flat* bucket: if the videos a rule promoted were watched longer, the rule has lift. The
  *down* bucket (videos served despite the rule, when nothing else was ready) is used the other
  way round when it has enough data.
* **Weights.** For the judgement-call rules (diversity, fatigue, difficulty, freshness, context,
  retrieval, easing) a shrink weight in 0..1 is fitted from the lift: no lift → 0.3, +14 % → 1,
  −6 % → 0; below 150 outcomes per bucket the weight stays 1 (the rule as designed). The
  ranking applies `1 + w × (multiplier − 1)`, so a rule that does not earn its keep fades
  towards 1.0 on its own. Quality and taste are evidence-based already and are not shrunk.
* **Where to read it.** The sheet's *Calibration* tab (one row per rule bucket, posture class
  and hour, with lift and weight) and `GET /api/admin/calibration`.

Reminders now go out at each student's own usual hour (the mode of their hour-of-day counts,
18:00 until there are ten views), on an hourly cron, instead of 18:00 UTC for everyone.

**Evidence decays.** Every video and format counter is kept all-time and per month; a read
blends this month and last at full weight with everything older at 0.35
(`core/db.js blendedHash`), so a video that did well with its first viewers a season ago does
not keep that score forever, and the same for a format's performance on a topic.

**Stage one is reported, not yet reweighted.** Each decision records which term chose the
unit (affinity, syllabus progress, review, exploration, an interest topic, a breather); the
Calibration tab shows watch, early leaves, completion and quiz accuracy per lead
(`unit · review-led` …). Those rows are what a change to the stage-one weights would be judged
against.

**Experiments** (`feed/experiments.js`). The thresholds that are still judgement calls run as
two arms, assigned per student by a stable hash of their id (even, independent per
experiment, never changing): exploration share (15 % → 3 % against 10 % → 2 %), breather
triggers (2 early leaves / 3 wrong / 6 apart against 3 / 4 / 8) and moment pacing (every 6
lessons against every 9). Per arm the tab shows views, mean watch, early leaves, lessons per
session and active days (`experiment · breather · B (early 3, wrong 4, gap 8)`). Promoting an
arm is a one-line edit of `EXPERIMENTS`; that is deliberate, a human reads the rows first.

## What the algorithm does not do (yet)

* No collaborative filtering across students (the library is small and per unit); format and
  topic tastes are the current proxies.
* No learned weights: the coefficients above are hand-set. `/api/stats` and `events:log` exist
  so they can be tuned with data; a PR that fits them properly is very welcome.
* No time-of-day effects, though `signals.hours` already records when each student studies.

## Tuning safely

* Keep `ranking.js` pure and add a test for any new term (see `test/recommend.test.js` and
  `test/events.test.js`): seed the RNG, show the term moves the score the intended way, and
  show a brand-new student still starts at unit 1.
* Prefer multiplicative terms with a bounded range (0.6–1.4) in stage 2 so no single signal
  can dominate quality.
