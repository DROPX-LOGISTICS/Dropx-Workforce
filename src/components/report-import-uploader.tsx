"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ReportImportMaster, reportSchedule } from "@/lib/report-import-master";

type ShipmentStation = { code: string; name: string; model: string };

function indiaDate(days = 0) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

export function ReportImportUploader({ reports, stations = [], compact = false }: { reports: ReportImportMaster[]; stations?: ShipmentStation[]; compact?: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const sourceOptions = reports.filter((report) => report.is_active);
  const [sourceType, setSourceType] = useState(sourceOptions[0]?.source_code ?? "");
  const [stationCode, setStationCode] = useState(stations[0]?.code ?? "");
  const [reportDate, setReportDate] = useState(indiaDate(-1));
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
      setError("Choose a report file first.");
      return;
    }
    const payload = new FormData();
    payload.append("source_type", sourceType);
    payload.append("station_code", stationCode);
    payload.append("report_date", reportDate);
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

  const selected = sourceOptions.find((option) => option.source_code === sourceType) ?? sourceOptions[0];
  const isInbound = selected?.parser_type === "inbound_shipment_detail";
  const accepted = selected?.file_types.map((type) => `.${type}`).join(",") ?? "";

  return (
    <div className="panel-body stacked">
      {!compact ? <div className="import-source-grid">
        {sourceOptions.map((option) => (
          <button
            className={`import-source-card ${sourceType === option.source_code ? "active" : ""}`}
            key={option.source_code}
            onClick={() => setSourceType(option.source_code)}
            type="button"
          >
            <strong>{option.name}</strong>
            <span>{option.description}</span>
            <small>{reportSchedule(option)}</small>
          </button>
        ))}
      </div> : null}

      <div className={compact ? "compact-upload-row shipment-upload-row" : "form-grid three"}>
        <label>
          <span>Data</span>
          <select className="select" value={sourceType} onChange={(event) => {
            const nextType = event.target.value;
            setSourceType(nextType);
            setReportDate(sourceOptions.find((option) => option.source_code === nextType)?.parser_type === "inbound_shipment_detail" ? indiaDate() : indiaDate(-1));
          }}>
            {sourceOptions.map((option) => <option key={option.source_code} value={option.source_code}>{option.parser_type === "inbound_shipment_detail" ? "Inbound data" : "Delivered data"}</option>)}
          </select>
        </label>
        <label>
          <span>Station</span>
          <select className="select" value={stationCode} onChange={(event) => setStationCode(event.target.value)} required>
            {stations.map((station) => <option key={station.code} value={station.code}>{station.code} · {station.name} · {station.model}</option>)}
          </select>
        </label>
        <label>
          <span>{isInbound ? "Expected at station" : "Delivered date"}</span>
          <input className="field" type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} required />
        </label>
        <label style={compact ? undefined : { gridColumn: "span 2" }}>
          <span>File</span>
          <input ref={fileRef} className="field" type="file" accept={accepted} />
        </label>
        {compact ? (
          <button className={`button ${isPending ? "loading" : ""}`} disabled={isPending || !sourceType || !stationCode || !reportDate} onClick={upload} type="button">
            {isPending ? "Importing..." : "Upload"}
          </button>
        ) : null}
      </div>
      {!compact ? <div className="dropzone" style={{ minHeight: 120 }}>
        <div>
          <h2>{selected?.name ?? "No active reports"}</h2>
          <p className="subtle" style={{ marginTop: 8 }}>{selected?.description}</p>
          {selected ? <p className="subtle" style={{ marginTop: 6 }}>{reportSchedule(selected)} · accepts {selected.file_types.map((type) => `.${type}`).join(", ")}</p> : null}
          <button className={`button ${isPending ? "loading" : ""}`} disabled={isPending} onClick={upload} style={{ marginTop: 16 }} type="button">
            {isPending ? "Importing..." : "Import file"}
          </button>
        </div>
      </div> : null}
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
