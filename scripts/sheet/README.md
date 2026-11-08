# Google Sheet mirror

StudyTok can keep a Google Sheet up to date with every student, every join and a daily summary,
so the people running it can watch it grow without a database or an admin panel. The data lives
in the app's own storage (Upstash Redis); the sheet is a mirror written by `server/core/sheet.js`.

Nothing here is required. Without `STUDYTOK_SHEET_URL` the mirror is off.

## Tabs

| Tab | One row per | Written when |
|---|---|---|
| **Users** | student (keyed by User ID, sorted by member number) | sign-in, profile saved, account connected or disconnected, and after a batch of events, at most every 10 minutes per student |
| **Joins** | event: `joined`, `set up`, `signed in again`, `connected own account`, `disconnected own account`, `level up` | as it happens |
| **Daily** | day: new / total / active students, lessons watched, completions, quiz accuracy, likes, saves, shares, drops, library size | by the daily cron (yesterday and today) |

The Users columns: member number, name and email from Vidmoat sign-in, joined and last seen,
level, country, institution, course, exam, age and who manages the profile, counts of courses and
units, interests, lessons watched, minutes watched, sessions, active days, day streak, quizzes
and accuracy, units mastered, likes, saves, shares, billing mode, free lessons used, own-account
connection, own credits and plan, billing problem, device (installed app or browser), platform,
time zone, language, and when the row was last updated. New columns added to the row in
`userRow()` appear on the right automatically.

## Setup (once, about three minutes)

1. Create a Google Sheet (any name). Open **Extensions → Apps Script**.
2. Replace the editor's contents with [`Code.gs`](Code.gs). Set `SECRET` to a long random string
   (for example the output of `openssl rand -hex 24`). Save.
3. **Deploy → New deployment → Web app.** *Execute as:* **Me**. *Who has access:* **Anyone**.
   Authorize when asked. Copy the **Web app URL** (ends in `/exec`).
4. Set two environment variables on the server (Vercel → Settings → Environment Variables) and
   redeploy:
   - `STUDYTOK_SHEET_URL` = the web app URL
   - `STUDYTOK_SHEET_SECRET` = the same secret
5. Fill the sheet with the students who already exist:
   ```bash
   curl -X POST https://studytok.vidmoat.com/api/admin/sheet/resync -H "Authorization: Bearer $STUDYTOK_SHEET_SECRET"
   ```
   It answers `{ ok, users, sent }`. Students who joined before the `users` index existed are
   added the next time they open the app.

"Anyone" means anyone who knows the URL can call the script, which is why every request carries
the secret and the script refuses without it. The script runs as you and can only touch the one
spreadsheet it is bound to.

## Changing the script

After editing `Code.gs` in the Apps Script editor choose **Deploy → Manage deployments → Edit →
Version: New version**. The URL stays the same.

## Privacy

The sheet holds the same personal data the app already stores (name and email from Vidmoat,
the profile a student entered) plus their usage counts. Share it as you would the database.
A student's deletion request (docs/FAQ.md, "Can I delete my data?") covers their row too.
