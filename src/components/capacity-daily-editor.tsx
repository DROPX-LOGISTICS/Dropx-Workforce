"use client";

import { useMemo, useState } from "react";
import { saveCapacityGroundUpdates } from "@/app/ops-pulse/capacity/daily/actions";

export type CapacityDailyEditorRow = {
  stationCode: string;
  stationName: string;
  region: string;
  cluster: string;
  inbound: number;
  saved: boolean;
  assignedPackages: number;
  regularBike: number;
  regularVan: number;
  regularVanVehicle: number;
  adHocBike: number;
  adHocVanVehicle: number;
  adHocVan: number;
  updatedAt: string | null;
};

type Counts = Pick<CapacityDailyEditorRow, "assignedPackages" | "regularBike" | "regularVan" | "regularVanVehicle" | "adHocBike" | "adHocVanVehicle" | "adHocVan">;
type SortKey = "station" | "region" | "cluster" | "inbound" | "assigned" | "regularBike" | "regularVan" | "regularVanVehicle" | "adHocBike" | "adHocVanVehicle" | "adHocVan" | "updated";

export function CapacityDailyEditor({ rows, workDate, returnQuery }: { rows: CapacityDailyEditorRow[]; workDate: string; returnQuery: string }) {
  const [values, setValues] = useState<Record<string, Counts>>(() => Object.fromEntries(rows.map((row) => [row.stationCode, {
    assignedPackages: row.assignedPackages, regularBike: row.regularBike, regularVan: row.regularVan, adHocBike: row.adHocBike,
    regularVanVehicle: row.regularVanVehicle, adHocVanVehicle: row.adHocVanVehicle, adHocVan: row.adHocVan
  }])));
  const [dirty, setDirty] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("station");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  function update(stationCode: string, key: keyof Counts, raw: string) {
    const value = Math.max(0, Math.floor(Number(raw) || 0));
    setValues((current) => ({ ...current, [stationCode]: { ...current[stationCode], [key]: value } }));
    setDirty((current) => current.includes(stationCode) ? current : [...current, stationCode]);
  }

  function sortValue(row: CapacityDailyEditorRow) {
    const counts = values[row.stationCode];
    if (sort === "station") return row.stationCode;
    if (sort === "region") return row.region;
    if (sort === "cluster") return row.cluster;
    if (sort === "inbound") return row.inbound;
    if (sort === "assigned") return counts.assignedPackages;
    if (sort === "updated") return row.updatedAt ?? "";
    return counts[sort];
  }

  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const a = sortValue(left);
    const b = sortValue(right);
    const compared = typeof a === "string" ? a.localeCompare(String(b)) : a - Number(b);
    return direction === "asc" ? compared : -compared;
  }), [direction, rows, sort, values]);
  const updated = rows.filter((row) => row.saved).length;

  function heading(label: string, key: SortKey) {
    const mark = sort === key ? direction === "asc" ? "↑" : "↓" : "↕";
    return <button aria-label={`Sort ${label}`} className="capacity-sort-button" onClick={() => {
      if (sort === key) setDirection((current) => current === "asc" ? "desc" : "asc");
      else { setSort(key); setDirection("asc"); }
    }} type="button">{label}<span>{mark}</span></button>;
  }

  return <form action={saveCapacityGroundUpdates}>
    <input name="work_date" type="hidden" value={workDate}/>
    <input name="return_query" type="hidden" value={returnQuery}/>
    <input name="station_codes" type="hidden" value={JSON.stringify(dirty)}/>
    <div className="capacity-daily-status-strip">
      <span><strong>{rows.length}</strong> stations</span>
      <span className="matched"><strong>{updated}</strong> updated</span>
      <span><strong>{rows.length - updated}</strong> pending</span>
      <button className="button compact" disabled={!dirty.length} type="submit">Save {dirty.length ? `${dirty.length} update${dirty.length === 1 ? "" : "s"}` : "updates"}</button>
    </div>
    <div className="table-wrap"><table className="capacity-daily-entry-table"><thead><tr>
      <th>{heading("Station", "station")}</th><th>{heading("Region", "region")}</th><th>{heading("Cluster", "cluster")}</th>
      <th>{heading("Inbound", "inbound")}</th><th>{heading("Assigned packages", "assigned")}</th>
      <th>{heading("Regular Bike DA", "regularBike")}</th><th>{heading("Regular Van DA", "regularVan")}</th>
      <th>{heading("Regular Van Count", "regularVanVehicle")}</th><th>{heading("External Bike DA", "adHocBike")}</th>
      <th>{heading("External Van DA", "adHocVan")}</th><th>{heading("External Ad hoc Van Count", "adHocVanVehicle")}</th>
      <th>{heading("Last update", "updated")}</th>
    </tr></thead><tbody>{sortedRows.map((row) => {
      const counts = values[row.stationCode];
      return <tr className={dirty.includes(row.stationCode) ? "edited" : ""} key={row.stationCode}>
        <td><strong>{row.stationCode}</strong><small>{row.stationName}</small></td><td>{row.region || "—"}</td><td>{row.cluster || "—"}</td>
        <td><strong>{row.inbound.toLocaleString("en-IN")}</strong></td>
        <td><input aria-label={`${row.stationCode} assigned packages`} min="0" name={`assigned_${row.stationCode}`} onChange={(event) => update(row.stationCode, "assignedPackages", event.target.value)} type="number" value={counts.assignedPackages}/></td>
        {(["regularBike", "regularVan", "regularVanVehicle", "adHocBike", "adHocVan", "adHocVanVehicle"] as const).map((key) => <td key={key}><input aria-label={`${row.stationCode} ${key}`} min="0" name={`${key === "adHocBike" ? "adhoc_bike" : key === "adHocVanVehicle" ? "adhoc_van_vehicle" : key === "adHocVan" ? "adhoc_van" : key === "regularBike" ? "regular_bike" : key === "regularVanVehicle" ? "regular_van_vehicle" : "regular_van"}_${row.stationCode}`} onChange={(event) => update(row.stationCode, key, event.target.value)} type="number" value={counts[key]}/></td>)}
        <td>{row.updatedAt ? <><strong>Saved</strong><small>{row.updatedAt.slice(0, 10)}</small></> : "—"}</td>
      </tr>;
    })}{!rows.length ? <tr><td className="empty-cell" colSpan={12}>No stations match the selected scope.</td></tr> : null}</tbody></table></div>
  </form>;
}
