"use server";
// Everything the app writes: login, settings, a manual sync, ignoring a run.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { run, setSetting } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { sync } from "@/lib/sync";
import { COOKIE, sign } from "@/lib/session";
import { checkPassphrase, runalyzeToken, setPassphrase, setRunalyzeToken } from "@/lib/secrets";
import { Runalyze } from "@/lib/runalyze";
import { settings } from "@/lib/views";
import { parseTime } from "@/lib/engine/zones";

export async function login(_: unknown, form: FormData): Promise<{ error: string } | void> {
  if (!(await checkPassphrase(String(form.get("passphrase") ?? "")))) return { error: "That passphrase doesn't match." };
  const s = await sign();
  // https-only in production, except under run.sh, which serves plain http on the Wi-Fi
  const secure = process.env.NODE_ENV === "production" && process.env.COOKIE_INSECURE !== "1";
  (await cookies()).set(COOKIE, s.value, { httpOnly: true, secure, sameSite: "lax", maxAge: s.maxAge, path: "/" });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}

export async function syncNow() {
  await sync();
  revalidatePath("/", "layout");
}

export async function setIgnored(id: number, ignored: boolean) {
  await run("UPDATE runs SET ignored=? WHERE id=?", [ignored ? 1 : 0, id]);
  revalidatePath("/", "layout");
}

export async function saveSettings(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const { plan, profile } = await settings();
  const num = (k: string, lo: number, hi: number) => {
    const v = Number(form.get(k));
    if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k} must be between ${lo} and ${hi}`);
    return v;
  };
  try {
    const target = String(form.get("target") ?? "").trim();
    if (!parseTime(target)) throw new Error("Target time reads like 1:59 or 1:58:30");
    const date = String(form.get("date") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Race date is missing");
    const weekStartDow = num("weekStartDow", 0, 6), longRunDow = num("longRunDow", 0, 6);
    const from = String(form.get("blockStart") ?? plan.blockStart);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Block start is missing");
    // week 1 starts on the chosen first day of the week, on or before the given date
    const back = (new Date(`${from}T12:00:00Z`).getUTCDay() - weekStartDow + 7) % 7;
    const blockStart = addDays(from, -back);
    if (blockStart >= date) throw new Error("The block has to start before the race");
    await setSetting("plan", { ...plan,
      race: { label: String(form.get("label") ?? plan.race.label).slice(0, 60), date, km: num("km", 3, 50), target },
      blockStart, weekStartDow, longRunDow,
      longMaxKm: num("longMaxKm", 8, 35), volumeHoldKm: num("volumeHoldKm", 10, 120) });
    await setSetting("profile", { ...profile, lthr: num("lthr", 100, 220) });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setTheme(theme: "auto" | "light" | "dark") {
  const c = await cookies();
  if (theme === "auto") c.delete("theme");
  else c.set("theme", theme, { maxAge: 365 * 86_400, path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function saveToken(_: unknown, form: FormData): Promise<{ error?: string; ok?: string }> {
  const token = String(form.get("token") ?? "").trim();
  if (token.length < 16) return { error: "That doesn't look like a Runalyze token." };
  try {
    await new Runalyze(token).call("get_calculations");      // test before saving
  } catch (e) {
    return { error: `Runalyze refused it: ${(e as Error).message}` };
  }
  await setRunalyzeToken(token);
  revalidatePath("/settings");
  return { ok: "Saved and tested: Runalyze answered." };
}

export async function testToken(): Promise<{ error?: string; ok?: string }> {
  try {
    const c = await new Runalyze((await runalyzeToken()).token).call<{ effectiveVO2max: number }>("get_calculations");
    return { ok: `Connected: Runalyze answered (VO₂max ${c.effectiveVO2max.toFixed(1)}).` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function changePassphrase(_: unknown, form: FormData): Promise<{ error?: string; ok?: string }> {
  const current = String(form.get("current") ?? ""), next = String(form.get("next") ?? ""), again = String(form.get("again") ?? "");
  if (!(await checkPassphrase(current))) return { error: "The current passphrase doesn't match." };
  if (next.length < 12) return { error: "Use at least 12 characters." };
  if (next !== again) return { error: "The two new passphrases differ." };
  await setPassphrase(next);
  return { ok: "Changed. Use the new passphrase next time you sign in." };
}

export async function saveTimeZone(form: FormData) {
  const tz = String(form.get("tz") ?? "");
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { return; }
  await setSetting("tz", tz);
  revalidatePath("/", "layout");
}
