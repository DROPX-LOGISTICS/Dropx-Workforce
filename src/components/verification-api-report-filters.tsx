"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type VerificationReportFilterOption = {
  label: string;
  value: string;
};

type FilterKey = "kind" | "profile_type" | "result" | "source";

function parseSelected(value: string | null) {
  return Array.from(new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

export function VerificationApiReportFilters({
  kindOptions,
  profileOptions,
  resultOptions,
  sourceOptions
}: {
  kindOptions: VerificationReportFilterOption[];
  profileOptions: VerificationReportFilterOption[];
  resultOptions: VerificationReportFilterOption[];
  sourceOptions: VerificationReportFilterOption[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");

  useEffect(() => {
    setSearch(searchParams.get("search") ?? "");
  }, [searchParams]);

  useEffect(() => {
    if (search.trim() === (searchParams.get("search") ?? "")) return;
    const timer = window.setTimeout(() => {
      updateParams(router, pathname, searchParams, { search: search.trim(), page: "" });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [pathname, router, search, searchParams]);

  const selectedKinds = useMemo(() => parseSelected(searchParams.get("kind")), [searchParams]);
  const selectedSources = useMemo(() => parseSelected(searchParams.get("source")), [searchParams]);
  const selectedProfiles = useMemo(() => parseSelected(searchParams.get("profile_type")), [searchParams]);
  const selectedResults = useMemo(() => parseSelected(searchParams.get("result")), [searchParams]);
  const exportParams = new URLSearchParams(searchParams.toString());
  exportParams.delete("page");
  exportParams.delete("per_page");
  const exportQuery = exportParams.toString();
  const exportHref = `/api/reports/verification-api/export${exportQuery ? `?${exportQuery}` : ""}`;
  const hasFilters = Boolean(
    search.trim() ||
    searchParams.get("from") ||
    searchParams.get("to") ||
    selectedKinds.length ||
    selectedSources.length ||
    selectedProfiles.length ||
    selectedResults.length
  );

  function setFilterValues(key: FilterKey, values: string[]) {
    updateParams(router, pathname, searchParams, { [key]: values.join(","), page: "" });
  }

  return (
    <div className="verification-api-report-filters">
      <label>
        From
        <input
          className="field"
          onChange={(event) => updateParams(router, pathname, searchParams, { from: event.target.value, page: "" })}
          type="date"
          value={searchParams.get("from") ?? ""}
        />
      </label>
      <label>
        To
        <input
          className="field"
          onChange={(event) => updateParams(router, pathname, searchParams, { to: event.target.value, page: "" })}
          type="date"
          value={searchParams.get("to") ?? ""}
        />
      </label>
      <MultiCheckFilter
        allLabel="All API types"
        label="API type"
        options={kindOptions}
        selected={selectedKinds}
        onChange={(values) => setFilterValues("kind", values)}
      />
      <MultiCheckFilter
        allLabel="All platforms"
        label="Platform"
        options={sourceOptions}
        selected={selectedSources}
        onChange={(values) => setFilterValues("source", values)}
      />
      <MultiCheckFilter
        allLabel="All categories"
        label="Category"
        options={profileOptions}
        selected={selectedProfiles}
        onChange={(values) => setFilterValues("profile_type", values)}
      />
      <MultiCheckFilter
        allLabel="All results"
        label="Result"
        options={resultOptions}
        selected={selectedResults}
        onChange={(values) => setFilterValues("result", values)}
      />
      <label className="verification-api-report-search">
        Search
        <input
          className="field"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="DropX ID, name, user, or message"
          value={search}
        />
      </label>
      <label className="verification-api-page-size">
        Records per page
        <select
          className="field"
          onChange={(event) => updateParams(router, pathname, searchParams, { per_page: event.target.value, page: "" })}
          value={searchParams.get("per_page") ?? "20"}
        >
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </label>
      <div className="verification-api-filter-actions">
        {hasFilters ? (
          <button
            className="button secondary"
            onClick={() => {
              setSearch("");
              router.replace(pathname, { scroll: false });
            }}
            type="button"
          >
            Clear
          </button>
        ) : null}
        <a className="button secondary verification-api-export-button" href={exportHref}>
          <Download aria-hidden="true" size={16} strokeWidth={2.2} />
          Export Excel
        </a>
      </div>
    </div>
  );
}

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
  options: VerificationReportFilterOption[];
  selected: string[];
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
  const allSelected = options.length > 0 && options.every((option) => selectedSet.has(option.value));

  useEffect(() => {
    setLocalSelected(selected);
  }, [selected]);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function change(values: string[]) {
    setLocalSelected(values);
    onChange(values);
  }

  function toggle(value: string) {
    change(
      localSelected.includes(value)
        ? localSelected.filter((item) => item !== value)
        : [...localSelected, value]
    );
  }

  return (
    <div className="verification-api-filter-field" ref={rootRef}>
      <span>{label}</span>
      <button
        aria-expanded={open}
        className={`bulk-multi-filter-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <strong>{localSelected.length ? `${localSelected.length} selected` : allLabel}</strong>
        <span>v</span>
      </button>
      {open ? (
        <div className="bulk-multi-filter-menu verification-api-filter-menu">
          <div className="bulk-multi-filter-search">
            <input
              autoFocus
              className="field"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              value={query}
            />
          </div>
          <label className="multi-select-all">
            <input
              checked={allSelected}
              onChange={() => change(allSelected ? [] : options.map((option) => option.value))}
              type="checkbox"
            />
            <span><strong>Select all</strong></span>
            <small>{localSelected.length} of {options.length}</small>
          </label>
          <div className="bulk-multi-filter-options">
            {filteredOptions.map((option) => (
              <label className="bulk-multi-filter-option" key={option.value}>
                <input
                  checked={selectedSet.has(option.value)}
                  onChange={() => toggle(option.value)}
                  type="checkbox"
                />
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
  router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
}
