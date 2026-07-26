"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type CapacityScopeStation = {
  code: string;
  name: string;
  cluster: string;
  region: string;
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function CapacityScopeFilter({
  stations,
  selectedCodes
}: {
  stations: CapacityScopeStation[];
  selectedCodes: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const allCodes = useMemo(() => stations.map((station) => station.code), [stations]);
  const [selected, setSelected] = useState(selectedCodes);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const regions = useMemo(() => unique(stations.map((station) => station.region)), [stations]);
  const clusters = useMemo(() => unique(stations.map((station) => station.cluster)), [stations]);
  const shownStations = useMemo(() => {
    const term = query.trim().toLowerCase();
    return stations.filter((station) => !term || [station.code, station.name, station.cluster, station.region]
      .some((value) => value.toLowerCase().includes(term)));
  }, [query, stations]);

  function toggleCodes(codes: string[], checked: boolean) {
    setSelected((current) => checked
      ? [...new Set([...current, ...codes])]
      : current.filter((code) => !codes.includes(code)));
  }

  function groupChecked(codes: string[]) {
    return codes.length > 0 && codes.every((code) => selected.includes(code));
  }

  function apply() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("station");
    params.delete("day");
    if (selected.length === allCodes.length) params.delete("stations");
    else if (!selected.length) params.set("stations", "_none");
    else params.set("stations", selected.join(","));
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  return <details className="capacity-scope-filter" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span>Scope</span>
      <strong>{selected.length === allCodes.length ? "All permitted stations" : `${selected.length} of ${allCodes.length} stations`}</strong>
      <i>⌄</i>
    </summary>
    <div className="capacity-scope-popover">
      <div className="capacity-scope-search">
        <input aria-label="Search station, cluster or region" onChange={(event) => setQuery(event.target.value)} placeholder="Search station, cluster or region" value={query}/>
        <button onClick={() => { setSelected(allCodes); setQuery(""); }} type="button">All</button>
        <button onClick={() => setSelected([])} type="button">Clear</button>
      </div>
      <div className="capacity-scope-groups">
        <section>
          <h4>Regions</h4>
          {regions.map((region) => {
            const codes = stations.filter((station) => station.region === region).map((station) => station.code);
            return <label key={region}><input checked={groupChecked(codes)} onChange={(event) => toggleCodes(codes, event.target.checked)} type="checkbox"/><span><strong>{region}</strong><small>{codes.length} stations</small></span></label>;
          })}
          {!regions.length ? <p>No regions configured</p> : null}
        </section>
        <section>
          <h4>Clusters</h4>
          {clusters.map((cluster) => {
            const codes = stations.filter((station) => station.cluster === cluster).map((station) => station.code);
            return <label key={cluster}><input checked={groupChecked(codes)} onChange={(event) => toggleCodes(codes, event.target.checked)} type="checkbox"/><span><strong>{cluster}</strong><small>{codes.length} stations</small></span></label>;
          })}
          {!clusters.length ? <p>No clusters configured</p> : null}
        </section>
        <section>
          <h4>Stations</h4>
          {shownStations.map((station) => <label key={station.code}><input checked={selected.includes(station.code)} onChange={(event) => toggleCodes([station.code], event.target.checked)} type="checkbox"/><span><strong>{station.code}</strong><small>{station.name}</small></span></label>)}
          {!shownStations.length ? <p>No stations found</p> : null}
        </section>
      </div>
      <footer>
        <span>{selected.length} selected</span>
        <button onClick={() => setOpen(false)} type="button">Cancel</button>
        <button className="primary" onClick={apply} type="button">Apply</button>
      </footer>
    </div>
  </details>;
}
