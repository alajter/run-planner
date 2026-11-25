import Link from "next/link";
import { todayView } from "@/lib/views";
import { fmtPace } from "@/lib/engine/zones";
import { dateShort, DayLine, KIND, ProgressStats, steps, target, WeekStrip } from "./ui";
import { Fold, SyncButton } from "./client";
import { ThemeToggle } from "./tabs";
import { cookies } from "next/headers";
import { daysBetween, dow } from "@/lib/dates";
import { Gauge, Spark } from "./charts";

export const dynamic = "force-dynamic";

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;

export default async function Today() {
  const v = await todayView();
  const s = v.session;
  const rd = v.readiness;
  const tone = rd.verdict === "green" ? "ok" : rd.verdict === "amber" ? "warn" : "bad";
  const tc = (await cookies()).get("theme")?.value;
  const theme = tc === "light" || tc === "dark" ? tc : "auto";
  // readiness, honest about what it knows: a rest day reads "Recovered", a score without last night's
  // sleep says so (and the dial dims), and a high load ratio gets a line of its own
  const sleepIn = rd.parts.some(p => p.key === "sleep");
  const restGreen = !s && rd.verdict === "green";
  const word = restGreen ? "Recovered" : rd.word;
  const sub = restGreen ? (v.next ? `Ready for the ${KIND[v.next.kind].toLowerCase()} on ${dow(v.next.date)}.` : null) : s ? rd.advice : null;
  const pctAsked = v.progress.askedKm > 0 ? Math.round((100 * (v.progress.ranKm - v.progress.stridesKm)) / v.progress.askedKm) : null;
  const mmss = (sec: number) => `${Math.floor(sec / 60)} min ${sec % 60} s`;
  const ranToday = v.latest && v.latest.date === v.today ? v.latest : null;
  return (
    <main>
      {/* the session, under one header row: the day, settings and sync */}
      <section className="card stack">
        <div className="card-head">
          <h1 className="now-sq">Today <span className="muted">· {dateShort(v.today)}</span></h1>
          <div className="row"><Link href="/settings" className="small muted">Settings</Link><ThemeToggle initial={theme} /><SyncButton /></div>
        </div>
        {s ? <>
          <div className="big">{KIND[s.kind]} {s.km} km</div>
          <div className="row"><span>{target(s.kind, v.easyCeiling, v.paces)}</span>{s.strides && <span className="tag">+ strides</span>}</div>
          {steps(s.kind, s.km, s.strides && rd.verdict === "green").map(x => <span key={x} className="small muted">· {x}</span>)}
          {s.strides && rd.verdict !== "green" && <span className="small warn">Strides off today: readiness says go easier.</span>}
        </> : <div className="rest-hero">
          <div className="big rest">Rest</div>
          <span>Rest day: recovery is part of the plan.</span>
          <dl className="reads">
            {v.overnight.restDays != null && <div><dt>Fresh in</dt><dd>{v.overnight.restDays > 0
              ? <><span className="num">{v.overnight.restDays}</span> rest days</>
              : "fresh now"}</dd></div>}
            {v.next && <div><dt>Next</dt><dd>{KIND[v.next.kind]} {v.next.km} km on {dow(v.next.date)} {dateShort(v.next.date)}
              <span className="muted"> · <span className="nw">in {daysBetween(v.today, v.next.date)} {daysBetween(v.today, v.next.date) === 1 ? "day" : "days"}</span></span></dd></div>}
          </dl>
        </div>}
        {ranToday && <span>
          Ran {ranToday.did.km.toFixed(1)} km at {fmtPace(ranToday.did.pace)}/km
          {ranToday.did.hr ? ` · ${ranToday.did.hr} bpm` : ""}{ranToday.strides ? ` + ${ranToday.strides.n}× strides` : ""}{" "}
          <Link href={`/runs/${ranToday.id}`}>Debrief ›</Link>
        </span>}
        {v.week && <WeekStrip start={v.week.start} days={v.week.days} today={v.today} />}
      </section>

      {/* readiness: the dial and the verdict at a glance, the parts and VO₂max when opened */}
      <Fold id="readiness" defaultOpen={rd.verdict !== "green"} summary={<>
        <h2>Readiness</h2>
        <div className="gauge-row">
          {rd.score != null && <Gauge score={rd.score} tone={tone} dim={!sleepIn} />}
          <div className="stack tight">
            <span className={`big fig ${tone === "ok" ? "go" : tone}`}>{word}</span>
            {sub && <span>{sub}</span>}
            {!sleepIn && <span className="small muted">Scored without last night&apos;s sleep (not synced yet).</span>}
          </div>
        </div>
        {v.acwr != null && v.acwr > 1.3 && <span className="small warn">Runalyze&apos;s load ratio is {v.acwr.toFixed(2)}, above 1.3: keep the easy days easy.</span>}
      </>}>
        {rd.reasons.map(x => <span key={x} className="small warn">{x}</span>)}
        <ul className="meters">
          {rd.parts.map(p => <li key={p.key}>
            <div className="between small"><span>{p.name} <span className="muted"><span className="sr-only">weight </span>{Math.round(p.weight * 100)} %</span></span>
              <span className={`num ${p.score >= 70 ? "ok" : p.score >= 40 ? "warn" : "bad"}`}><span className="sr-only">score </span>{p.score}</span></div>
            <div className="lbar" aria-hidden="true">
              <span style={{ width: `${p.score}%`, background: p.score >= 70 ? "var(--text-2)" : p.score >= 40 ? "var(--warn)" : "var(--bad)" }} /></div>
            <span className="small muted">{p.detail}</span>
          </li>)}
        </ul>
        <dl className="reads">
          {!rd.parts.some(p => p.key === "sleep") && v.overnight.sleep && <div><dt>Sleep</dt><dd><span className="num">{hm(v.overnight.sleep.minutes)}</span>
            <span className="muted"> · night to {dateShort(v.overnight.sleep.date)}, last night not synced yet, so not scored</span></dd></div>}
          {s && v.overnight.restDays != null && <div><dt>Rest days</dt><dd><span className="num">{v.overnight.restDays}</span> to balanced form</dd></div>}
        </dl>
      </Fold>

      {/* the plan so far */}
      {v.progress.week > 0 && <Fold id="plan" summary={<>
        <div className="between"><h2>Plan · week {v.progress.week} of {v.progress.weeks}</h2>
          <span className="small muted num">day {v.progress.daysIn} of {v.progress.days}</span></div>
        <div className="lbar thick"><span style={{ width: `${Math.min(100, (100 * v.progress.daysIn) / v.progress.days)}%`, background: "var(--accent)" }} /></div>
        {pctAsked != null && <span className={`small ${Math.abs(pctAsked - 100) <= 10 ? "muted" : "warn"}`}>
          <span className="num">{Math.round((v.progress.ranKm - v.progress.stridesKm) * 10) / 10} of {v.progress.askedKm} km</span> asked so far · {pctAsked} %
          {v.progress.stridesKm > 0 && <> · <span className="num">+{v.progress.stridesKm}</span> strides</>}</span>}
      </>}>
        <div className="between small muted num"><span>{dateShort(v.settings.blockStart)}</span><span>race {dateShort(v.race.date)}</span></div>
        <dl className="reads">
          <div><dt>Sessions</dt><dd><span className="num">{v.progress.done} of {v.progress.sessions}</span> done</dd></div>
          <div><dt>Peak</dt><dd><span className="num">{v.progress.peak.km} km</span> in week {v.progress.peak.n} ({dateShort(v.progress.peak.start)}), long run {v.progress.peak.longKm} km</dd></div>
        </dl>
        <Link href="/plan" className="small">The whole plan ›</Link>
      </Fold>}

      {/* the week in focus: this one until all its runs are done, then the next */}
      {v.focusWeek && <Fold id="week" summary={
        <div className="between"><h2>{v.focusWeek.current ? "" : "Next · "}Week {v.focusWeek.n} · {v.focusWeek.phase} {v.focusWeek.phaseWeek}{v.focusWeek.down ? " · down week" : ""}</h2>
          <span className="small muted num">{v.focusWeek.current ? `${Math.round((v.focusWeek.ranKm - v.focusWeek.stridesKm) * 10) / 10} of ${v.focusWeek.km} km${v.focusWeek.stridesKm ? ` · +${v.focusWeek.stridesKm} strides` : ""}` : `${v.focusWeek.km} km · long ${v.focusWeek.longKm}`}</span></div>}>
        <div>{v.focusWeek.days.map(d => <DayLine key={d.date} d={d} easyCeiling={v.easyCeiling} paces={v.paces} today={v.today} />)}</div>
      </Fold>}

      {/* is my fitness moving: four signals, last 4 weeks against the 4 before */}
      <Fold id="progress" summary={<><h2>Progress · last 4 weeks</h2><ProgressStats metrics={v.metrics} /></>}>
        {v.metrics.map(m => <div key={m.key} className="stack tight">
          <div className="between small"><span>{m.name} · 12 weeks</span>{m.better === "down" && <span className="muted">lower is better</span>}</div>
          <Spark values={m.series} label={`${m.name}, weekly, last 12 weeks`} />
          <span className="small muted">{m.note}</span>
        </div>)}
        {v.vo2.effective != null && <span className="small muted">Runalyze&apos;s effective VO₂max today: {v.vo2.effective.toFixed(1)} (sets the prediction and your paces).</span>}
        <Link href="/progress" className="small">All progress ›</Link>
      </Fold>

      {/* the race */}
      <Fold id="race" summary={<>
        <h2>{v.race.label} · {dateShort(v.race.date)} · {v.race.days} days</h2>
        <div className="row">
          <span className="big fig num">{v.race.predicted ?? "—"}</span>
          <span className="muted">predicted · goal {v.race.target}</span>
        </div>
      </>}>
        {v.race.marginS != null && <span className={v.race.marginS >= 0 ? "ok small" : "warn small"}>
          {v.race.marginS >= 0 ? `${mmss(v.race.marginS)} faster than the goal` : `${mmss(-v.race.marginS)} slower than the goal`} (Runalyze&apos;s prognosis)
        </span>}
      </Fold>
    </main>
  );
}
