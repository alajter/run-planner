// Small server-rendered SVG charts: a trace over a run's distance, the readiness gauge, and the
// plan's weekly bars. Colours come from the theme tokens, so they follow light and dark.
import { dateShort } from "./ui";

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

/** A line over distance (km). `cut` shades from there to the end (the strides). `up` = higher values plot lower (pace). */
export function Trace({ pts, cut, fmt, invert = false, label, colour = "var(--text)" }: {
  pts: { x: number; y: number | null }[]; cut?: number | null; fmt: (v: number) => string; invert?: boolean; label: string; colour?: string;
}) {
  const ok = pts.filter((p): p is { x: number; y: number } => p.y != null && Number.isFinite(p.y));
  if (ok.length < 3) return null;
  const W = 600, H = 120, P = 4;
  // the range ignores the extreme 2 % (walk-backs, GPS jumps) so the line stays readable
  const ys = ok.map(p => p.y);
  const lo = pct(ys, 0.02), hi = pct(ys, 0.98), span = hi - lo || 1;
  const x1 = ok.at(-1)!.x;
  const X = (x: number) => P + (x / x1) * (W - 2 * P);
  const Y = (y: number) => {
    const f = (Math.min(hi, Math.max(lo, y)) - lo) / span;
    return P + (invert ? f : 1 - f) * (H - 2 * P);
  };
  const d = ok.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const top = invert ? lo : hi, bottom = invert ? hi : lo;
  return (
    <figure className="flush">
      <div className="between small"><span className="muted">{label}</span><span className="muted num">{fmt(bottom)} – {fmt(top)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`${label}, ${fmt(bottom)} to ${fmt(top)}`}>
        {cut != null && cut < x1 && <rect x={X(cut)} y={0} width={X(x1) - X(cut)} height={H} fill="var(--line)" opacity={0.6} />}
        <path d={d} fill="none" stroke={colour} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </figure>
  );
}

/** The readiness speedometer: 0–100 on a half dial, rest / easier / go bands. */
export function Gauge({ score, tone, dim = false }: { score: number; tone: "ok" | "warn" | "bad"; dim?: boolean }) {
  const R = 44, C = 50;
  const at = (v: number) => {
    const a = Math.PI * (1 - v / 100);
    return [C + R * Math.cos(a), C - R * Math.sin(a)] as const;
  };
  const arc = (a: number, b: number) => { const [x0, y0] = at(a), [x1, y1] = at(b); return `M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1}`; };
  const [nx, ny] = at(score);
  return (
    <svg viewBox="0 0 100 58" width={120} role="img" aria-label={`Readiness ${score} of 100`}>
      <path d={arc(0, 39.5)} stroke="var(--line)" strokeWidth={8} fill="none" />
      <path d={arc(40.5, 69.5)} stroke="var(--line)" strokeWidth={8} fill="none" />
      <path d={arc(70.5, 100)} stroke="var(--line)" strokeWidth={8} fill="none" />
      <path d={arc(0, Math.max(0.5, score))} stroke={`var(--${tone})`} strokeWidth={8} fill="none" opacity={dim ? 0.5 : 1} />
      <line x1={C} y1={C} x2={nx} y2={ny} stroke="var(--text)" strokeWidth={2} strokeLinecap="round" />
      <circle cx={C} cy={C} r={3} fill="var(--text)" />
      <text x={C} y={C - 12} textAnchor="middle" fontSize={16} fontWeight={500} fill="var(--text)" className="num">{score}</text>
    </svg>
  );
}

export interface Bar { start: string; planned: number; ran: number | null; long: number; current: boolean; down: boolean; race: boolean }

/** The plan as bars: the outline is what's planned, the fill what was run; the tick is the long run. */
export function WeekBars({ weeks }: { weeks: Bar[] }) {
  const W = 600, H = 150, P = 2, gap = 4;
  const peak = Math.max(1, ...weeks.map(w => Math.max(w.planned, w.ran ?? 0)));
  const bw = (W - 2 * P - gap * (weeks.length - 1)) / weeks.length;
  const Y = (km: number) => H - (km / peak) * (H - 14);
  const race = weeks.findIndex(w => w.race);
  return (
    <figure className="flush bars">
      {race >= 0 && <span className="bar-tag small muted" aria-hidden="true" style={{ right: `${(100 * (weeks.length - 1 - race)) / weeks.length}%`, width: `${100 / weeks.length}%` }}>race</span>}
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Weekly km, peak ${peak} km`}>
        {weeks.map((w, i) => {
          const x = P + i * (bw + gap);
          return <g key={w.start}>
            <title>{`${dateShort(w.start)}: ${w.ran != null ? `${w.ran} of ` : ""}${w.planned} km, long ${w.long}`}</title>
            <rect x={x} y={Y(w.planned)} width={bw} height={H - Y(w.planned)} rx={2}
              fill={w.current ? "var(--accent)" : "var(--line)"} opacity={w.current ? 0.25 : w.down ? 0.6 : 1} />
            {w.ran != null && w.ran > 0 && <rect x={x + bw * 0.2} y={Y(w.ran)} width={bw * 0.6} height={H - Y(w.ran)} rx={2}
              fill={w.current ? "var(--accent)" : "var(--text)"} />}
            <line x1={x} x2={x + bw} y1={Y(w.long)} y2={Y(w.long)} stroke="var(--muted)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </g>;
        })}
      </svg>
      <figcaption className="between small muted">
        <span>{dateShort(weeks[0].start)}</span><span>peak {peak} km</span><span>{dateShort(weeks.at(-1)!.start)}</span>
      </figcaption>
    </figure>
  );
}

/** A small trend line over equal steps (weeks); a missing week breaks the line instead of bridging it. */
export function Spark({ values, label }: { values: (number | null)[]; label: string }) {
  const W = 300, H = 40, P = 3;
  const ok = values.filter((v): v is number => v != null);
  if (ok.length < 2) return <span className="small muted">Not enough weeks yet.</span>;
  const lo = Math.min(...ok), hi = Math.max(...ok), span = hi - lo || 1;
  const X = (i: number) => P + (i / (values.length - 1)) * (W - 2 * P);
  const Y = (v: number) => P + (1 - (v - lo) / span) * (H - 2 * P);
  let d = "", pen = false;
  values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
  const li = values.map((v, i) => (v != null ? i : -1)).filter(i => i >= 0).at(-1)!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--text-2)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {values.map((v, i) => v != null && <circle key={i} cx={X(i)} cy={Y(v)} r={i === li ? 3 : 1.5} fill={i === li ? "var(--text)" : "var(--muted)"} />)}
    </svg>);
}
