# Credits and billing

StudyGraph runs on Vidmoat, and every new video spends Vidmoat credits (speech, transcription).
The model is freemium:

1. **Free allowance (house).** Every student's first `STUDYTOK_FREE_VIDEOS` (default 15)
   videos are made on StudyGraph's own API key. Only videos a student *triggers* count: watching
   the shared library is free, and the cron top-up never counts against anyone.
2. **Their own Vidmoat account (own).** From the Profile (or the end-of-feed prompt once the
   allowance is used up) a student taps *Use my Vidmoat account*. That runs the same OAuth
   flow with the generation scopes, and from then on every video they trigger is made on their
   account, with their credits. The library stays shared: a video made on one student's credits
   serves everyone on that unit.
3. **Out of credits.** Vidmoat answers `402 insufficient_credits`; StudyGraph records it, pauses
   that student's generation for 10 minutes, and the app shows *Buy credits or upgrade*
   (`STUDYTOK_VIDMOAT_BILLING_URL`, default https://www.vidmoat.com/pricing). A positive balance
   on the next `/v1/me` check clears it. `402 plan_required` (speech needs Creator or above)
   shows an upgrade prompt instead; `401` asks them to reconnect.

Everything already in the library keeps playing whatever a student's balance is: the feed
falls back to ready videos for their level and says why new ones are paused.

## Scopes

| Purpose | Scope | Why |
| --- | --- | --- |
| Sign in (identity) | `account.read` | name and email, tokens discarded |
| Use my account (generate) | `account.read projects.read projects.write media.write stock.read ai.speech ai.transcribe` | create the project, import stock clips, narrate and time the narration |

Never requested: `render.*` (nothing is ever rendered or exported), `ai.image`, `ai.video`,
`ai.agent`, `speech.*` (Speech Lab voices), `cast.*`, `social.*`.

## Tokens

* Access tokens last an hour and refresh tokens 90 days (rotating). `core/billing.js ownToken`
  refreshes a token two minutes before it expires, under a short lock so concurrent
  generations do not both refresh.
* Tokens are sealed with AES-256-GCM before they are stored on the user record
  (`vidmoatTokens`), keyed by `STUDYTOK_TOKEN_SECRET` (set one in production; without it a
  key is derived from the OAuth client secret and a warning is logged). `/api/me` never returns
  them. *Disconnect* deletes them.
* `core/vidmoat.js withCredential(token, fn)` makes every Vidmoat call inside `fn` use that
  token (AsyncLocalStorage), so the generator does not pass credentials through every module.

## Data

`user.billing = { mode: 'house'|'own', houseUsed, connectedAt, problem: null|'exhausted'|'plan'|'reconnect', exhaustedAt, lastCredits, lastCreditsAt, plan }`.
Each video records `paidBy: 'house'|'own'` and, when it failed for a billing reason,
`errorCode`.

## API

| Route | What |
| --- | --- |
| `GET /api/auth/vidmoat/connect` | starts the generate-scope consent (must be signed in; the account must match) |
| `GET /api/auth/vidmoat/callback` | shared with sign-in; `?auth=connected`, `mismatch` or `scopes` on return |
| `POST /api/billing/mode` `{ mode }` | switch between `house` (while allowance remains) and `own` |
| `POST /api/billing/disconnect` | drop the tokens, back to the allowance |
| `GET /api/me` → `user.billing` | mode, allowance used/left, connected, problem, cached balance and plan, billing URL |
| `GET /api/feed` → `credits` | `{ needed, reason, unit }` when a new video could not be started for this student |

## Settings

```
STUDYTOK_FREE_VIDEOS=15
STUDYTOK_TOKEN_SECRET=            # long random string; seals stored OAuth tokens
STUDYTOK_VIDMOAT_BILLING_URL=https://www.vidmoat.com/pricing
```
