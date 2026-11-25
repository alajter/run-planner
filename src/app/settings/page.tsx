import { settings } from "@/lib/views";
import { lastSync } from "@/lib/sync";
import { passphraseSource, runalyzeToken, timeZone, type Source } from "@/lib/secrets";
import { PassphraseForm, SettingsForm, TimeZoneForm, TokenForm } from "../client";
import { logout } from "../actions";

export const dynamic = "force-dynamic";

const FROM: Record<Source, string> = { settings: "saved here", environment: "from the server environment", missing: "not set" };

export default async function Settings() {
  const { plan, profile } = await settings();
  const last = await lastSync();
  const tok = await runalyzeToken();
  const pass = await passphraseSource();
  const tz = await timeZone();
  const db = process.env.TURSO_DATABASE_URL;
  const set = (v?: string, min = 1) => ((v ?? "").length >= min ? "set" : "missing");
  return (
    <main>
      <h1>Settings</h1>

      <SettingsForm v={{ label: plan.race.label, date: plan.race.date, km: plan.race.km, target: plan.race.target,
        longMaxKm: plan.longMaxKm, volumeHoldKm: plan.volumeHoldKm, lthr: profile.lthr,
        blockStart: plan.blockStart, weekStartDow: plan.weekStartDow, longRunDow: plan.longRunDow ?? plan.weekStartDow }} />

      <section className="card stack">
        <h2>Runalyze</h2>
        <TokenForm status={tok.token ? `Token ${FROM[tok.source]}, ending …${tok.token.slice(-4)}.${tok.source === "settings" ? " Stored encrypted." : " Paste it here to keep it in the app instead."}` : "No token yet."} />
        <span className="small muted">Last sync: {last ? new Date(last).toLocaleString("en-GB", { timeZone: tz.tz }) : "never"}. A sync runs every evening.</span>
      </section>

      <section className="card stack">
        <h2>Time zone</h2>
        <span className="small muted">Decides what &ldquo;today&rdquo; is. Now {FROM[tz.source]}.</span>
        <TimeZoneForm tz={tz.tz} zones={Intl.supportedValuesOf("timeZone")} />
      </section>

      <section className="card stack">
        <h2>Sign-in</h2>
        <PassphraseForm status={`Passphrase ${FROM[pass]}. Saved here as a hash, never in clear; once saved here it replaces the environment one.`} />
        <form action={logout}><button className="btn">Sign out</button></form>
      </section>

      <section className="card stack small">
        <h2>Server (set in Vercel, not here)</h2>
        <dl className="reads">
          <div><dt>Database</dt><dd>{db ? `Turso · ${new URL(db.replace(/^libsql:/, "https:")).host}` : "local file (development)"}</dd></div>
          <div><dt>Session secret</dt><dd>{set(process.env.SESSION_SECRET, 32)}</dd></div>
          <div><dt>Cron secret</dt><dd>{set(process.env.CRON_SECRET, 16)}</dd></div>
        </dl>
        <span className="muted">These three are read before the app can open its database or check a sign-in, so they live in the
          server&apos;s environment. Changing the session secret signs you out and makes the saved token unreadable (it falls back to the environment).</span>
      </section>
    </main>
  );
}
