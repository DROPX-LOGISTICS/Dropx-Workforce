"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type LocationScopeOption = {
  id: string;
  code: string;
  name: string;
  city?: string | null;
  state?: string | null;
  provider?: string | null;
  model?: string | null;
};

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
}

export function LocationScopeSelect({
  defaultSelectedIds = [],
  locations,
  disabled = false,
  readOnly = false
}: {
  defaultSelectedIds?: string[];
  locations: LocationScopeOption[];
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const [provider, setProvider] = useState("all");
  const [model, setModel] = useState("all");
  const [selected, setSelected] = useState<string[]>(defaultSelectedIds);

  const states = useMemo(() => unique(locations.map((location) => location.state)), [locations]);
  const providers = useMemo(() => unique(locations.map((location) => location.provider)), [locations]);
  const models = useMemo(() => unique(locations.map((location) => location.model)), [locations]);

  const filteredLocations = useMemo(() => {
    const term = search.trim().toLowerCase();

    return locations.filter((location) => {
      const matchesSearch = !term || [
        location.code,
        location.name,
        location.city,
        location.state,
        location.provider,
        location.model
      ].some((value) => (value ?? "").toLowerCase().includes(term));
      const matchesState = state === "all" || location.state === state;
      const matchesProvider = provider === "all" || location.provider === provider;
      const matchesModel = model === "all" || location.model === model;

      return matchesSearch && matchesState && matchesProvider && matchesModel;
    });
  }, [locations, model, provider, search, state]);

  const selectedLocations = locations.filter((location) => selected.includes(location.id));
  const allFilteredSelected = filteredLocations.length > 0 && filteredLocations.every((location) => selected.includes(location.id));

  useEffect(() => {
    const availableIds = new Set(locations.map((location) => location.id));
    setSelected((current) => current.filter((id) => availableIds.has(id)));
  }, [locations]);

  useEffect(() => {
    if (readOnly) setSelected(defaultSelectedIds);
  }, [defaultSelectedIds, readOnly]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleLocation(locationId: string, checked: boolean) {
    if (readOnly || disabled) return;
    setSelected((current) => {
      if (checked) return Array.from(new Set([...current, locationId]));
      return current.filter((id) => id !== locationId);
    });
  }

  function toggleFiltered(checked: boolean) {
    if (readOnly || disabled) return;
    setSelected((current) => {
      const filteredIds = filteredLocations.map((location) => location.id);
      if (checked) return Array.from(new Set([...current, ...filteredIds]));
      return current.filter((id) => !filteredIds.includes(id));
    });
  }

  function clearFilters() {
    setSearch("");
    setState("all");
    setProvider("all");
    setModel("all");
  }

  const summary = selectedLocations.length
    ? `${selectedLocations.length} selected`
    : locations.length
      ? "Select locations"
      : "No locations added";

  return (
    <div className="multi-select" ref={containerRef}>
      <input name="location_scope_ids" type="hidden" value={JSON.stringify(selected)} />
      <button
        className={`multi-select-trigger ${open ? "open" : ""}`}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span>{summary}</span>
        <ChevronDown aria-hidden="true" className="multi-select-chevron" size={16} strokeWidth={2.4} />
      </button>
      {open ? (
        <div className="multi-select-menu">
          <div className="multi-select-filters">
            <select className="select" onChange={(event) => setState(event.target.value)} value={state}>
              <option value="all">All states</option>
              {states.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select className="select" onChange={(event) => setProvider(event.target.value)} value={provider}>
              <option value="all">All providers</option>
              {providers.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select className="select" onChange={(event) => setModel(event.target.value)} value={model}>
              <option value="all">All models</option>
              {models.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div className="multi-select-search">
            <input
              className="field"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search location"
              value={search}
            />
            <button className="button secondary" onClick={clearFilters} type="button">Clear</button>
          </div>
          <label className="multi-select-all">
            <input
              checked={allFilteredSelected}
              className="matrix-checkbox"
              disabled={readOnly}
              onChange={(event) => toggleFiltered(event.target.checked)}
              type="checkbox"
            />
            <span>{readOnly ? "All selected from role" : "Check all filtered"}</span>
            <small>{filteredLocations.length} shown</small>
          </label>
          <div className="multi-select-options">
            {filteredLocations.length ? filteredLocations.map((location) => (
              <label className="multi-select-option" key={location.id}>
                <input
                  checked={selected.includes(location.id)}
                  className="matrix-checkbox"
                  disabled={readOnly}
                  onChange={(event) => toggleLocation(location.id, event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>{location.code}</strong>
                  <small>{[location.provider, location.model].filter(Boolean).join(" - ") || location.name}</small>
                </span>
              </label>
            )) : (
              <div className="searchable-empty">No locations found</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
