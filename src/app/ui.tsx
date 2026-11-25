// Small shared pieces for the pages.
import Link from "next/link";
import { addDays, dateShort, dow } from "@/lib/dates";
import { fmtPace } from "@/lib/engine/zones";
import type { Paces } from "@/lib/engine/zones";
import type { DaySession } from "@/lib/views";

export const KIND: Record<string, string> = {
  long: "Long run", easy: "Easy run", interval: "Intervals", tempo: "Half-marathon pace", race: "Race", rest: "Rest",
};

/** What a session asks for, in one line. */
export function target(kind: string, easyCeiling: number, paces: Paces | null): string {
  if (kind === "interval") return paces ? `3-min reps at ${fmtPace(paces.interval)}/km, 2 min jog between` : "3-min reps, hard";
  if (kind === "tempo") return paces ? `10-min reps at ${fmtPace(paces.half)}/km, 2 min jog between` : "10-min reps at half-marathon pace";
  if (kind === "race") return paces ? `Start at ${fmtPace(paces.half)}/km` : "Race";
  return `≤ ${easyCeiling} bpm`;
}

export function steps(kind: string, km: number, strides: boolean): string[] {
  const out: string[] = [];
  if (kind === "interval" || kind === "tempo") {
    out.push("2 km easy warm-up");
    const reps = kind === "interval" ? Math.max(3, Math.round((km - 3.5) / 0.7)) : Math.max(2, Math.round((km - 3.5) / 2.0));
    out.push(kind === "interval" ? `${reps} × 3 min hard, 2 min jog` : `${reps} × 10 min at half-marathon pace, 2 min jog`);
    out.push("1.5 km easy cool-down");
  }
  if (strides) out.push("4–6 strides of ~20 s after the run, walk back between");
  return out;
}

export function DayLine({ d, easyCeiling, paces, today }: { d: DaySession; easyCeiling: number; paces: Paces | null; today: string }) {
  const mark = d.status === "missed" ? <span className="dot warn" role="img" aria-label="missed" /> : null;
  return (
    <div className={`day${d.date === today ? " today" : ""}`}>
      <span className="muted small">{dow(d.date)} {Number(d.date.slice(8))}</span>
      <span>
        {mark} {KIND[d.kind]} {d.km} km{d.strides ? " + strides" : ""}
        <span className="muted small"> · <span className={target(d.kind, easyCeiling, paces).length <= 16 ? "nw" : undefined}>{target(d.kind, easyCeiling, paces)}</span></span>
      </span>
      <span className="small num">{d.ran ? <Link href={`/runs/${d.ran.id}`}>{d.ran.strides
        ? `${Math.round((d.ran.km - d.ran.strides) * 10) / 10} + ${d.ran.strides} km ›` : `${d.ran.km} km ›`}</Link> : ""}</span>
    </div>
  );
}

export { dateShort, dow };

/** Why a week is the size it is: every limit it was checked against, the one that holds it first. */
export function Limits({ limits, binding, note }: { limits: import("@/lib/engine/plan").Limit[]; binding: string; note?: string | null }) {
  const sorted = [...limits].sort((a, b) => Number(b.holds) - Number(a.holds));
  const held = limits.find(l => l.holds);
  return (
    <div className="stack mt-2">
      <h2 className="flush">Why this week looks like this</h2>
      <span className="small">{held ? `Held by ${held.name.toLowerCase()}: ${held.value} of ${held.ceiling} ${held.unit}.` : `Set by ${binding}.`}{note ? ` ${note}` : ""}</span>
      {sorted.map(l => {
        const over = l.value > l.ceiling + 1e-6;
        const warn = !over && l.warnAt != null && l.value > l.warnAt;
        const pct = Math.min(100, (100 * l.value) / (l.ceiling || 1));
        return (
          <details key={l.key} className="limit">
            <summary className="between small">
              <span>{l.name}{l.holds && <span> · holds the week</span>}{warn && <span className="warn"> · above {l.warnAt}</span>}</span>
              <span className="num muted">{l.value} of {l.ceiling} {l.unit}</span>
            </summary>
            <div className="lbar"><span style={{ width: `${pct}%`, background: over ? "var(--bad)" : warn ? "var(--warn)" : l.holds ? "var(--text)" : "var(--muted)" }} /></div>
            <span className="small muted">{over ? `over by ${(l.value - l.ceiling).toFixed(2)}` : `${(l.ceiling - l.value).toFixed(l.unit === "×" ? 2 : 1)} to spare`} · {l.why}</span>
          </details>);
      })}
    </div>);
}

/** The week at a glance: seven cells, run days filled once run, today marked with the now square. */
export function WeekStrip({ start, days, today }: { start: string; days: DaySession[]; today: string }) {
  const cells = [...Array(7)].map((_, i) => { const date = addDays(start, i); return { date, d: days.find(x => x.date === date) ?? null }; });
  return (
    <ol className="wstrip" aria-label="This week">
      {cells.map(({ date, d }) => {
        const state = !d ? "rest" : d.status === "done" ? "done" : d.status === "missed" ? "missed" : "planned";
        const label = `${dow(date)} ${Number(date.slice(8))}: ${d ? `${KIND[d.kind]} ${d.km} km${d.ran ? `, ran ${d.ran.km} km` : d.status === "missed" ? ", missed" : ""}` : "rest"}`;
        return (
          <li key={date} className={`wcell ${state}${date === today ? " is-today" : ""}`} aria-current={date === today ? "date" : undefined}>
            <span className="sr-only">{label}</span>
            <span className="wday" aria-hidden="true">{dow(date).slice(0, 2)}</span>
            <span className="wbox num" aria-hidden="true">{d ? (d.ran ? d.ran.km : d.km) : <span className="wrest">rest</span>}{state === "missed" && <span className="dot warn" />}</span>
          </li>);
      })}
    </ol>);
}

type MetricView = { key: string; name: string; unit: string; now: number | null; before: number | null; better: "down" | "up"; digits: number; series: (number | null)[]; note: string; why: string | null };
const fmtN = (x: number, d: number) => x.toFixed(d);

/** The four progress signals at a glance: now (last 4 weeks) and the change on the 4 weeks before. */
export function ProgressStats({ metrics }: { metrics: MetricView[] }) {
  return (
    <dl className="pstats">
      {metrics.map(m => {
        const ch = m.now != null && m.before != null ? m.now - m.before : null;
        const worse = ch != null && Math.abs(ch) >= 0.5 * 10 ** -m.digits && (m.better === "down" ? ch > 0 : ch < 0);
        return (
          <div key={m.key}>
            <dt>{m.name}</dt>
            <dd className="big fig num">{m.now != null ? fmtN(m.now, m.digits) : "—"}{m.unit && <span className="unit"> {m.unit}</span>}</dd>
            <dd className={`small ${worse ? "warn" : "muted"}`}>{ch == null ? (m.why ?? "no earlier weeks")
              : `${ch > 0 ? "+" : ch < 0 ? "−" : "±"}${fmtN(Math.abs(ch), m.digits)} vs prior 4 weeks`}</dd>
          </div>);
      })}
    </dl>);
}
