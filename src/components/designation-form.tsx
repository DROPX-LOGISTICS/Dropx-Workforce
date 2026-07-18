"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";

type ProviderOption = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type LocationOption = {
  id: string;
  station_code: string;
  station_name: string | null;
  hide_from_location_list?: boolean | null;
};

type DesignationInitial = {
  id: string;
  code: string;
  name: string;
  provider_ids: string[];
  location_ids: string[];
  is_active: boolean;
};

function LocationMultiSelect({
  locations,
  selected,
  setSelected
}: {
  locations: LocationOption[];
  selected: string[];
  setSelected: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = locations.filter((location) => {
    const haystack = `${location.station_code} ${location.station_name ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const selectedLocations = locations.filter((location) => selectedSet.has(location.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every((location) => selectedSet.has(location.id));

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function toggle(id: string) {
    setSelected(selectedSet.has(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }

  function toggleAllFiltered() {
    if (allFilteredSelected) {
      const filteredIds = new Set(filtered.map((location) => location.id));
      setSelected(selected.filter((value) => !filteredIds.has(value)));
      return;
    }
    setSelected(Array.from(new Set([...selected, ...filtered.map((location) => location.id)])));
  }

  return (
    <div className="multi-select" ref={rootRef}>
      <button
        className={`multi-select-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>{selectedLocations.length ? `${selectedLocations.length} selected` : "Select locations"}</span>
        <span>v</span>
      </button>
      {open ? (
        <div className="multi-select-menu designation-provider-menu">
          <input
            className="field multi-select-search-field"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search location"
            value={query}
          />
          <label className="multi-select-all">
            <input checked={allFilteredSelected} onChange={toggleAllFiltered} type="checkbox" />
            <span>Select all</span>
            <small>{filtered.length} shown</small>
          </label>
          <div className="multi-select-options">
            {filtered.length ? filtered.map((location) => (
              <label className="multi-select-option" key={location.id}>
                <input checked={selectedSet.has(location.id)} onChange={() => toggle(location.id)} type="checkbox" />
                <span>
                  <strong>{location.station_code}</strong>
                  <small>{[location.station_name, location.hide_from_location_list ? "Hidden" : ""].filter(Boolean).join(" | ")}</small>
                </span>
              </label>
            )) : <div className="searchable-empty">No locations found.</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DesignationForm({
  action,
  initial,
  locations,
  submitLabel = "Add designation"
}: {
  action: (formData: FormData) => void;
  initial?: DesignationInitial | null;
  providers?: ProviderOption[];
  locations: LocationOption[];
  submitLabel?: string;
}) {
  const [selectedLocations, setSelectedLocations] = useState<string[]>(initial?.location_ids ?? []);

  return (
    <form action={action} className="designation-form">
      {initial ? <input name="id" type="hidden" value={initial.id} /> : null}
      {selectedLocations.map((locationId) => (
        <input key={locationId} name="location_ids" type="hidden" value={locationId} />
      ))}
      <div className="form-grid three">
        <label>
          Designation code
          <input className="field" defaultValue={initial?.code ?? ""} name="code" placeholder="Enter designation code" required />
        </label>
        <label>
          Designation name
          <input className="field" defaultValue={initial?.name ?? ""} name="name" placeholder="Enter designation name" required />
        </label>
        <label>
          Locations
          <LocationMultiSelect locations={locations} selected={selectedLocations} setSelected={setSelectedLocations} />
        </label>
        {initial ? (
          <label>
            Status
            <select className="field" defaultValue={initial.is_active ? "active" : "inactive"} name="status">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        ) : null}
      </div>
      <div className="form-actions right">
        <SubmitButton className="button" pendingText="Saving">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
