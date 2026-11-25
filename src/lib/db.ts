// One database: Turso (libSQL) in production, a local SQLite file in development. Same SQL both ways.
import { createClient, type Client, type InValue } from "@libsql/client";

let client: Client | null = null;
let migrated: Promise<void> | null = null;

export function db(): Client {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL || "file:local.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

const SCHEMA = [
  // runs as Runalyze reports them, plus the run's own analysis once read from its streams
  `CREATE TABLE IF NOT EXISTS runs (
     id INTEGER PRIMARY KEY, date TEXT NOT NULL, datetime TEXT, title TEXT, type TEXT,
     km REAL NOT NULL, sec INTEGER NOT NULL, hr REAL, hr_max REAL, vo2 REAL, trimp REAL,
     cadence REAL, decoupling REAL, temp REAL, ignored INTEGER NOT NULL DEFAULT 0,
     analysis TEXT, analyzed_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS runs_date ON runs(date)`,
  // overnight markers: hrv, rhr, sleep (minutes) — one value per kind per day
  `CREATE TABLE IF NOT EXISTS markers (kind TEXT NOT NULL, date TEXT NOT NULL, value REAL NOT NULL,
     PRIMARY KEY (kind, date))`,
  // other sports (strength, cycling…): only their TRIMP, which counts toward fitness and fatigue
  `CREATE TABLE IF NOT EXISTS loads (id INTEGER PRIMARY KEY, date TEXT NOT NULL, sport TEXT, trimp REAL)`,
  // the night's sleep stages (minutes), dated by the morning it ended; the longest entry of the night
  `CREATE TABLE IF NOT EXISTS nights (date TEXT PRIMARY KEY, total REAL NOT NULL, deep REAL, rem REAL, light REAL, awake REAL)`,
  // Runalyze's own calculations and prognosis, one snapshot a day
  `CREATE TABLE IF NOT EXISTS snapshots (date TEXT PRIMARY KEY, calc TEXT NOT NULL, prognosis TEXT)`,
  // settings and the goal, as key → JSON
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // the plan as built: one row per day
  `CREATE TABLE IF NOT EXISTS plan (date TEXT PRIMARY KEY, kind TEXT NOT NULL, km REAL, strides INTEGER NOT NULL DEFAULT 0,
     note TEXT, week TEXT NOT NULL, built_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sync_log (at TEXT PRIMARY KEY, ok INTEGER NOT NULL, summary TEXT)`,
];

export async function ready(): Promise<Client> {
  const c = db();
  if (!migrated) migrated = c.batch(SCHEMA, "write").then(() => undefined);
  await migrated;
  return c;
}

export async function all<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T[]> {
  const c = await ready();
  const r = await c.execute({ sql, args });
  return r.rows.map(row => ({ ...row }) as T);
}

export async function one<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T | null> {
  return (await all<T>(sql, args))[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []) {
  const c = await ready();
  return c.execute({ sql, args });
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await one<{ value: string }>("SELECT value FROM settings WHERE key=?", [key]);
  return r ? (JSON.parse(r.value) as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, JSON.stringify(value)]);
}
