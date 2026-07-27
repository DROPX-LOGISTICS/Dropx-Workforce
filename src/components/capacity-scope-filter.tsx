"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type CapacityScopeStation = {
  code: string;
  name: string;
  cluster: string;
  region: string;
};

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
      <span>Stations</span>
      <strong>{selected.length === allCodes.length ? "All stations" : `${selected.length} selected`}</strong>
      <i>⌄</i>
    </summary>
    <div className="capacity-scope-popover">
      <div className="capacity-scope-search">
        <input autoFocus aria-label="Search permitted stations" onChange={(event) => setQuery(event.target.value)} placeholder="Search station" value={query}/>
        <button onClick={() => { setSelected(allCodes); setQuery(""); }} type="button">All</button>
        <button onClick={() => setSelected([])} type="button">Clear</button>
      </div>
      <div className="capacity-station-options">
        {shownStations.map((station) => <label key={station.code}><input checked={selected.includes(station.code)} onChange={(event) => toggleCodes([station.code], event.target.checked)} type="checkbox"/><span><strong>{station.code}</strong><small>{station.name}{station.cluster ? ` · ${station.cluster}` : ""}</small></span></label>)}
        {!shownStations.length ? <p>No permitted stations found</p> : null}
      </div>
      <footer>
        <span>{selected.length} selected</span>
        <button onClick={() => setOpen(false)} type="button">Cancel</button>
        <button className="primary" onClick={apply} type="button">Apply</button>
      </footer>
    </div>
  </details>;
}
