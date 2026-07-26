"use client";

import { useMemo, useState } from "react";
import { opsReportCatalog } from "@/lib/ops-pulse/report-catalog";

type Station = { code: string; name: string; cluster: string };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }

export function OpsReportCenter({ stations }: { stations: Station[] }) {
  const toDefault = today();
  const [from, setFrom] = useState(`${toDefault.slice(0, 7)}-01`);
  const [to, setTo] = useState(toDefault);
  const [selected, setSelected] = useState(stations.map((row) => row.code));
  const [clusters, setClusters] = useState<string[]>([]);
  const clusterOptions = useMemo(() => [...new Set(stations.map((row) => row.cluster).filter(Boolean))].sort(), [stations]);
  function toggleCluster(cluster: string, checked: boolean) {
    const codes = stations.filter((row) => row.cluster === cluster).map((row) => row.code);
    setClusters((current) => checked ? [...new Set([...current, cluster])] : current.filter((item) => item !== cluster));
    setSelected((current) => checked ? [...new Set([...current, ...codes])] : current.filter((code) => !codes.includes(code)));
  }
  function href(type: string) {
    const params = new URLSearchParams({ type, from, to });
    if (selected.length !== stations.length) params.set("stations", selected.join(","));
    return `/api/ops-pulse/reports/download?${params.toString()}`;
  }
  return <>
    <section className="ops-report-filters">
      <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label>
      <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label>
      <details><summary><span>Stations</span><strong>{selected.length === stations.length ? "All permitted" : `${selected.length} selected`}</strong></summary><div className="ops-report-scope">
        <div><h4>Clusters</h4>{clusterOptions.map((cluster) => <label key={cluster}><input type="checkbox" checked={clusters.includes(cluster)} onChange={(event) => toggleCluster(cluster, event.target.checked)}/>{cluster}</label>)}</div>
        <div><h4>Stations</h4>{stations.map((station) => <label key={station.code}><input type="checkbox" checked={selected.includes(station.code)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, station.code])] : current.filter((code) => code !== station.code))}/><span><b>{station.code}</b> {station.name}</span></label>)}</div>
        <footer><button type="button" onClick={() => setSelected(stations.map((row) => row.code))}>Select all</button><button type="button" onClick={() => { setSelected([]); setClusters([]); }}>Clear</button></footer>
      </div></details>
    </section>
    <section className="ops-report-grid">{opsReportCatalog.map((report) => <article key={report.type}><div className="ops-report-icon">↧</div><span>{report.source}</span><h2>{report.title}</h2><p>{report.description}</p><a className={selected.length && from && to ? "" : "disabled"} href={selected.length && from && to ? href(report.type) : undefined}>Download CSV</a></article>)}</section>
  </>;
}
