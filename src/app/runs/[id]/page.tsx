import Link from "next/link";
import { notFound } from "next/navigation";
import { runView } from "@/lib/views";
import { fmtPace, fmtTime } from "@/lib/engine/zones";
import { dateShort, KIND } from "../../ui";
import { IgnoreButton } from "../../client";
import { Trace } from "../../charts";

export const dynamic = "force-dynamic";

export default async function Run({ params }: { params: Promise<{ id: string }> }) {
  const v = await runView(Number((await params).id));
  if (!v) notFound();
  const { run: r, debrief: d } = v;
  const st = r.analysis?.strides;
  return (
    <main>
      <div className="top"><Link href="/runs">‹ Runs</Link><span className="muted small">{dateShort(r.date)} · {r.title}</span></div>

      <section className="card stack">
        <h2>{v.asked ? `Asked: ${KIND[v.asked.kind]} ${v.asked.km} km${v.asked.strides ? " + strides" : ""}` : "Not in the plan"}</h2>
        <div className={`big fig ${d.neutral ? "" : d.ok ? "ok" : "warn"}`}>{d.headline}</div>
        <dl className="reads">
          {d.checks.map(c => <div key={c.label}><dt>{c.label}</dt><dd><span className="num">{c.did}</span> · <span className={c.ok ? "ok" : "warn"}>{c.word}</span> <span className="muted">(asked {c.asked})</span></dd></div>)}
        </dl>
      </section>

      <section className="card stack">
        <h2>The run</h2>
        <dl className="reads">
          <div><dt>{d.did.easyPart ? "Easy run" : "Run"}</dt><dd className="num">{d.did.km.toFixed(2)} km · {fmtTime(d.did.sec)} · {fmtPace(d.did.pace)}/km{d.did.hr ? ` · ${d.did.hr} bpm` : ""}{d.did.cadence ? ` · ${d.did.cadence} spm` : ""}</dd></div>
          {st && <div><dt>{st.n}× strides</dt><dd className="num">{st.km.toFixed(2)} km · {fmtTime(st.sec)} with the walk-backs{st.pace ? ` · strides at ${fmtPace(st.pace)}/km` : ""}</dd></div>}
          {st && <div><dt>Whole</dt><dd className="num muted">{r.km.toFixed(2)} km · {fmtTime(r.sec)}</dd></div>}
          {d.bpk && <div><dt>Beats per km</dt><dd><span className="num">{d.bpk}</span>{d.bpkMedian ? <span className="muted"> · your 6-week median {d.bpkMedian}</span> : null}</dd></div>}
          {r.vo2 && <div><dt>VO₂max</dt><dd className="num">{r.vo2.toFixed(1)}</dd></div>}
          {d.did.decoupling != null && <div><dt>HR drift</dt><dd className="num">{d.did.decoupling} %</dd></div>}
        </dl>
      </section>

      {v.trace.length >= 3 && <section className="card stack">
        <div className="between"><h2>Over the run</h2>{v.cut != null && <span className="small muted">shaded: strides and walk-backs</span>}</div>
        <Trace label="Pace /km" pts={v.trace.map(p => ({ x: p.x, y: p.pace }))} cut={v.cut} fmt={fmtPace} invert />
        <Trace label="Heart rate" pts={v.trace.map(p => ({ x: p.x, y: p.hr }))} cut={v.cut} fmt={x => `${Math.round(x)} bpm`} colour="var(--text-2)" />
        <Trace label="Beats per km" pts={v.trace.map(p => ({ x: p.x, y: p.bpk }))} cut={v.cut} fmt={x => String(Math.round(x))} />
        <div className="between small muted"><span>0 km</span><span>{v.trace.at(-1)!.x.toFixed(1)} km</span></div>
      </section>}

      {v.splits.length > 1 && <section className="card stack">
        <h2>Splits</h2>
        <table className="splits num small">
          <thead><tr><th>km</th><th>Pace</th><th>HR</th><th>b/km</th><th>spm</th></tr></thead>
          <tbody>{v.splits.map(x => <tr key={x.km} className={x.strides ? "muted" : undefined}>
            <td>{x.dist < 0.95 ? x.dist.toFixed(2) : x.km}{x.strides ? " ·st" : ""}</td><td>{fmtPace(x.pace)}</td>
            <td>{x.hr ?? "—"}</td><td>{x.bpk ?? "—"}</td><td>{x.cadence ?? "—"}</td></tr>)}</tbody>
        </table>
        {v.cut != null && <span className="small muted">·st: the km holds strides, so its pace and beats aren&apos;t easy running.</span>}
      </section>}

      {(d.keep.length > 0 || d.change.length > 0) && <section className="card stack">
        {d.keep.length > 0 && <><h2>Keep</h2>{d.keep.map(x => <span key={x.text}>· {x.text}</span>)}</>}
        {d.change.length > 0 && <><h2 className="mt-2">Change</h2>{d.change.map(x => <span key={x.text}>· {x.text}</span>)}</>}
      </section>}

      <div><IgnoreButton id={r.id} ignored={v.ignored} /></div>
    </main>
  );
}
