"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ReportImportMaster, reportSchedule } from "@/lib/report-import-master";

type ShipmentStation = { code: string; name: string; model: string; provider: string };

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
  const [reportDate, setReportDate] = useState(indiaDate(sourceOptions[0]?.date_default_offset ?? 0));
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
    payload.append("station_code", effectiveStationCode);
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
  const requiresStation = Boolean(selected?.requires_station);
  const requiresReportDate = Boolean(selected?.requires_report_date);
  const hasConditionalFields = requiresStation || requiresReportDate;
  const eligibleStations = selected?.station_scope === "amazon_dsp_xpd"
    ? stations.filter((station) => station.provider.toUpperCase().includes("AMAZON") && ["DSP", "EDSP", "XPD", "XPT", "AMXL"].includes(station.model.toUpperCase()))
    : stations;
  const effectiveStationCode = eligibleStations.some((station) => station.code === stationCode)
    ? stationCode
    : eligibleStations[0]?.code ?? "";
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

      <div className={compact ? `compact-upload-row ${hasConditionalFields ? "shipment-upload-row" : ""}` : "form-grid three"}>
        <label>
          <span>Data</span>
          <select className="select" value={sourceType} onChange={(event) => {
            const nextType = event.target.value;
            setSourceType(nextType);
            const next = sourceOptions.find((option) => option.source_code === nextType);
            setReportDate(indiaDate(next?.date_default_offset ?? 0));
          }}>
            {sourceOptions.map((option) => <option key={option.source_code} value={option.source_code}>{option.parser_type === "inbound_shipment_detail" ? "Inbound data" : option.parser_type === "delivered_shipment_detail" ? "Delivered data" : option.name}</option>)}
          </select>
        </label>
        {requiresStation ? <label>
          <span>Station</span>
          <select className="select" value={effectiveStationCode} onChange={(event) => setStationCode(event.target.value)} required>
            {eligibleStations.map((station) => <option key={station.code} value={station.code}>{station.code} · {station.name} · {station.model}</option>)}
          </select>
        </label> : null}
        {requiresReportDate ? <label>
          <span>{selected?.report_date_label || "Data date"}</span>
          <input className="field" type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} required />
        </label> : null}
        <label style={compact ? undefined : { gridColumn: "span 2" }}>
          <span>File</span>
          <input ref={fileRef} className="field" type="file" accept={accepted} />
        </label>
        {compact ? (
          <button className={`button ${isPending ? "loading" : ""}`} disabled={isPending || !sourceType || (requiresStation && !effectiveStationCode) || (requiresReportDate && !reportDate)} onClick={upload} type="button">
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
