"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const sourceOptions = [
  { value: "amazon_shipments", label: "Amazon Daily Shipment Count", helper: "Station/date/associate delivery counts. Feeds CPS denominator and DA activity." },
  { value: "iocl_fuel", label: "IOCL Fuel", helper: "IOCL fuel transactions. Vehicle number is mapped to station where possible." },
  { value: "bpcl_fuel", label: "BPCL Fuel", helper: "BPCL fuel transactions. Duplicate transaction IDs are ignored for CPS." },
  { value: "cashbook", label: "Cashbook", helper: "Station expense file. Date, station, amount and head are normalized for CPS costs." }
];

export function ReportImportUploader() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sourceType, setSourceType] = useState(sourceOptions[0].value);
  const [message, setMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ duplicateRows?: number; imported?: number; skipped?: number; totalRows?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function upload() {
    setMessage(null);
    setSummary(null);
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose an Excel or CSV file first.");
      return;
    }
    const payload = new FormData();
    payload.append("source_type", sourceType);
    payload.append("file", file);
    startTransition(async () => {
      const response = await fetch("/api/report-imports", {
        method: "POST",
        body: payload
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Unable to import this file.");
        return;
      }
      setMessage(result.message ?? "Import completed.");
      setSummary({
        duplicateRows: Number(result.duplicateRows ?? 0),
        imported: Number(result.imported ?? 0),
        skipped: Number(result.skipped ?? 0),
        totalRows: Number(result.totalRows ?? 0)
      });
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  const selected = sourceOptions.find((option) => option.value === sourceType) ?? sourceOptions[0];

  return (
    <div className="panel-body stacked">
      <div className="import-source-grid">
        {sourceOptions.map((option) => (
          <button
            className={`import-source-card ${sourceType === option.value ? "active" : ""}`}
            key={option.value}
            onClick={() => setSourceType(option.value)}
            type="button"
          >
            <strong>{option.label}</strong>
            <span>{option.helper}</span>
          </button>
        ))}
      </div>

      <div className="form-grid three">
        <label>
          <span>Import type</span>
          <select className="select" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label style={{ gridColumn: "span 2" }}>
          <span>File</span>
          <input ref={fileRef} className="field" type="file" accept=".xlsx,.xls,.csv" />
        </label>
      </div>
      <div className="dropzone" style={{ minHeight: 120 }}>
        <div>
          <h2>{selected.label}</h2>
          <p className="subtle" style={{ marginTop: 8 }}>{selected.helper}</p>
          <button className={`button ${isPending ? "loading" : ""}`} disabled={isPending} onClick={upload} style={{ marginTop: 16 }} type="button">
            {isPending ? "Importing..." : "Import file"}
          </button>
        </div>
      </div>
      {message ? <div className="message-panel success"><strong>{message}</strong></div> : null}
      {summary ? (
        <div className="report-import-summary">
          <span>Total rows <strong>{summary.totalRows}</strong></span>
          <span>Imported <strong>{summary.imported}</strong></span>
          <span>Skipped <strong>{summary.skipped}</strong></span>
          <span>Duplicates ignored <strong>{summary.duplicateRows}</strong></span>
        </div>
      ) : null}
      {error ? <div className="message-panel error"><strong>{error}</strong></div> : null}
    </div>
  );
}
