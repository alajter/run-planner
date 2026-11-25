# Deploying Run Planner (free)

Two free services: **Vercel** hosts the app and runs the daily sync, **Turso** holds the database (libSQL, the same
SQL as the local `local.db`). Nothing else is needed: no paid plan, no other accounts. Plan for about 20 minutes.

| What | Service | Plan | Why it fits |
|---|---|---|---|
| App, API, daily sync | [Vercel](https://vercel.com) | Hobby (free, personal use) | Next.js runs as is; one cron job a day is what the Hobby plan allows, and the app needs exactly one |
| Database | [Turso](https://turso.tech) | Free | One small database: a year of runs, the plan and a few settings are a few thousand rows |

Free-tier limits change: check [vercel.com/docs/limits](https://vercel.com/docs/limits) and
[turso.tech/pricing](https://turso.tech/pricing) before you rely on a number. This app stays far below both: one sync
a day, one database, one user.

## What you need first

- A GitHub account with this repository (private is fine).
- Your **Runalyze personal API token**: Runalyze → Settings → Personal API.
- A terminal with Node 20+ and this repo checked out, with `npm install` done.

## 1. Create the database (Turso)

**Everything in one dashboard (option).** You can also add Turso from inside Vercel: the project → **Storage** →
browse the Marketplace for **Turso**, create a database and connect it to this project. Vercel then creates the Turso
account for you and adds the database URL and token to the project's environment variables. Check their names in
Settings → Environment Variables: the app reads `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, so add copies under
those names if the integration used others. If you go this way, skip the CLI steps below and take the two values from
Vercel for step 4.

Why a database and not JSON files: on Vercel the app runs as serverless functions whose disk is temporary and not
shared, so a file written by the nightly sync would be gone by the next request.

With the Turso CLI:

```bash
brew install tursodatabase/tap/turso      # or: curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup                          # first time (opens the browser); later: turso auth login
turso db create run-planner                # pick the location nearest to you if asked
turso db show run-planner --url            # → libsql://run-planner-<you>.turso.io   = TURSO_DATABASE_URL
turso db tokens create run-planner         # → a long token                          = TURSO_AUTH_TOKEN
```

Keep the URL and the token for step 3. The app creates its own tables on the first request; there is no migration
to run.

## 2. Make the secrets

```bash
openssl rand -hex 32    # SESSION_SECRET  (signs the login cookie, encrypts a token saved in Settings)
openssl rand -hex 24    # CRON_SECRET     (Vercel sends it to /api/cron/sync)
```

Choose a **passphrase** of 12+ characters for `APP_PASSPHRASE`. It is the only login. You can change it later in
Settings → Sign-in; the app then keeps a hash and ignores this variable.

## 3. Deploy on Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import** the GitHub repository. Framework: Next.js (detected). Leave
   the build settings as they are.
2. Before the first deploy, open **Environment Variables** and add, for **Production** (and Preview if you use it):

   | Name | Value |
   |---|---|
   | `RUNALYZE_TOKEN` | your Runalyze token |
   | `APP_PASSPHRASE` | your passphrase (12+ characters) |
   | `SESSION_SECRET` | from step 2 |
   | `CRON_SECRET` | from step 2 |
   | `ATHLETE_TZ` | your time zone, e.g. `Europe/Lisbon` (decides what "today" is) |
   | `TURSO_DATABASE_URL` | from step 1 |
   | `TURSO_AUTH_TOKEN` | from step 1 |

3. **Deploy.** The site is at `https://<project>.vercel.app`. Open it and sign in with the passphrase.

`vercel.json` already holds the cron job: `0 20 * * *`, every day at 20:00 UTC (on Hobby it fires some time within
that hour). Vercel adds `Authorization: Bearer $CRON_SECRET` to the call by itself.

## 4. Fill the database once, from your machine

A serverless call has a time limit, and the first sync reads a year of runs and analyses each one, which takes a few
minutes. Run it locally against Turso; the shell variables win over `.env.local`:

```bash
TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… npm run sync -- --full
```

`.env.local` must hold the same `RUNALYZE_TOKEN`. After this, the daily cron only reads the last two weeks, which
fits easily in one call. The **Sync** button on Today runs the same sync on demand.

## 5. Check it works

- **Today** shows readiness, the week strip and the race prediction.
- **Settings → Runalyze → Test connection** answers with your VO₂max.
- **Settings → Server** shows `Turso · <your database host>` and both secrets as `set`.
- The next day, **Settings → Runalyze** shows a last-sync time around 20:00 UTC. In Vercel → the project → **Cron
  Jobs**, the job is listed and can be run once by hand (**Run**).

## 6. On the phone

Open the site in Safari → Share → **Add to Home Screen**. It opens full screen like an app.

## Later

- **Changing a secret.** Edit it in Vercel → Settings → Environment Variables, then **Redeploy**. Changing
  `SESSION_SECRET` signs you out, and a Runalyze token saved in Settings can no longer be read, so the app falls back
  to `RUNALYZE_TOKEN`.
- **A new Runalyze token.** Paste it in Settings → Runalyze (tested before it is saved, stored encrypted), or update
  `RUNALYZE_TOKEN` and redeploy.
- **Backups.** `turso db shell run-planner .dump > backup.sql` saves everything; the data can always be re-synced
  from Runalyze, except the frozen plan days and your settings.
- **Logs.** Vercel → the project → **Logs** shows each sync's result; Settings → Runalyze shows the last sync time.

## If something goes wrong

| Symptom | Cause and fix |
|---|---|
| Sign-in says the passphrase doesn't match | `APP_PASSPHRASE` is under 12 characters or differs; set it and redeploy |
| Every page sends you back to sign in | `SESSION_SECRET` missing or under 32 characters |
| "SESSION_SECRET must be set" in the logs | the same: add it and redeploy |
| Empty Today, no runs | step 4 not run yet, or `RUNALYZE_TOKEN` wrong (Settings → Test connection) |
| Cron Jobs shows 401 | `CRON_SECRET` in Vercel differs from the one the deploy was built with: redeploy after changing it |
| Turso queries fail with `BLOCKED` | a free-plan quota was exceeded: check usage with `turso plan show` |
| "Today" is a day off | `ATHLETE_TZ`, or the time zone in Settings, is wrong |
