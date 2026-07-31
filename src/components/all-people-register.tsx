"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { StatusPill } from "@/components/status-pill";

export type AllPeopleRow = {
  category: string;
  categoryCode: string;
  code: string;
  biometricId: string;
  fullName: string;
  mobile: string;
  email: string;
  location: string;
  designation: string;
  status: string;
};

type FilterOption = { value: string; label: string };

function MultiCheckFilter({
  allLabel,
  label,
  onChange,
  options,
  selected
}: {
  allLabel: string;
  label: string;
  onChange: (values: string[]) => void;
  options: FilterOption[];
  selected: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filteredOptions = useMemo(() => {
    const term = query.trim().toLowerCase();
    return options.filter((option) => !term || option.label.toLowerCase().includes(term));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle(value: string) {
    onChange(selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  return (
    <div className="bulk-multi-filter all-people-filter" ref={rootRef}>
      <button className={`bulk-multi-filter-trigger ${open ? "open" : ""}`} onClick={() => setOpen((current) => !current)} type="button">
        <strong>{selected.length ? `${label}: ${selected.length}` : allLabel}</strong>
        <span>v</span>
      </button>
      {open ? (
        <div className="bulk-multi-filter-menu">
          <div className="bulk-multi-filter-search">
            <input className="field" onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} value={query} />
          </div>
          <div className="bulk-multi-filter-options">
            <label className="bulk-multi-filter-option all">
              <input checked={!selected.length} onChange={() => onChange([])} type="checkbox" />
              <span>All</span>
            </label>
            {filteredOptions.map((option) => (
              <label className="bulk-multi-filter-option" key={option.value}>
                <input checked={selectedSet.has(option.value)} onChange={() => toggle(option.value)} type="checkbox" />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function optionsFrom(values: string[]) {
  return Array.from(new Set(values.filter((value) => value && value !== "-")))
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));
}

export function AllPeopleRegister({ rows }: { rows: AllPeopleRow[] }) {
  const [search, setSearch] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [designations, setDesignations] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);

  const categoryOptions = useMemo(() => (
    Array.from(new Map(rows.map((row) => [row.categoryCode, row.category])).entries())
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([value, label]) => ({ value, label }))
  ), [rows]);
  const locationOptions = useMemo(() => optionsFrom(rows.map((row) => row.location)), [rows]);
  const designationOptions = useMemo(() => optionsFrom(rows.map((row) => row.designation)), [rows]);
  const statusOptions = useMemo(() => optionsFrom(rows.map((row) => row.status)), [rows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (categories.length && !categories.includes(row.categoryCode)) return false;
      if (locations.length && !locations.includes(row.location)) return false;
      if (designations.length && !designations.includes(row.designation)) return false;
      if (statuses.length && !statuses.includes(row.status)) return false;
      return !term || `${row.code} ${row.biometricId} ${row.fullName} ${row.mobile} ${row.email} ${row.location} ${row.designation} ${row.category}`.toLowerCase().includes(term);
    });
  }, [categories, designations, locations, rows, search, statuses]);

  return (
    <section className="panel">
      <div className="panel-head toolbar">
        <div>
          <h2>People register</h2>
          <p className="subtle">{filteredRows.length} of {rows.length} records</p>
        </div>
        <div className="all-people-filters">
          <input className="field all-people-search" onChange={(event) => setSearch(event.target.value)} placeholder="Search ID, name, mobile, email" value={search} />
          <MultiCheckFilter allLabel="All categories" label="Category" onChange={setCategories} options={categoryOptions} selected={categories} />
          <MultiCheckFilter allLabel="All locations" label="Location" onChange={setLocations} options={locationOptions} selected={locations} />
          <MultiCheckFilter allLabel="All designations" label="Designation" onChange={setDesignations} options={designationOptions} selected={designations} />
          <MultiCheckFilter allLabel="All statuses" label="Status" onChange={setStatuses} options={statusOptions} selected={statuses} />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>DropX ID</th><th>Biometric ID</th><th>Full name</th><th>Category</th><th>Mobile</th><th>Email</th><th>Location</th><th>Designation</th><th>Status</th></tr></thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={`${row.category}:${row.code}`}>
                <td><strong>{row.code}</strong></td><td>{row.biometricId}</td><td><strong>{row.fullName}</strong></td>
                <td>{row.category}</td><td>{row.mobile}</td><td>{row.email}</td><td>{row.location}</td><td>{row.designation}</td>
                <td><StatusPill status={row.status} /></td>
              </tr>
            ))}
            {!filteredRows.length ? <tr><td className="empty-cell" colSpan={9}>No people match the selected filters.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
