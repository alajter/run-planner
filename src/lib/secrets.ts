// Settings that used to live only in .env.local, editable in the app: the Runalyze token (encrypted
// at rest with a key derived from SESSION_SECRET), the passphrase (a scrypt hash, never stored in
// clear) and the time zone. The environment stays the fallback, so a fresh deploy works before any
// of these are set. The database URL/token, SESSION_SECRET and CRON_SECRET cannot move here: the app
// needs them before it can read the database, and Vercel's scheduler reads CRON_SECRET itself.
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getSetting, run, setSetting } from "./db";
import { setTz } from "./dates";
import { passphraseOk } from "./session";

function key(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return createHash("sha256").update(`secrets:${s}`).digest();
}

export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map(b => b.toString("base64")).join(".");
}

export function decrypt(blob: string): string | null {
  try {
    const [iv, tag, body] = blob.split(".").map(x => Buffer.from(x, "base64"));
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null;   // a changed SESSION_SECRET: the stored value can't be read, the environment takes over
  }
}

export type Source = "settings" | "environment" | "missing";

export async function runalyzeToken(): Promise<{ token: string | null; source: Source }> {
  const blob = await getSetting<string | null>("secret:runalyze_token", null);
  const stored = blob ? decrypt(blob) : null;
  if (stored) return { token: stored, source: "settings" };
  const env = process.env.RUNALYZE_TOKEN || null;
  return { token: env, source: env ? "environment" : "missing" };
}

export async function setRunalyzeToken(token: string | null) {
  if (token) await setSetting("secret:runalyze_token", encrypt(token));
  else await run("DELETE FROM settings WHERE key='secret:runalyze_token'");
}

export async function passphraseSource(): Promise<Source> {
  if (await getSetting<string | null>("passphrase_hash", null)) return "settings";
  return (process.env.APP_PASSPHRASE ?? "").length >= 12 ? "environment" : "missing";
}

export async function checkPassphrase(given: string): Promise<boolean> {
  const stored = await getSetting<string | null>("passphrase_hash", null);
  if (!stored) return passphraseOk(given);
  const [salt, hash] = stored.split(":").map(x => Buffer.from(x, "hex"));
  const got = scryptSync(given, salt, hash.length);
  return timingSafeEqual(got, hash);
}

export async function setPassphrase(p: string) {
  const salt = randomBytes(16);
  await setSetting("passphrase_hash", `${salt.toString("hex")}:${scryptSync(p, salt, 32).toString("hex")}`);
}

export async function timeZone(): Promise<{ tz: string; source: Source }> {
  const stored = await getSetting<string | null>("tz", null);
  const tz = stored || process.env.ATHLETE_TZ || "UTC";
  setTz(tz);
  return { tz, source: stored ? "settings" : process.env.ATHLETE_TZ ? "environment" : "missing" };
}
