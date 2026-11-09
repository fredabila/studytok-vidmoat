# Video formats

A format is a kind of video: what scenes it has, how it looks and sounds. All thirty-two live in
`server/video/formats.js`; the composer (`server/video/compose.js`) renders any of them.

| id | Name | Scenes | Skin highlights |
| --- | --- | --- | --- |
| `explain` | Explainer | hook · beats (teaching visual each) · quiz · reveal · outro | Montserrat 900, Karaoke captions, lo-fi piano, voice *marin* |
| `mythbust` | Myth vs fact | hook · MYTH stamp · FACT stamp · 2 beats (WHY / AND) · myth-or-fact quiz · outro | Anton uppercase with outline, Boxed Red captions, Moody grade, glitch cuts, suspense music, voice *ash* |
| `rapid` | 5 things | hook · items (numbered bar over footage) · silent recap · quiz · outro | Bungee, Comic Pop captions, Vivid grade, whip-pans, upbeat music, voice *nova* |
| `examdrill` | Exam drill | hook · question card (4 s pause) · worked steps · common mistake · marks tip | Oswald, Clean captions, cool-clean LUT, paper cards, calm piano, voice *cedar* |
| `story` | Story | hook · chapters with datelines · quiz · "why it matters" | DM Serif Display / Cinzel, Clean Subtitle captions, Cinematic grade, letterbox, orchestral music, voice *sage* |
| `flashcards` | Flash drill | hook · (question 2.5 s pause → answer) × 4 · score yourself | Permanent Marker, Handwritten captions, Fade grade, paper cards that flip to the accent, lo-fi beat, voice *marin* |
| `why` | Why? | hook (the question) · BECAUSE · WHICH MEANS · WHICH MEANS · quiz · SO | Archivo Black, Dark Pill captions, Teal grade, zoom cuts, ambient music, voice *echo* |
| `chat` | DM thread | hook · message bubbles (one per scene) · quiz · in one line | Inter, Minimal captions, Matte grade, push cuts, lo-fi, voice *coral* |
| `levels` | 3 levels | the same idea for a kid, a student, an expert · quiz | Montserrat, Warm grade, push cuts, voice *marin* |
| `spotmistake` | Spot it | a worked answer with one wrong step, held while the viewer hunts · the step turns red · the fix | Oswald with a shake, paper cards, cool-clean LUT, tension music, voice *cedar* |
| `tierlist` | Tier list | 4-5 things ranked C → S, the S-tier last · quiz | Bungee, Comic Pop, Vivid, slide cuts, funky music, voice *nova* |
| `thisorthat` | This or that | 4 confusable pairs as compare cards · one more as the quiz | Archivo Black, Dark Pill, Teal grade, whip-pans, voice *echo* |
| `pov` | POV | "you are the…" told in second person, step by step · quiz | Permanent Marker, Handwritten captions, golden-hour LUT, voice *coral* |
| `hottake` | Hot take | HOT TAKE stamp · two reasons · THE POINT stamp · quiz | Anton, Boxed Red, punch LUT, glitch cuts, dramatic music, voice *ash* |
| `countdown` | Top 3 | number 3 → 1, the best last · quiz | Bebas Neue, Hormozi captions, Blockbuster grade, epic music, voice *onyx* |
| `speedrun` | Speedrun | six facts at full pace · silent recap · quiz | Bungee, Comic Pop, Vivid, whip-pans, energetic music, voice *nova* |
| `guess` | Guess first | the question before any teaching (held) · the answer on the card · two beats why | Montserrat, Karaoke, Cinematic, suspense music, voice *sage* |
| `wyr` | Would you rather | a dilemma as the quiz (held) · two beats on what decides it | DM Serif Display, Clean Subtitle, Matte, push cuts, voice *fable* |

| `onething` | 15 sec | one idea, one visual, fifteen seconds | Montserrat, Karaoke, lo-fi |
| `cheatsheet` | Cheat sheet | a revision card that fills in line by line · quiz | Oswald, paper cards, Fade grade |
| `predict` | What happens? | footage, "what happens next?" held, the reveal, two beats why | Archivo Black, Cinematic, suspense |
| `analogy` | It is like… | IMAGINE → SO → BUT (where the analogy breaks) · quiz | DM Serif Display, paper, Warm grade |
| `mistakes` | Don't do this | three mistakes stamped ✗ and fixed · quiz | Anton, Boxed Red, Moody, glitch |
| `history` | Timeline | dated moments building a timeline card, the last is the twist | Cinzel, letterbox, warm-film, orchestral |
| `challenge` | 10 seconds | a mental problem, a ten-second hold, two steps, the trick | Bebas Neue, Hormozi captions, punch LUT |
| `eli5` | ELI5 | LIKE YOU ARE FIVE → NOW FOR REAL: the same idea twice · quiz | Permanent Marker, Comic Pop, Warm grade, playful music, voice *coral* |
| `mnemonic` | Remember it | the mnemonic stamped REMEMBER, then a card fills in word → term · quiz | Oswald, Handwritten captions, paper cards, Fade grade, voice *cedar* |
| `realworld` | Real life | three places you meet the idea, footage of each · quiz | Montserrat, Karaoke, golden-hour LUT, acoustic guitar, voice *marin* |
| `whatif` | What if… | THEN → AND THEN → WHICH IS WHY, a counterfactual chain · quiz | DM Serif Display, Clean Subtitle, Cinematic, letterbox, suspense, voice *fable* |
| `wow` | Wait, what? | one astonishing true fact stamped WAIT, WHAT?, two beats why · easy quiz | Bungee, Comic Pop, Vivid, quirky music, voice *nova* |
| `beforeafter` | Before / after | BEFORE (compare card) → AFTER (what changed) · quiz | Archivo Black, Dark Pill, Teal, whip-pans, voice *echo* |
| `truefalse` | True / false | four statements held, then TRUE or FALSE with the reason · score yourself | Anton, Boxed Red, punch LUT, glitch, voice *ash* |
| `detective` | Case file | the mystery · CLUE 1-3 (each teaches a fact) · SOLVED stamp · a new case as the quiz | Oswald uppercase, Dark Pill, Moody grade, zoom cuts, suspense, voice *onyx* |
| `teachback` | Say it back | two beats · YOUR TURN: say it in one sentence (5 s silent hold) · SAY IT LIKE THIS · quiz | Montserrat, Clean captions, cool-clean LUT, paper cards, calm piano, voice *cedar* |
| `numbers` | By the numbers | NUMBER 1-4 on big stat and bar cards (real figures only) · quiz | Bebas Neue, Hormozi captions, Blockbuster grade, zoom-blur, epic music, voice *onyx* |
| `zoom` | Zoom in | START HERE → ZOOM 1-3, the idea at each scale · quiz | Montserrat uppercase, Karaoke, Teal grade, zoom cuts, ambient music, voice *echo* |
| `interview` | Interview | the student interviews a thing (never a real person), which answers in the first person, bubble by bubble · quiz | Inter, Minimal captions, Warm grade, push cuts, lo-fi, voice *fable* |
| `debate` | Debate | the question · FOR / AGAINST / FOR / AGAINST · VERDICT stamp from the evidence · quiz | DM Serif Display / Archivo Black, Clean Subtitle, Matte, push cuts, dramatic music, voice *sage* |
| `connect` | Connections | HERE → ALSO HERE (another subject) → THE LINK · quiz | Archivo Black, Dark Pill, Teal, whip-pans, upbeat, voice *echo* |
| `howto` | How to | numbered steps over footage · silent recap · quiz | Oswald, Clean captions, cool-clean LUT, paper cards, slide cuts, voice *marin* |

The fourth wave (`eli5`, `mnemonic`, `realworld`, `whatif`, `wow`, `beforeafter`, `truefalse`)
is for tired brains and curious ones. Several of them (`wow`, `whatif`, `realworld`, `eli5`,
with `story`, `pov`, `onething`, `mythbust`, `levels`) are also the **breather formats**: the
light, fun videos the feed drops in when a student is about to leave (`feed/breathers.js`,
ALGORITHM.md "Breathers"). A breather unit's episodes are written only in these formats, with a
note to the writer that the student is tired: no exam framing, an easy quiz, still accurate.

The second wave is built on what keeps people watching short video: curiosity gaps, "wait for
number one", a challenge answered before the reveal, rankings to argue with, first-person
immersion, hot takes. `lessons/claude.js` also rotates hook styles (curiosity gap, challenge,
surprising number, a question answered in the viewer's head, relatable pain, bold claim) and
asks for one open loop per episode, closed late.

## Teaching visuals

A beat's `visual.kind` is one of `diagram` (free-hand inline SVG from the writer), `stat`,
`steps`, `compare`, `timeline`, `definition`, `equation`, `cycle` (3-6 stages drawn as a ring
with arrows) or `bars` (2-5 "label|number" rows as a bar chart), or `photo` / `footage` (stock).
`cycle` and `bars` are rendered by `video/visuals.js` from the data alone, so they never come
out malformed; the writer is told to prefer them, with `steps`, `compare` and `timeline`, over
a `diagram` whenever the idea fits one.

## The scene model

`FORMATS[id].scenes(lesson)` returns an ordered list of scenes:

```js
{ id, kind, spoken, captions?, pauseAfter?, minDur?, ...data }
```

* `spoken` is what the narrator says (`''` for a silent scene such as the recap card).
* `pauseAfter` inserts silence after the scene: the narration audio is cut there and resumed
  later, so a question can be followed by thinking time and a flashcard by a beat to answer.
* `minDur` is the length of a silent scene, or the minimum for a spoken one.
* `kind` selects the renderer in `compose.js`: `hook beat stamp item recap question steps
  callout flashQ flashA chat quiz reveal outro`.

`compose.js planTimeline(scenes, voice)` places scenes on the timeline: with narration, each
spoken scene starts where its part starts in the audio (shifted by the pauses before it);
silent scenes sit inside the pauses; without narration, scenes follow reading pace.

## The skin

```js
skin: {
  hook: { fontFamily, fontWeight, fontSize, uppercase, animIn, animInDuration?, outline?, outlineWidth?, color? },
  term: { fontFamily, fontWeight, uppercase?, letterSpacing? },
  captions: { preset, y, maxWordsPerLine },
  filter: 'Moody' | 'Vivid' | 'cool-clean' | … | null,   // applyFilterPreset on footage
  transition: 'dissolve' | 'glitch' | 'whip-pan' | …,       // setTransition between shots
  music: ['suspense', 'tension'],                            // stock music moods (media.js)
  voice: 'ash',                                              // OpenAI voice via Vidmoat speech
  cards: 'dark' | 'paper',                                   // visuals.js theme
  scrim: 0.7, letterbox?: true, stampSfx?: true, countdown?: true,
}
```

Fonts and caption presets are from Vidmoat's catalogue (`searchCatalogue kind:fonts` /
`caption_styles`); filter presets and transitions from `GET /v1/schema/commands` enums.

## How formats are chosen

`pickFormats(topic, count, { recent, performance })` draws `count` distinct formats per
batch of episodes: weight = the format's topic weight × how it performs on that topic
(`events.js formatPerformance`) × a penalty for what the unit used most recently × noise.
`lessons/claude.js` then writes each episode to its format's `spec`, and `lessons/schema.js
sanitizeLesson` checks the format has what it needs (falling back to `explain` otherwise).

## Adding one

1. Add the entry to `FORMATS` (name, tag, blurb, spec, weights, skin, scenes).
2. New card? Add a renderer to `visuals.js` (take `{ id, start, duration, track, accent, theme }`
   and return commands via `html()`), and a `kind` branch in `compose.js`.
3. New lesson fields? Extend `LessonSchema` and `sanitizeLesson` with a fallback.
4. Add a sample to `lessons/samples.js` and preview it: `npm run preview -- --format=<id>`.
5. `npm test`: the format suite composes every sample, silent and narrated.
6. Add a row above and, if the app should show something special, a `SAMPLE_HOOKS` card on the
   landing page (`public/app.js`).
