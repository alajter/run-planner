# Run Planner

My half-marathon plan, my runs from Runalyze, and my progress. One runner, one race, phone first.

Inspired by [Sparing Horse](https://github.com/dros74/sparinghorse) by Duarte Rosado; independent TypeScript implementation; the readiness model comes from run-coach. The load ratio and several of its constants come from Sparing Horse: the 1.25 ceiling, fitness counted as at least 45, the 6 % allowance over the last full week, and the TRIMP rates per training zone. Sparing Horse is licensed AGPL-3.0.

## The problem

The earlier versions did too much. [run-coach](https://github.com/Andrel666/run-coach) had chat, generated plans, recovery, gait analysis and strength work, and a generated plan cannot show why a week has the size it has. What I needed each day was smaller: the session, whether I am ready for it, and whether the race goal still holds.

## Who it is for

One runner: me, building to one half marathon. Every rule below is tuned for that.

## How it got here

Before this, I used Sparing Horse, a self-hosted planner built on Runalyze, in my own fork. I added settings to protect my calves (a longest long run, a volume hold, when a fourth run joins) and a simpler interface. Then I rebuilt the parts I actually used as a small Next.js app that runs free on Vercel, and moved my readiness score over from run-coach.

## Decisions

- **Rules instead of AI.** The plan is plain code with the rules in one table below. Each week shows every limit it was checked against and which one set its size.
- **The plan follows what was run.** Weeks already run are read from Runalyze, not from the plan, so a missed or short week lowers the next ones.
- **Narrow on purpose.** One race, one runner, four tabs. No chat, no video analysis, no strength library.
- **Free to run.** Vercel Hobby for the app and one daily sync, Turso for the database.

## What it shows

- **Today**: the session, readiness (a 0–100 score from sleep, HRV, resting HR and yesterday's load, ported from run-coach), this week, the race prediction.
- **Plan**: every week to race day, each sized from what was actually run.
- **Runs**: the log with beats per km; each run's debrief (an easy run that ends with strides is judged on its easy part).
- **Progress**: beats per km, VO₂max, weekly km, Runalyze's fitness and prediction.

## The plan's rules (`src/lib/engine/plan.ts`)

| Rule | Value |
|---|---|
| Long run | at most +10 % over the longest of the last 4 weeks, never over the longest-run setting (16 km) |
| Week size | the long run is 42 % of a 3-run week, 45 % of a 4-run week; at most +12 % over the biggest of the last 4 weeks |
| Load ratio | the week's mean fatigue over its mean fitness (TRIMP, 7- and 42-day averages, all sports), fitness counted as at least 45: over 1.25 the easy runs are trimmed, unless the week is within +6 % of the last full week's load |
| Volume hold | weeks stay at or under 30 km until 3 of the last 4 reached 95 % of it |
| Down weeks | every 4th week of Base and Build: 80 % of the week, 70 % of the long run, no strides |
| Phases | Base 45 %, Build 40 %, Peak the rest, Taper 3 weeks (2 if the block is under 16 weeks) |
| Runs | Sun long, Tue, Thu; a Saturday run joins once the long run reaches 12 km |
| Quality | one mid-week session from Build week 2, alternating 3-min intervals and 10-min half-marathon-pace reps |
| Easy runs | at least 4 km, at most 85 % of the long run; strides on the last easy run of the week |
| Taper | 75 %, 60 %, 45 % of the peak week; long run 50 %, 38 %, 26 % of the peak long run |
| Easy effort | ≤ 85 % of lactate-threshold HR (171 → 145 bpm) |

Weeks already run are read from the runs, so a missed or short week lowers the next ones.

Readiness (`src/lib/engine/readiness.ts`): sleep 40 % (duration, deep, REM, awake), HRV 30 % (+10 % on the 28-day average = 100, −20 % = 0), resting HR 20 % (−3 bpm = 100, +5 = 0), yesterday's TRIMP against a usual day 10 %. 70+ good to go, 40–69 go easier (no strides), under 40 rest.

## Run locally

```bash
cp .env.example .env.local   # fill in RUNALYZE_TOKEN, APP_PASSPHRASE, SESSION_SECRET, CRON_SECRET
npm install
npm run sync -- --full       # first time: a year of runs, each one analysed (~3 min)
npm run dev                  # http://localhost:3000
npm test                     # engine tests
```

## On your phone, at home

`./run.sh` builds the app and serves it on your Wi-Fi; it prints the address to open on any phone on the same
network (`./run.sh --sync` pulls from Runalyze first). It is plain http, so keep it to your home network.

## Deploy (free)

Vercel (Hobby) for the app and the daily sync, Turso (free) for the database. Step by step, with the
environment variables and the first sync: [docs/DEPLOY.md](docs/DEPLOY.md).

## The series

Four attempts at the same question for the same runner (me): what should I run today, and is the plan still right?

1. [runalyze-scriptable](https://github.com/Andrel666/runalyze-scriptable) (2022). An iOS home-screen widget with my Runalyze numbers.
2. [run-radar](https://github.com/Andrel666/run-radar) (Nov 2025 to Jan 2026). Run analytics plus sleep, and a morning readiness score.
3. [run-coach](https://github.com/Andrel666/run-coach) (Mar 2026). A broad AI coach: chat, generated plans, recovery from Apple Health, gait analysis from video.
4. [run-planner](https://github.com/Andrel666/run-planner) (Nov 2026). Narrowed to one runner and one race, with plan rules you can read and test instead of AI.
