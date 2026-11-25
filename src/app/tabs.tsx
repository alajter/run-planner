"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { setTheme } from "./actions";

const TABS = [["/", "Today"], ["/plan", "Plan"], ["/runs", "Runs"], ["/progress", "Progress"]] as const;
export type Theme = "auto" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const NAME: Record<Theme, string> = { auto: "Auto", light: "Light", dark: "Dark" };

function Icon({ t }: { t: Theme }) {
  const p = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, "aria-hidden": true };
  if (t === "light") return <svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (t === "dark") return <svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" /></svg>;
}

/** Auto → Light → Dark. Applied at once on the page, and saved as a cookie for the next load. */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [t, setT] = useState<Theme>(initial);
  const [, start] = useTransition();
  const next = NEXT[t];
  return (
    <button type="button" className="theme" aria-label={`Theme: ${NAME[t]}. Switch to ${NAME[next]}`} title={`Theme: ${NAME[t]}`}
      onClick={e => {
        if (e.detail > 0) e.currentTarget.blur();   // a tap or click: no focus ring left behind; keyboard keeps it
        setT(next);
        if (next === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
        start(() => setTheme(next));
      }}>
      <Icon t={t} />
    </button>
  );
}

export function Tabs() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map(([href, label]) => {
        const on = href === "/" ? path === "/" : path.startsWith(href);
        return <Link key={href} href={href} aria-current={on ? "page" : undefined}>{label}</Link>;
      })}
    </nav>
  );
}
