# StudyTok

A TikTok-style vertical feed of short study videos. Videos are **generated on the fly** from each
viewer's interests with the [Vidmoat developer API](https://developer.vidmoat.com/developer/docs),
and played **live in Vidmoat's embeddable app player**. Nothing is ever exported to MP4.

```
pick interests ──► GET /api/feed ──► topic picked from your weights
                                       │
              reuse an unseen library video ◄── or ──► generate a new one:
                                                         1. lesson   (Claude, or the offline bank)
                                                         2. b-roll + music (Vidmoat stock search → import)
                                                         3. POST /v1/projects  { commands: [...] }   (one call)
                                                         4. GET  /v1/projects/{id}?view=document
                                                         5. cache the document
browser ◄── document ── /embed/player iframe (postMessage) plays it: video, text, captions, keyframes
```

## Why the player instead of renders

A Vidmoat render is a queued job that uses an export from the monthly allowance and takes
minutes. The `/embed/player` page mounts the same compositor as the Vidmoat editor and plays a
project **document** directly: video, audio, titles, captions, effects and keyframes. So a video
is "ready" as soon as its document exists, usually 10 to 30 seconds after it is requested, and
it costs no export allowance and no credits.

What each video costs on Vidmoat:

| Step | Vidmoat cost |
| --- | --- |
| Stock search, import, create project, apply commands, read document | Free (rate limit only) |
| Playback in `/embed/player` | Free |
| Lesson text | Free with the offline bank; Claude API usage when `ANTHROPIC_API_KEY` is set |

No AI generation credits are spent. Stock imports count towards your Vidmoat storage, and each
import is cached so the same stock file is never imported twice.

## Run it locally

Requires Node.js 22.10+.

```bash
npm install
```

```bash
cp .env.example .env   # then set VIDMOAT_API_KEY (and optionally ANTHROPIC_API_KEY)
```

```bash
npm start              # http://127.0.0.1:3000
```

Locally, data lives in `data/kv.json`. Set the Upstash variables in `.env` to use Redis instead.

Optional, so the first viewers don't wait for generation:

```bash
npm run warm -- 2      # pre-generate 2 videos per topic
```

To check how videos look, `npm run preview -- <topic> [lessonIndex]` builds one bank lesson as a
real project and saves exact frames to `data/frames/` (10 frames a minute per key).

```bash
npm test
```

## Deploy to Vercel

The repo is ready for Vercel as is: `public/` is served as static files, and `api/index.js` is
one Vercel Function that handles every `/api/*` route (see `vercel.json`). Video generation
continues after the response with `waitUntil()` (from `@vercel/functions`), and all state lives
in Upstash Redis.

1. **Import the repo** at vercel.com/new. Framework preset: **Other**. Leave the build and
   output settings alone; `vercel.json` sets them.
2. **Add storage:** Project → **Storage** → **Upstash for Redis** (Marketplace) → create a
   database and connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   for you.
3. **Add keys:** Project → **Settings → Environment Variables**:
   * `VIDMOAT_API_KEY`: required.
   * `ANTHROPIC_API_KEY`: optional, so Claude writes every lesson.
   * Optional tuning from `.env.example`, e.g. `VIDMOAT_DELETE_PROJECTS=true`.
4. **Deploy** (or redeploy after adding variables), then open `https://<your-app>/api/health`.
   It should show `"ok": true` and `"storage": "redis"`.
5. **Warm the library** from your machine so the first visitors get instant videos:

   ```bash
   npx vercel link
   ```

   ```bash
   npx vercel env pull .env
   ```

   ```bash
   npm run warm -- 2
   ```

Notes:

* The function's `maxDuration` is 300 s. A video takes 10 to 30 s to build, and a feed request
  starts at most 5.
* Each function instance generates at most `STUDYTOK_GEN_CONCURRENCY` (default 2) videos at
  once. Vidmoat's per-key rate limit (600 requests a minute on Studio) is the real ceiling.
* A video whose function was cut off shows as failed after 6 minutes, and the feed moves on.
* Vercel serves over HTTPS, which the Vidmoat player requires (`parentOrigin` must be https).

### Keys

* **Vidmoat**: mint a key in the [console](https://developer.vidmoat.com/developer/apps) with
  `account.read projects.read projects.write media.write render.read stock.read`. A **test key is
  enough**: projects, edits, imports and the player are all real with a test key (only renders
  and AI generation are faked, and StudyTok uses neither). The key stays on the server; the
  browser only ever receives a project document.
* **Claude** (optional): set `ANTHROPIC_API_KEY` and every new video gets a freshly written
  lesson (default model `claude-opus-5-5` at `low` effort, structured output validated against
  `server/lessons/schema.js`). Without it, lessons come from `server/lessons/bank.js`
  (20 hand-written lessons, 2 per topic), and repeat once a topic's bank is used up.

## How it works

| File | What it does |
| --- | --- |
| `server/compose.js` | Lesson → Vidmoat commands. 9:16 canvas; hook, beats (key term + karaoke captions), quiz with timed answer reveal, takeaway; stock b-roll scaled to cover with a slow push-in and dissolves; music bed. Pure function, unit tested. |
| `server/media.js` | Free stock search, relevance ranking, import with a permanent cache. |
| `server/generator.js` | The pipeline above, behind a concurrency-limited queue. Checks each document is playable (absolute media URLs, under the player's 8 MB limit). |
| `server/feed.js` | Topic choice by interest weights with 15% exploration; library reuse; engagement → weights (complete +0.25, like +0.8, skip −0.15, "less" −1.5). |
| `server/lessons/` | Claude generator (structured outputs), offline bank, schema and sanitizer. |
| `server/kv.js`, `server/db.js` | Storage: Upstash Redis when configured, else a local file with the same commands. Counters use HINCRBY and memberships use sets, so concurrent serverless instances do not clobber each other. |
| `server/app.js`, `api/index.js` | The JSON API, shared by the local server and the Vercel Function. |
| `server/vidmoat.js` | REST client. Retries only 429/503 (and 502 on reads); never resends a POST, since the API has no idempotency key. |
| `public/player.js` | The `/embed/player` postMessage protocol: hello/ready handshake, document revisions, play/pause/seek, origin- and source-checked messages. |
| `public/app.js` | The feed: snap scrolling, live players only for the active slide ±1, polling generating videos, looping, events, keyboard (↑/↓/space). |

### Video anatomy (about 20 to 30 seconds)

1. **Hook** (3 s): a surprising true line, key phrase in the topic colour.
2. **Beats** (2 to 4): a big key term plus the explanation as karaoke captions at reading pace.
3. **Quick check**: three options; the right one lights up after 3 seconds.
4. **Remember**: the one-line takeaway. Then it loops.

## Notes and limits

* **Embedding origin.** The player requires `parentOrigin` to be https (http only on
  localhost), so deploy StudyTok behind HTTPS.
* **Vidmoat projects.** Each generated video is a real project on your Vidmoat account, so you
  can open it in the editor or render it later. Set `VIDMOAT_DELETE_PROJECTS=true` to delete
  them once the document is cached, or `VIDMOAT_WORKSPACE_ID` to file them in a workspace.
* **Rate limits.** Every generated video makes roughly 6 to 12 API calls (fewer once stock
  imports are cached). Studio and Team keys get 600 requests a minute, and
  `STUDYTOK_GEN_CONCURRENCY` caps parallel work.
* **No voiceover yet.** Narration via `POST /v1/ai/speech` (8+ credits per call) plus
  `POST /v1/ai/transcriptions` for word timings would slot into `generator.js` before
  `composeLesson`; captions can then use the real timings (`addCaptions` with `src`).
* **Sound.** Browsers allow sound only after a user gesture. Picking interests counts as one;
  a returning viewer may need to tap once.
