# Community packs

A *pack* is a folder in this directory with one Markdown file, `pack.md`, and optionally an
`assets/` folder. StudyGraph turns every pack into a small course: each unit in the file becomes
a unit a student can add from their Library, lessons are written from the pack's own words and
facts, the pack's images and clips can appear in the videos, and every lesson made from the
pack shows the author's name, link and call to action. That is the deal: you share something
worth learning, StudyGraph makes videos out of it, and students see who it came from.

What people put here: the ideas of a book they are reading (in their own words), notes from a
course, what a project or organisation does, a creator's topic, an event. Anything a student
could usefully watch two minutes about.

Open a pull request adding `content/<slug>/pack.md`. A check runs on every pull request
(`npm run content:check`); a maintainer reads the pack before merging. Once merged it is live
within minutes at `https://study-graph.com/?pack=<slug>`, a link you can share.

## The file

```
content/
  my-pack/            ← the slug: 3-40 lower-case letters, digits and single dashes
    pack.md
    assets/           ← optional
      cover.jpg
```

Copy [`_template/pack.md`](_template/pack.md). Every field below is checked.

```md
---
title: Meditations, the ideas          # 4-70 characters
kind: book                             # book | course | notes | project | creator | organisation | event | other
topic: psychology                      # biology, physics, space, history, math, chemistry, psychology,
                                       # economics, computer-science, earth, health, law, business, language, general
level: lifelong                        # optional: middle-school, high-school, university, postgraduate, lifelong
by: Ama Mensah                         # who wrote this pack (a person or an organisation)
link: https://example.com/meditations  # optional: the thing you are promoting (https only)
cta: Read the free edition             # optional, needs link, up to 30 characters
language: en                           # optional, default en
license: CC-BY-4.0                     # for the text you wrote: CC0-1.0, CC-BY-4.0 or CC-BY-SA-4.0
tags: [stoicism, philosophy]           # optional, up to 8
---

## About
Two to five sentences on what this is and why a student would want it. 60-900 characters.

## Units
### Unit title                          ← 2-12 units, titles 4-60 characters, unique
A paragraph (40-700 characters) in your own words: what this unit teaches. This is what the
lesson writer works from, so be concrete: names, numbers, mechanisms, examples.
- Optional fact bullets the videos must get right (15-200 characters each)

### Another unit
…

## Facts
- Optional: up to 40 facts that apply to the whole pack (dates, definitions, figures).

## Quiz bank
- Q: A question? | A: the right answer | B: a wrong one | C: another wrong one
- Up to 30. The first option is always the correct one; StudyGraph shuffles them.

## Assets
| file | kind | shows | credit | license | size | duration |
| --- | --- | --- | --- | --- | --- | --- |
| cover.jpg | image | The pack's cover: a marble bust on a dark background, the title in gold | Ama Mensah | CC-BY-4.0 | 1080x1350 | |
| intro.mp4 | video | A slow pan over a handwritten journal page | Ama Mensah | CC0-1.0 | 1080x1920 | 12 |
```

## Rules for the text

* **Your own words.** Summaries, not copies. Quote at most 25 words at a time, with the source
  named in the sentence. Public-domain texts can be quoted freely.
* **Accurate.** The lesson writer treats your units and facts as the truth of the pack. Check
  figures and dates. Say "about" when you are not sure.
* **Teach, do not sell.** The promotion is the `link` and `cta`, shown with every lesson. The
  units themselves must teach something a student can use without buying anything. Packs that
  are only an advertisement are not merged.
* **Safe for a classroom.** Students include minors. Nothing sexual, violent, hateful or about
  drugs or gambling; no medical, legal or financial advice presented as instruction; no personal
  data about other people.
* **No tracking links.** The `link` is a plain https page. Affiliate or UTM-tagged links are
  fine as long as they are your own; link shorteners are not.
* One pack per thing. Update your pack with another pull request rather than adding a second.

## Rules for assets

Assets are imported into Vidmoat and composited into videos, so they have to be clean,
labelled and yours to give.

* **Files**: lower-case letters, digits and dashes, one of `.jpg` `.png` `.webp` `.mp4` `.mp3`.
  At most 12 per pack. Every file in `assets/` is listed in the Assets table, and every row
  names a file that exists.
* **Images**: at most 2 MB; the short side at least 720 px, the long side at most 4000 px.
  Portrait (9:16, 4:5) fills the frame best; landscape is letterboxed over a blurred copy.
* **Video**: `.mp4` (H.264 + AAC), at most 25 MB and 20 seconds, at least 720 px on the short
  side. No burnt-in captions or logos, no music you do not own (StudyGraph adds its own bed).
* **Audio**: `.mp3`, at most 5 MB and 30 seconds. Only your own recordings or CC0 sound.
* **Labelled**: `shows` says what a viewer will see or hear (15-160 characters). It is the
  alt text, it is how the lesson writer decides when to use the asset, and it is what a
  maintainer checks the file against. `credit` is who made it; `license` is CC0-1.0, CC-BY-4.0
  or CC-BY-SA-4.0. `size` is `WIDTHxHEIGHT` for images and video; `duration` is seconds for
  video and audio. The check measures the files and fails the pull request if they disagree.
* **Yours.** No stock you downloaded, no screenshots of other people's work, no third-party
  logos beyond the thing the pack is about, no recognisable children, nothing you would not
  want shown under your name on a student's phone.

## How StudyGraph uses a pack

* Each `### Unit` becomes a unit with the id `pack:<slug>:<n>`. A student adds the whole pack
  from the Explore tab or by opening `?pack=<slug>`. The units then sit in their
  course like any other, with mastery, spaced repetition and the quick checks.
* Lessons are written per unit from the summary, its bullets and the pack's Facts, pitched at
  the student's level. The writer is told the pack's title and author and names it once.
* When a unit's lesson calls for an image or a clip, the writer can ask for one of your assets
  by file name instead of stock footage; `shows` is what it chooses on.
* Quiz-bank questions are offered to the writer for that pack's quick checks.
* Every lesson from the pack shows "From <by> · <title>" under the title and, in the *Why*
  sheet, your `cta` with the `link`.
* Nothing from a pack is generated until a student adds it, so a pack costs nothing to host.

## Checking before you open the pull request

```bash
npm run content:check
```

It parses every pack, measures every asset and prints what to fix. The same check runs on the
pull request.
