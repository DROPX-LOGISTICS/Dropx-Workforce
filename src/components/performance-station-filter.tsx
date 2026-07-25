"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type StationOption = { code: string; name: string };

export function PerformanceStationFilter({
  stations, selectedCodes, view, from, to, week
}: {
  stations: StationOption[];
  selectedCodes: string[];
  view: "daily" | "sls";
  from: string;
  to: string;
  week: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(selectedCodes);
  const [search, setSearch] = useState("");
  const visibleStations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? stations.filter((station) => `${station.code} ${station.name}`.toLowerCase().includes(term)) : stations;
  }, [search, stations]);

  function apply() {
    if (!selected.length) return;
    const params = new URLSearchParams({ view });
    if (view === "daily") {
      params.set("from", from);
      params.set("to", to);
    } else {
      params.set("week", String(week));
    }
    if (selected.length !== stations.length) params.set("stations", selected.join(","));
    router.push(`/ops-pulse/performance?${params.toString()}`);
  }

  return (
    <details className="performance-station-filter">
      <summary><span>Stations</span><strong>{selected.length === stations.length ? "All permitted" : `${selected.length} selected`}</strong><i>⌄</i></summary>
      <div className="performance-station-popover">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search station" aria-label="Search performance stations" />
        <div className="performance-station-actions">
          <button type="button" onClick={() => setSelected(stations.map((station) => station.code))}>Select all</button>
          <button type="button" onClick={() => setSelected([])}>Clear</button>
        </div>
        <div className="performance-station-options">
          {visibleStations.map((station) => (
            <label key={station.code}>
              <input type="checkbox" checked={selected.includes(station.code)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, station.code] : current.filter((code) => code !== station.code))} />
              <span><strong>{station.code}</strong>{station.name}</span>
            </label>
          ))}
        </div>
        <button className="performance-station-apply" type="button" disabled={!selected.length} onClick={apply}>Apply stations</button>
      </div>
    </details>
  );
}
