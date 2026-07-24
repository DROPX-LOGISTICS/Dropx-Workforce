"use client";

import { switchOperatingContext } from "@/app/ops-pulse/actions";
import { useMemo, useState } from "react";
import type { CodLocationRow } from "@/lib/ops-pulse/cod";
import { locationLabel } from "@/lib/ops-pulse/cod";
import type { OperatingMode } from "@/lib/ops-pulse/operating-context";

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
  const [selectedMode, setSelectedMode] = useState(mode);
  const modeLocations = useMemo(
    () => locations.filter((location) => locationModes[location.id] === selectedMode),
    [locationModes, locations, selectedMode]
  );
  const canSwitchModel = availableModes.length > 1;
  const canSwitchLocation = modeLocations.length > 1;
  return (
    <form action={switchOperatingContext} className="ops-context-switcher">
      <span>OPERATING CONTEXT</span>
      {canSwitchModel ? (
        <label>
          <small>Model</small>
          <select name="mode" value={selectedMode} onChange={(event) => setSelectedMode(event.target.value as OperatingMode)}>
            {availableModes.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
          </select>
        </label>
      ) : <><input type="hidden" name="mode" value={mode} /><strong>{availableModes[0]?.label}</strong></>}
      {canSwitchLocation ? (
        <label>
          <small>Location</small>
        <select name="location" defaultValue={modeLocations.some((location) => location.id === locationId) ? locationId : modeLocations[0]?.id}>
          {modeLocations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
        </select>
      </label>
      ) : <><input type="hidden" name="location" value={modeLocations[0]?.id ?? locationId} /><small>{modeLocations[0] ? locationLabel(modeLocations[0]) : "No location"}</small></>}
      {canSwitchModel || canSwitchLocation ? <button type="submit">Switch workspace</button> : null}
    </form>
  );
}
