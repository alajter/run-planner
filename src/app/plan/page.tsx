import Link from "next/link";
import { planView } from "@/lib/views";
import { RULES } from "@/lib/engine/plan";
import { dateShort, DayLine, Limits } from "../ui";
import { WeekBars } from "../charts";

export const dynamic = "force-dynamic";

export default async function Plan() {
  const v = await planView();
  const peak = Math.max(...v.weeks.map(w => w.km));
  return (
    <main>
      <div className="top"><h1>Plan · {v.settings.race.label}</h1><Link href="/settings">Settings</Link></div>
      <section className="card stack">
        <div className="between"><h2>Planned and run</h2><span className="small muted"><span className="num">{Math.round((v.progress.ranKm - v.progress.stridesKm) * 10) / 10} of {v.progress.askedKm} km</span> asked so far</span></div>
        <WeekBars weeks={v.weeks.map(w => ({ start: w.start, planned: w.km, ran: w.past || w.current ? w.ranKm : null, long: w.longKm,
          current: w.current, down: w.down, race: w.sessions.some(x => x.kind === "race") }))} />
        <span className="small muted">Wide bar: planned. Narrow bar: run. Line: the long run. {v.progress.done} of {v.progress.sessions} sessions done
          {v.progress.stridesKm > 0 ? `; ${v.progress.stridesKm} km of strides and walk-backs on top` : ""}.</span>
        <span className="small muted">The rules: the long run grows at most {Math.round((RULES.longStep - 1) * 100)} % a week, to {v.settings.longMaxKm} km;
          every {RULES.downEvery}th week is a down week; weeks stay at or under {v.settings.volumeHoldKm} km until three of four reach it;
          each week is sized from what you actually ran. Open a week for why it looks the way it does.</span>
      </section>
      {v.weeks.map(w => (
        <details key={w.start} className="card" open={w.focus}>
          <summary className="between">
            <span>
              <b className={w.current ? "now-sq" : undefined}>{w.n}</b> <span className="muted small">{w.phase} {w.phaseWeek}{w.down ? " · down" : ""} · {dateShort(w.start)}</span>
            </span>
            <span className="num small">{w.sessions.some(x => x.kind === "race")
              ? `Race ${v.settings.race.km} km · ${Math.round((w.km - v.settings.race.km) * 10) / 10} km before`
              : `${w.past || w.current ? `${Math.round((w.ranKm - w.stridesKm) * 10) / 10} / ` : ""}${w.km} km · long ${w.longKm}`}</span>
          </summary>
          <div className="wbar">
            <div className={w.current ? "now" : w.past ? "past" : undefined} style={{ width: `${(100 * w.km) / peak}%` }} />
          </div>
          {w.days.map(d => <DayLine key={d.date} d={d} easyCeiling={v.easyCeiling} paces={v.paces} today={v.today} />)}
          <Limits limits={w.limits} binding={w.binding}
            note={w.current && v.acwr != null ? `Runalyze's load ratio today: ${v.acwr.toFixed(2)}. That one is today's fatigue over today's fitness; the plan's ratio averages the whole week.` : null} />
        </details>
      ))}
    </main>
  );
}
