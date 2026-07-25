"use client";

import { switchOperatingContext } from "@/app/ops-pulse/actions";
import { useMemo, useState } from "react";
import type { CodLocationRow } from "@/lib/ops-pulse/cod";
import { locationLabel } from "@/lib/ops-pulse/cod";
import type { OperatingMode } from "@/lib/ops-pulse/operating-context";

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort();
}

function HierarchyField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  if (!options.length) {
    return (
      <div className="ops-context-fixed">
        <small>{label}</small>
        <strong>Not configured</strong>
      </div>
    );
  }
  if (options.length === 1) return <div className="ops-context-fixed"><small>{label}</small><strong>{options[0]}</strong></div>;
  return (
    <label><small>{label}</small><select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">All {label.toLowerCase()}s</option>
      {options.map((option) => <option key={option}>{option}</option>)}
    </select></label>
  );
}

export function OpsContextSwitcher({
  availableModes,
  locationId,
  locationModes,
  locations,
  mode
}: {
  availableModes: Array<{ code: OperatingMode; label: string }>;
  locationId: string;
  locationModes: Record<string, OperatingMode | null>;
  locations: CodLocationRow[];
  mode: OperatingMode;
}) {
  const initial = locations.find((location) => location.id === locationId);
  const [selectedMode, setSelectedMode] = useState(mode);
  const [region, setRegion] = useState(initial?.region ?? "");
  const [aom, setAom] = useState(initial?.aom ?? "");
  const [clusterManager, setClusterManager] = useState(initial?.cluster_manager ?? "");
  const [cluster, setCluster] = useState(initial?.cluster ?? "");
  const modeLocations = useMemo(() => locations.filter((location) => locationModes[location.id] === selectedMode), [locationModes, locations, selectedMode]);
  const regions = unique(modeLocations.map((location) => location.region));
  const regionLocations = region ? modeLocations.filter((location) => location.region === region) : modeLocations;
  const aoms = unique(regionLocations.map((location) => location.aom));
  const aomLocations = aom ? regionLocations.filter((location) => location.aom === aom) : regionLocations;
  const managers = unique(aomLocations.map((location) => location.cluster_manager));
  const managerLocations = clusterManager ? aomLocations.filter((location) => location.cluster_manager === clusterManager) : aomLocations;
  const clusters = unique(managerLocations.map((location) => location.cluster));
  const filteredLocations = cluster ? managerLocations.filter((location) => location.cluster === cluster) : managerLocations;
  const selectedLocation = filteredLocations.some((location) => location.id === locationId) ? locationId : filteredLocations[0]?.id;
  const canSwitch = availableModes.length > 1 || modeLocations.length > 1;

  function changeMode(next: OperatingMode) {
    setSelectedMode(next);
    setRegion("");
    setAom("");
    setClusterManager("");
    setCluster("");
  }

  return (
    <form action={switchOperatingContext} className="ops-context-switcher">
      <span>OPSPULSE SCOPE</span>
      {availableModes.length > 1 ? (
        <label><small>Model</small><select name="mode" value={selectedMode} onChange={(event) => changeMode(event.target.value as OperatingMode)}>
          {availableModes.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
        </select></label>
      ) : <><input type="hidden" name="mode" value={selectedMode} /><div className="ops-context-fixed"><small>Model</small><strong>{availableModes[0]?.label}</strong></div></>}
      <HierarchyField label="Region" options={regions} value={region} onChange={(value) => { setRegion(value); setAom(""); setClusterManager(""); setCluster(""); }} />
      <HierarchyField label="AOM" options={aoms} value={aom} onChange={(value) => { setAom(value); setClusterManager(""); setCluster(""); }} />
      <HierarchyField label="Cluster Manager" options={managers} value={clusterManager} onChange={(value) => { setClusterManager(value); setCluster(""); }} />
      <HierarchyField label="Cluster" options={clusters} value={cluster} onChange={setCluster} />
      {filteredLocations.length > 1 ? (
        <label><small>Location</small><select name="location" defaultValue={selectedLocation} key={`${selectedMode}-${region}-${aom}-${clusterManager}-${cluster}`}>
          {filteredLocations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
        </select></label>
      ) : <><input type="hidden" name="location" value={selectedLocation ?? locationId} /><div className="ops-context-fixed"><small>Location</small><strong>{filteredLocations[0] ? locationLabel(filteredLocations[0]) : "No location"}</strong></div></>}
      {canSwitch ? <button type="submit">Apply Ops scope</button> : null}
    </form>
  );
}
