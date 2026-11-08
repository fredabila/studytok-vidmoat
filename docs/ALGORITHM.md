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
