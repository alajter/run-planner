import Link from "next/link";
import { runsView } from "@/lib/views";
import { fmtPace } from "@/lib/engine/zones";
import { dow } from "../ui";

export const dynamic = "force-dynamic";

const shift = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export default async function Runs({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const v = await runsView(m);
  const title = new Date(`${v.month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const total = v.runs.reduce((a, r) => a + r.km, 0);
  return (
    <main>
      <div className="top">
        <Link href={`/runs?m=${shift(v.month, -1)}`} className="btn plain">‹</Link>
        <h1>{title}</h1>
        <Link href={`/runs?m=${shift(v.month, 1)}`} className="btn plain">›</Link>
      </div>
      <span className="muted small">{v.runs.length} runs · {total.toFixed(1)} km · beats per km counts the easy part of a run with strides</span>
      <ul className="list card">
        {v.runs.map(r => (
          <li key={r.id}>
            <Link href={`/runs/${r.id}`} className="between plain">
              <span>
                <span className="muted small">{dow(r.date)} {Number(r.date.slice(8))}</span>{" "}
                <b className="num">{r.km.toFixed(1)} km</b>{r.strides ? <span className="muted small"> · {r.did.km.toFixed(1)} + {r.strides}× strides</span> : null}
                <br /><span className="small muted num">{fmtPace(r.did.pace)}/km{r.did.hr ? ` · ${r.did.hr} bpm` : ""}</span>
              </span>
              <span className="num">{r.bpk ? <>{r.bpk} <span className="muted small">b/km</span></> : <span className="muted small">—</span>}</span>
            </Link>
          </li>
        ))}
        {!v.runs.length && <li className="muted">No runs this month.</li>}
      </ul>
    </main>
  );
}
