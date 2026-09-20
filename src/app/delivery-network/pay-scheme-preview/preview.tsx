"use client";

import { useRef, useState, type FormEvent } from "react";
import { previewPooledPay, type PooledPayTerms } from "@/lib/workforce-pooled-pay";
import styles from "./preview.module.css";

type Row = { id: number; date: string; packages: string; km: string };
type Result = ReturnType<typeof previewPooledPay>;
const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount);
function number(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} is required.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Enter a valid ${label.toLowerCase()}.`);
  return parsed;
}

export function PaySchemePreview({ today }: { today: string }) {
  const [mode, setMode] = useState<PooledPayTerms["mode"]>("guarantee_plus_excess");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [daily, setDaily] = useState("");
  const [threshold, setThreshold] = useState("");
  const [rate, setRate] = useState("");
  const [fuel, setFuel] = useState("0");
  const [complete, setComplete] = useState(false);
  const [rows, setRows] = useState<Row[]>([{ id: 1, date: "", packages: "", km: "0" }]);
  const nextId = useRef(2);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  function invalidate() { setResult(null); setError(""); }
  function changeRow(id: number, field: keyof Omit<Row, "id">, value: string) {
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value } : row));
  }
  function addDay() {
    const row = { id: nextId.current++, date: "", packages: "", km: "0" };
    setRows(current => [...current, row]);
    invalidate();
  }
  function sample() {
    const now = new Date(`${today}T00:00:00Z`);
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
    setMode("guarantee_plus_excess"); setFrom(first); setTo(last); setDaily("800"); setThreshold("45"); setRate("12"); setFuel("0"); setComplete(true);
    setRows([{ id: nextId.current++, date: first, packages: "10", km: "0" }, { id: nextId.current++, date: first.slice(0, 8) + "02", packages: "60", km: "0" }]);
    invalidate();
  }
  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setResult(null);
    try {
      setResult(previewPooledPay({ from, to, asOf: today, complete,
        terms: { mode, dailyGuarantee: number(daily, "Daily guarantee"), packagesPerDay: mode === "pooled_floor" ? 0 : number(threshold, "Package threshold"),
          packageRate: number(rate, "Package rate"), fuelPerKm: number(fuel, "Fuel per km") },
        days: rows.map(row => ({ date: row.date, packages: number(row.packages, "Delivered packages"), verifiedKm: number(row.km, "Verified km") }))
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Check the entered values."); }
  }
  return <div className={styles.desk}>
    <div className={styles.notice}><strong>Preview only · Not connected to payroll</strong><p>No associate, station or account is changed. Enter hypothetical values only. Complete window settlement and approval integration are still required before these formulas can pay anyone.</p></div>
    <form onSubmit={calculate} onChange={invalidate}>
      <section className={styles.card}>
        <header><div><span>01 · Terms</span><h2>Choose the actual formula</h2></div><button className={styles.secondary} type="button" onClick={sample}>Load illustrative example</button></header>
        <div className={styles.fields}>
          <label className={styles.wide}>Guarantee arrangement<select value={mode} onChange={event => setMode(event.target.value as PooledPayTerms["mode"])}>
            <option value="guarantee_plus_excess">Daily guarantee + packages above the pooled allowance</option>
            <option value="pooled_floor">Higher of period guarantee or total package earnings</option>
          </select></label>
          <label>Window starts<input type="date" required value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label>Window ends<input type="date" required min={from} value={to} onChange={event => setTo(event.target.value)} /></label>
          <label>Guarantee per qualifying day (₹)<input type="number" min="0.01" max="1000000" step="0.01" required value={daily} onChange={event => setDaily(event.target.value)} /></label>
          {mode === "guarantee_plus_excess" ? <label>Included packages per qualifying day<input type="number" min="0" max="100000" step="1" required value={threshold} onChange={event => setThreshold(event.target.value)} /></label> : null}
          <label>{mode === "guarantee_plus_excess" ? "Rate per excess package (₹)" : "Rate per delivered package (₹)"}<input type="number" min="0" max="1000000" step="0.01" required value={rate} onChange={event => setRate(event.target.value)} /></label>
          <label>Fuel per verified km (₹)<input type="number" min="0" max="1000000" step="0.01" required value={fuel} onChange={event => setFuel(event.target.value)} /></label>
        </div>
        <p className={styles.help}>{mode === "guarantee_plus_excess" ? "Guarantee × qualifying days + max(0, total packages − included packages × qualifying days) × excess rate." : "max(guarantee × qualifying days, total packages × package rate)."} Verified kilometre fuel is added separately. This is not a monthly-salary proration calculator.</p>
      </section>
      <section className={styles.card}>
        <header><div><span>02 · Work evidence</span><h2>One combined row per qualifying day</h2></div><button className={styles.secondary} type="button" disabled={rows.length >= 93} onClick={addDay}>Add day</button></header>
        <p className={styles.help}>Only include days that qualify under the agreed policy, including a zero-package day if eligible. Exclude unpaid absences and training days covered by a separate training agreement. Combine multiple provider IDs before entering a day. Kilometres are never inferred from package counts.</p>
        <div className={styles.days}>
          {rows.map((row, index) => <fieldset key={row.id} className={styles.day}><legend>Qualifying day {index + 1}</legend>
            <label>Work date<input type="date" required min={from || undefined} max={to && to < today ? to : today} value={row.date} onChange={event => changeRow(row.id, "date", event.target.value)} /></label>
            <label>Delivered packages<input type="number" min="0" max="100000" step="1" required value={row.packages} onChange={event => changeRow(row.id, "packages", event.target.value)} /></label>
            <label>Verified km<input type="number" min="0" max="10000" step="0.01" required value={row.km} onChange={event => changeRow(row.id, "km", event.target.value)} /></label>
            <button type="button" className={styles.remove} aria-label={`Remove qualifying day ${index + 1}`} onClick={() => { setRows(current => current.filter(item => item.id !== row.id)); invalidate(); }}>Remove</button>
          </fieldset>)}
          {!rows.length ? <p>No qualifying days. The preview will show zero, not a full-period guarantee.</p> : null}
        </div>
        <footer><label className={styles.check}><input type="checkbox" checked={complete} onChange={event => setComplete(event.target.checked)} />All qualifying days and verified distances for this hypothetical window are included.</label>
          <button className={styles.primary} type="submit">Calculate preview</button></footer>
      </section>
    </form>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div aria-live="polite" aria-atomic="true">
      {result ? <section className={styles.result}>
        <header><span>{result.windowComplete ? "Complete-window illustration" : "Provisional illustration"}</span><h2>{money(result.totalAmount)}</h2><p>Calculated preview · Not approved or payable</p></header>
        <div className={styles.metrics}><div><small>Qualifying days</small><strong>{result.workDays} <em>/ {result.calendarDays} calendar days</em></strong></div><div><small>Packages / average per day</small><strong>{result.packages} / {result.averagePackages.toFixed(2)}</strong></div><div><small>Verified kilometres</small><strong>{result.verifiedKm.toFixed(2)}</strong></div></div>
        <dl className={styles.breakdown}><div><dt>Guaranteed base</dt><dd>{money(result.guaranteedAmount)}</dd></div>
          <div><dt>{mode === "guarantee_plus_excess" ? `Excess above pooled allowance (${result.excessPackages} packages)` : "Variable earnings above guaranteed base"}</dt><dd>{money(result.supplementAmount)}</dd></div>
          <div><dt>Verified kilometre fuel</dt><dd>{money(result.fuelAmount)}</dd></div>
          <div><dt>Total illustration</dt><dd>{money(result.totalAmount)}</dd></div></dl>
        <aside><strong>Why daily and pooled calculations differ</strong><p>Applying the selected formula separately each day would give {money(result.dailyComparisonAmount)}—{money(result.comparisonDifference)} more than pooling this window. Low-volume and high-volume days balance only in the pooled formula. Do not pay that daily excess and then add the pooled excess again.</p></aside>
        {result.incompleteReasons.length ? <ul>{result.incompleteReasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
        <p className={styles.help}>Real settlement must reconcile already-paid guarantees, approved kilometres and late data changes, with independent approval. This preview creates no earnings lines, payout requests or rate assignments.</p>
      </section> : null}
    </div>
  </div>;
}
