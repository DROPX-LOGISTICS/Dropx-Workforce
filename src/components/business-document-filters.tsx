"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PendingLink } from "@/components/pending-link";

type FilterOption = {
  value: string;
  label: string;
};

export function BusinessDocumentFilters({
  documentOptions,
  locationOptions,
  stateOptions
}: {
  documentOptions: FilterOption[];
  locationOptions: FilterOption[];
  stateOptions: FilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    setSearch(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      updateParams(router, pathname, searchParams, { q: search.trim(), page: "" });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [pathname, router, search, searchParams]);

  const selectedDocuments = useMemo(() => parseSelected(searchParams.get("document")), [searchParams]);
  const selectedStates = useMemo(() => parseSelected(searchParams.get("state")), [searchParams]);
  const selectedLocations = useMemo(() => parseSelected(searchParams.get("location")), [searchParams]);
  const selectedExpiry = useMemo(() => parseSelected(searchParams.get("expiry")), [searchParams]);
  const hasFilters = Boolean(search.trim() || selectedDocuments.length || selectedStates.length || selectedLocations.length || selectedExpiry.length);

  function toggleFilter(key: "document" | "state" | "location" | "expiry", value: string) {
    const current = parseSelected(searchParams.get(key));
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    updateParams(router, pathname, searchParams, { [key]: next.join(","), page: "" });
  }

  return (
    <div className="business-doc-filter-bar">
      <input
        className="field business-doc-search"
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search document or reference"
        value={search}
      />
      <FilterDropdown
        label="Documents"
        options={documentOptions}
        selected={selectedDocuments}
        onToggle={(value) => toggleFilter("document", value)}
      />
      <FilterDropdown
        label="States"
        options={stateOptions}
        selected={selectedStates}
        onToggle={(value) => toggleFilter("state", value)}
      />
      <FilterDropdown
        label="Locations"
        options={locationOptions}
        selected={selectedLocations}
        onToggle={(value) => toggleFilter("location", value)}
      />
      <FilterDropdown
        label="Expiry"
        options={expiryOptions}
        selected={selectedExpiry}
        onToggle={(value) => toggleFilter("expiry", value)}
      />
      {hasFilters ? <PendingLink className="button secondary compact" href="/business-documents">Clear</PendingLink> : null}
    </div>
  );
}

const expiryOptions: FilterOption[] = [
  { value: "valid", label: "Valid" },
  { value: "15-30", label: "15-30 D" },
  { value: "7-15", label: "7-15 D" },
  { value: "0-7", label: "0-7 D" },
  { value: "expired", label: "Expired" }
];

function FilterDropdown({
  label,
  options,
  selected,
  onToggle
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [localSelected, setLocalSelected] = useState(selected);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(localSelected), [localSelected]);
  const filteredOptions = useMemo(() => {
    const term = query.trim().toLowerCase();
    return options.filter((option) => !term || option.label.toLowerCase().includes(term));
  }, [options, query]);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    setLocalSelected(selected);
  }, [selected]);

  function toggle(value: string) {
    setLocalSelected((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
    onToggle(value);
  }

  return (
    <div className="bulk-multi-filter business-doc-filter" ref={rootRef}>
      <button className={`bulk-multi-filter-trigger ${open ? "open" : ""}`} onClick={() => setOpen((current) => !current)} type="button">
        <strong>{localSelected.length ? `${label}: ${localSelected.length}` : `All ${label.toLowerCase()}`}</strong>
        <span>v</span>
      </button>
      {open ? (
        <div className="bulk-multi-filter-menu">
          <div className="bulk-multi-filter-search">
            <input className="field" onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} value={query} />
          </div>
          <div className="bulk-multi-filter-options">
            {filteredOptions.map((option) => (
              <label className="bulk-multi-filter-option" key={option.value}>
                <input checked={selectedSet.has(option.value)} onChange={() => toggle(option.value)} type="checkbox" />
                <span>{option.label}</span>
              </label>
            ))}
            {!filteredOptions.length ? <div className="dropdown-empty">No items found.</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function parseSelected(value: string | null) {
  return Array.from(new Set(String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean)));
}

function updateParams(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>,
  updates: Record<string, string>
) {
  const params = new URLSearchParams(searchParams.toString());
  Object.entries(updates).forEach(([key, value]) => {
    if (value) params.set(key, value);
    else params.delete(key);
  });
  if (params.toString() === searchParams.toString()) return;
  const query = params.toString();
  router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
}
