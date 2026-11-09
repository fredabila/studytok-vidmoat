# The algorithm

`server/feed/ranking.js` is pure (no I/O) and unit-tested; `server/feed/index.js` feeds it
data and `server/feed/events.js` learns from viewers. The feed is built in two stages per
slot, then re-ordered so ready videos come first.

## Stage 1: which unit

For every candidate unit (the student's course units in syllabus order, plus interest
topics), with its learning state `s` (`user:{id}:progress`):

```
score = (affinity + progress + review − recency) × lessFactor
```

* **affinity**: a Thompson sample from `Beta(1 + engaged, 1 + disengaged)` where
  `engaged = completes + 2·likes + quizRight + Σ watch fraction` and
  `disengaged = skips + 3·less + 0.5·quizWrong + Σ (1 − watch fraction)`. The sample is
  shrunk toward 0.5 in proportion to the evidence (half weight after 3 signals), so a brand-new
  student's feed is driven by the syllabus, not noise.
* **progress**: the syllabus frontier. Units not yet mastered (`mastery < 0.7`) are ranked per
  program; the first gets 1.0, the next 0.7, 0.4… so the feed walks each course from its start
  (a student with three subjects starts all three). Interests get 0.15 (0.5 without a course).
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

Short-video feeds keep people by changing the pace before they leave. StudyTok does the same,
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

The strongest learning signal StudyTok has is a quick check answered wrong. `feed/recall.js`
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

## Moments

Between lessons, every so often, the feed shows a *moment*: an animated card from Noti with a
tip about StudyTok, a piece of news, or an offer. No video is made for it (the app renders it),
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

Not calibrated yet: the stage-1 unit weights, the breather and moment thresholds, and the
exploration rate. Video quality and format performance have no decay, so old evidence keeps
its weight.

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
