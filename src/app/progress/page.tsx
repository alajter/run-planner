import { progressView } from "@/lib/views";
import { fmtTime } from "@/lib/engine/zones";
import { dateShort, ProgressStats } from "../ui";

export const dynamic = "force-dynamic";

/** A small line chart: points over dates, an optional second line, an optional reference value. */
function Line({ data, goal: refV, lower = false, fmt = (v: number) => String(Math.round(v)) }:
  { data: { x: string; y: number | null; y2?: number | null }[]; goal?: number | null; lower?: boolean; fmt?: (v: number) => string }) {
  const pts = data.filter(d => d.y != null);
  if (pts.length < 2) return <span className="muted small">Not enough runs yet.</span>;
  const W = 600, H = 140, P = 4;
  const ys = [...pts.map(d => d.y!), ...data.map(d => d.y2).filter((v): v is number => v != null), ...(refV ? [refV] : [])];
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const t0 = Date.parse(pts[0].x), t1 = Date.parse(pts.at(-1)!.x), ts = t1 - t0 || 1;
  const X = (x: string) => P + ((Date.parse(x) - t0) / ts) * (W - 2 * P);
  const Y = (y: number) => P + (1 - (y - lo) / span) * (H - 2 * P);
  // a gap of more than 3 weeks between runs breaks the line instead of bridging it
  const path = (k: "y" | "y2") => data.filter(d => d[k] != null).map((d, i, a) =>
    `${i && Date.parse(d.x) - Date.parse(a[i - 1].x) <= 21 * 86_400_000 ? "L" : "M"}${X(d.x).toFixed(1)},${Y(d[k]!).toFixed(1)}`).join("");
  const last = pts.at(-1)!;
  return (
    <figure className="flush">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`From ${fmt(pts[0].y!)} to ${fmt(last.y!)}`}>
        {refV != null && <line x1={0} x2={W} y1={Y(refV)} y2={Y(refV)} stroke="var(--muted)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        {pts.map(d => <circle key={d.x + d.y} cx={X(d.x)} cy={Y(d.y!)} r={2.5} fill="var(--muted)" opacity={data.some(z => z.y2 != null) ? 0.5 : 1} />)}
        {data.some(d => d.y2 != null) && <path d={path("y2")} fill="none" stroke="var(--text)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      </svg>
      <figcaption className="between small muted"><span>{dateShort(pts[0].x)}{pts[0].x.slice(0, 4) !== last.x.slice(0, 4) ? ` ${pts[0].x.slice(0, 4)}` : ""}</span><span>{lower ? "lower is better" : ""}</span><span>{dateShort(last.x)}</span></figcaption>
    </figure>
  );
}

export default async function Progress() {
  const v = await progressView();
  const lastSmooth = [...v.smooth].reverse().find(s => s.bpk != null)?.bpk ?? null;
  const vo2 = v.points.filter(p => p.vo2).slice(-10);
  const vo2now = vo2.length ? vo2.reduce((a, p) => a + p.vo2!, 0) / vo2.length : null;
  // the trend: at each run, the mean VO₂max of the last 10 runs up to it (the same figure as the headline)
  const vo2runs = v.points.filter(p => p.vo2);
  const vo2trend = v.points.map(p => {
    if (!p.vo2) return null;
    const upto = vo2runs.filter(q => q.date <= p.date).slice(-10);
    return upto.reduce((a, q) => a + q.vo2!, 0) / upto.length;
  });
  const snap = v.snaps.at(-1);
  const peakWeek = Math.max(1, ...v.weeks.map(w => w.km));
  return (
    <main>
      <h1>Progress</h1>

      <section className="card stack">
        <h2>Last 4 weeks</h2>
        <ProgressStats metrics={v.metrics} />
      </section>

      <section className="card stack">
        <div className="between"><h2>Beats per km · 4-week median</h2><b className="num">{lastSmooth ?? "—"}</b></div>
        <Line data={v.points.map((p, i) => ({ x: p.date, y: p.bpk, y2: v.smooth[i].bpk }))} lower />
        <span className="small muted">Heartbeats per km on runs of 4 km or more (the easy part, when the run ended with strides). Fewer beats for the same km = fitter.</span>
      </section>

      <section className="card stack">
        <div className="between"><h2>VO₂max · last 10 runs</h2><b className="num">{vo2now ? vo2now.toFixed(1) : "—"}</b></div>
        <Line data={v.points.map((p, i) => ({ x: p.date, y: p.vo2, y2: vo2trend[i] }))} fmt={x => x.toFixed(1)} />
        {snap && <span className="small muted">Runalyze&apos;s effective VO₂max today: {snap.calc.effectiveVO2max.toFixed(1)}</span>}
      </section>

      <section className="card stack">
        <h2>Weekly km · last 16 weeks</h2>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${v.weeks.length}, 1fr)`, alignItems: "end", gap: 4, height: 110 }}>
          {v.weeks.map(w => <div key={w.start} title={`${dateShort(w.start)}: ${w.km} km`}
            style={{ height: `${Math.max(2, (100 * w.km) / peakWeek)}%`, background: "var(--text)", borderRadius: 2, opacity: 0.85 }} />)}
        </div>
        <div className="between small muted"><span>{dateShort(v.weeks[0].start)}</span><span>peak {peakWeek} km</span><span>this week {v.weeks.at(-1)!.km} km</span></div>
      </section>

      {snap && <section className="card stack">
        <h2>Today, from Runalyze</h2>
        <dl className="reads">
          <div><dt>Fitness</dt><dd className="num">{snap.calc.fitness} · fatigue {snap.calc.fatigue} · form {snap.calc.fitness - snap.calc.fatigue}</dd></div>
          <div><dt>Load ratio</dt><dd className="num">{snap.calc.acuteChronicWorkloadRatio.toFixed(2)} <span className="muted">(0.8–1.3 is the safe range)</span></dd></div>
          <div><dt>Half prediction</dt><dd className="num">{snap.pred ? fmtTime(snap.pred) : "—"} <span className="muted">· goal {v.race.target}</span></dd></div>
        </dl>
        {v.snaps.length > 1 && <Line data={v.snaps.map(s => ({ x: s.date, y: s.pred }))} goal={v.target} lower fmt={fmtTime} />}
      </section>}
    </main>
  );
}
