"use client";
// The interactive bits: sync, ignore, login and settings forms.
import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { changePassphrase, login, saveSettings, saveTimeZone, saveToken, setIgnored, syncNow, testToken } from "./actions";

export function SyncButton() {
  const [pending, start] = useTransition();
  return <button className="btn" disabled={pending} onClick={() => start(() => syncNow())}>{pending ? "Syncing…" : "Sync"}</button>;
}

export function IgnoreButton({ id, ignored }: { id: number; ignored: boolean }) {
  const [pending, start] = useTransition();
  return <button className="btn" disabled={pending} onClick={() => start(() => setIgnored(id, !ignored))}>
    {ignored ? "Count this run again" : "Ignore this run"}</button>;
}

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="card stack">
      <label>Passphrase<input name="passphrase" type="password" autoComplete="current-password" required autoFocus /></label>
      {state?.error && <span className="bad small">{state.error}</span>}
      <button className="btn primary" disabled={pending}>Sign in</button>
    </form>);
}

export interface SettingsValues { label: string; date: string; km: number; target: string; longMaxKm: number; volumeHoldKm: number; lthr: number;
  blockStart: string; weekStartDow: number; longRunDow: number }

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function SettingsForm({ v }: { v: SettingsValues }) {
  const [state, action, pending] = useActionState(saveSettings, {});
  return (
    <form action={action} className="card stack">
      <h2>Race</h2>
      <label>Name<input name="label" defaultValue={v.label} /></label>
      <div className="row nowrap">
        <label className="grow">Date<input name="date" type="date" defaultValue={v.date} /></label>
        <label className="grow">Distance (km)<input name="km" type="number" step="0.1" defaultValue={v.km} /></label>
      </div>
      <label>Goal time<input name="target" defaultValue={v.target} placeholder="1:59" /></label>
      <h2 className="mt-3">Weeks</h2>
      <div className="row nowrap">
        <label className="grow">First day of the week<select name="weekStartDow" defaultValue={v.weekStartDow}>
          {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
        <label className="grow">Long run on<select name="longRunDow" defaultValue={v.longRunDow}>
          {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
      </div>
      <label>Block starts (moved back to the first day of its week)<input name="blockStart" type="date" defaultValue={v.blockStart} /></label>
      <span className="small muted">The other runs fall every second day after the long run. Days already asked keep their sessions.</span>
      <h2 className="mt-3">Limits</h2>
      <div className="row nowrap">
        <label className="grow">Longest long run (km)<input name="longMaxKm" type="number" step="0.5" defaultValue={v.longMaxKm} /></label>
        <label className="grow">Weekly km cap (until 3 of 4 weeks reach it)<input name="volumeHoldKm" type="number" step="1" defaultValue={v.volumeHoldKm} /></label>
      </div>
      <label>Lactate-threshold HR (sets the easy ceiling at 85 %)<input name="lthr" type="number" defaultValue={v.lthr} /></label>
      {state?.error && <span className="bad small">{state.error}</span>}
      {state?.ok && <span className="ok small">Saved. The plan is rebuilt.</span>}
      <button className="btn primary" disabled={pending}>Save</button>
    </form>);
}

const Msg = ({ s }: { s?: { error?: string; ok?: string } | null }) =>
  s?.error ? <span className="bad small">{s.error}</span> : s?.ok ? <span className="ok small">{s.ok}</span> : null;

export function TokenForm({ status }: { status: string }) {
  const [state, action, pending] = useActionState(saveToken, null);
  const [test, setTest] = useState<{ error?: string; ok?: string } | null>(null);
  const [testing, start] = useTransition();
  return (
    <form action={action} className="stack">
      <span className="small">{status}</span>
      <label>New token (Runalyze → Settings → Personal API)<input name="token" type="password" autoComplete="off" placeholder="paste to replace" /></label>
      <Msg s={state} /><Msg s={test} />
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Testing…" : "Save"}</button>
        <button type="button" className="btn" disabled={testing} onClick={() => start(async () => setTest(await testToken()))}>
          {testing ? "Testing…" : "Test connection"}</button>
      </div>
    </form>);
}

export function PassphraseForm({ status }: { status: string }) {
  const [state, action, pending] = useActionState(changePassphrase, null);
  return (
    <form action={action} className="stack">
      <span className="small">{status}</span>
      <label>Current passphrase<input name="current" type="password" autoComplete="current-password" required /></label>
      <label>New passphrase (12+ characters)<input name="next" type="password" autoComplete="new-password" required minLength={12} /></label>
      <label>New passphrase again<input name="again" type="password" autoComplete="new-password" required minLength={12} /></label>
      <Msg s={state} />
      <button className="btn primary self-start" disabled={pending}>Change passphrase</button>
    </form>);
}

export function TimeZoneForm({ tz, zones }: { tz: string; zones: string[] }) {
  const [pending, start] = useTransition();
  return (
    <form action={f => start(() => saveTimeZone(f))} className="row nowrap">
      <select name="tz" defaultValue={tz} aria-label="Time zone">{zones.map(z => <option key={z}>{z}</option>)}</select>
      <button className="btn" disabled={pending}>Save</button>
    </form>);
}

/** A card that folds to its summary (the first glance); open or closed is remembered on this device. */
export function Fold({ id, summary, children, defaultOpen = false }: { id: string; summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    try { const v = localStorage.getItem(`fold:${id}`); if (v !== null) setOpen(v === "1"); } catch { /* private mode: keep the default */ }
  }, [id]);
  return (
    <details className="card fold" open={open} onToggle={e => {
      const o = (e.currentTarget as HTMLDetailsElement).open;
      if (o === open) return;
      setOpen(o);
      try { localStorage.setItem(`fold:${id}`, o ? "1" : "0"); } catch { /* not remembered */ }
    }}>
      <summary>{summary}</summary>
      <div className="stack fold-body">{children}</div>
    </details>);
}
