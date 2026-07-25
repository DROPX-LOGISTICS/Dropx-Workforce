"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Station = { code: string; name: string; cluster: string };

export function OnboardingScopeFilter({ stations, selectedStations, selectedClusters, status }: {
  stations: Station[];
  selectedStations: string[];
  selectedClusters: string[];
  status: string;
}) {
  const router = useRouter();
  const clusters = useMemo(() => [...new Set(stations.map((row) => row.cluster).filter(Boolean))].sort(), [stations]);
  const [stationCodes, setStationCodes] = useState(selectedStations);
  const [clusterNames, setClusterNames] = useState(selectedClusters);
  const [open, setOpen] = useState(false);

  function toggleCluster(cluster: string, checked: boolean) {
    const codes = stations.filter((row) => row.cluster === cluster).map((row) => row.code);
    setClusterNames((current) => checked ? [...new Set([...current, cluster])] : current.filter((name) => name !== cluster));
    setStationCodes((current) => checked ? [...new Set([...current, ...codes])] : current.filter((code) => !codes.includes(code)));
  }

  function apply() {
    const params = new URLSearchParams({ status });
    if (stationCodes.length && stationCodes.length !== stations.length) params.set("stations", stationCodes.join(","));
    if (clusterNames.length) params.set("clusters", clusterNames.join(","));
    router.push(`/executive-id-onboarding?${params.toString()}`);
    setOpen(false);
  }

  return <details className="performance-station-filter onboarding-scope-filter" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>Scope</span><strong>{stationCodes.length === stations.length ? "All permitted stations" : `${stationCodes.length} stations${clusterNames.length ? ` · ${clusterNames.length} clusters` : ""}`}</strong><i>⌄</i></summary>
    <div className="performance-station-popover onboarding-filter-popover">
      <div className="onboarding-filter-columns">
        <section><h4>Clusters</h4>{clusters.map((cluster) => <label key={cluster}><input type="checkbox" checked={clusterNames.includes(cluster)} onChange={(event) => toggleCluster(cluster, event.target.checked)}/><span><strong>{cluster}</strong>{stations.filter((row) => row.cluster === cluster).length} stations</span></label>)}</section>
        <section><h4>Stations</h4>{stations.map((station) => <label key={station.code}><input type="checkbox" checked={stationCodes.includes(station.code)} onChange={(event) => setStationCodes((current) => event.target.checked ? [...new Set([...current, station.code])] : current.filter((code) => code !== station.code))}/><span><strong>{station.code}</strong>{station.name}</span></label>)}</section>
      </div>
      <div className="performance-station-actions"><button type="button" onClick={() => { setStationCodes(stations.map((row) => row.code)); setClusterNames([]); }}>Select all</button><button type="button" onClick={() => { setStationCodes([]); setClusterNames([]); }}>Clear</button></div>
      <div className="performance-station-footer"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button className="performance-station-apply" type="button" disabled={!stationCodes.length} onClick={apply}>Apply scope</button></div>
    </div>
  </details>;
}
