"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SearchableSelect } from "@/components/searchable-select";
import { SubmitButton } from "@/components/submit-button";

type DocumentTypeOption = {
  id: string;
  code: string;
  name: string;
  requires_expiry: boolean;
  business_scope_mode: string | null;
  enable_scope_access: boolean;
};

type ScopeOption = {
  id: string;
  code: string;
  name: string;
};

type InitialBusinessDocument = {
  id: string;
  document_type_id: string;
  scope_type: string;
  scope_id: string | null;
  scope_label: string;
  additional_scope_ids?: string[] | null;
  reference_no: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  track_expiry?: boolean | null;
};

export function BusinessDocumentForm({
  action,
  documentTypes,
  initial,
  locations,
  providers,
  states,
  submitLabel = "Save document"
}: {
  action: (formData: FormData) => void;
  documentTypes: DocumentTypeOption[];
  initial?: InitialBusinessDocument;
  locations: ScopeOption[];
  providers: ScopeOption[];
  states: ScopeOption[];
  submitLabel?: string;
}) {
  const [documentTypeId, setDocumentTypeId] = useState(initial?.document_type_id ?? "");
  const selectedDocument = useMemo(
    () => documentTypes.find((document) => document.id === documentTypeId) ?? null,
    [documentTypeId, documentTypes]
  );
  const scopeType = selectedDocument?.business_scope_mode ?? "";
  const scopeOptions = scopeType === "state"
    ? states
    : scopeType === "provider"
      ? providers
      : scopeType === "location"
        ? locations
        : [];
  const initialScopeValue = initial?.scope_type === scopeType ? initial.scope_id ?? "" : "";
  const [scopeId, setScopeId] = useState(initialScopeValue);
  const [trackExpiry, setTrackExpiry] = useState(initial?.track_expiry ?? selectedDocument?.requires_expiry ?? false);
  const documentTypeOptions = documentTypes.map((document) => ({
    value: document.id,
    label: `${document.name} (${document.code})`,
    helper: scopeLabel(document.business_scope_mode ?? "company")
  }));
  const scopeSelectOptions = scopeOptions.map((option) => ({
    value: option.id,
    label: `${option.code} - ${option.name}`
  }));
  function handleDocumentTypeChange(value: string) {
    setDocumentTypeId(value);
    setScopeId("");
    const nextDocument = documentTypes.find((document) => document.id === value);
    setTrackExpiry(nextDocument?.requires_expiry ?? false);
  }

  return (
    <form action={action} className="form-grid">
      {initial ? <input name="id" type="hidden" value={initial.id} /> : null}
      <input name="scope_type" type="hidden" value={scopeType} />
      <input name="track_expiry" type="hidden" value={trackExpiry ? "on" : "off"} />
      {scopeOptions.map((option) => <input key={option.id} name={`scope_label_${option.id}`} type="hidden" value={`${option.code} - ${option.name}`} />)}
      <label>
        Document type
        <SearchableSelect
          name="document_type_id"
          onValueChange={handleDocumentTypeChange}
          options={documentTypeOptions}
          placeholder="Search document type"
          required
          value={documentTypeId}
        />
      </label>
      {scopeType && scopeType !== "company" ? (
        <label>
          {scopeLabel(scopeType)}
          <SearchableSelect
            key={`${documentTypeId}-${scopeType}`}
            name="scope_id"
            onValueChange={setScopeId}
            options={scopeSelectOptions}
            placeholder={`Search ${scopeLabel(scopeType).toLowerCase()}`}
            required
            value={scopeId}
          />
        </label>
      ) : null}
      {selectedDocument?.enable_scope_access && scopeType && scopeType !== "company" ? (
        <label>
          Additional scope access
          <ScopeAccessMultiSelect
            name="additional_scope_ids"
            options={scopeOptions}
            primaryScopeId={scopeId}
            selectedValues={initial?.additional_scope_ids ?? []}
            scopeType={scopeType}
          />
        </label>
      ) : null}
      {scopeType === "company" ? <input name="scope_label" type="hidden" value="Company" /> : null}
      {documentTypeId && !scopeType ? (
        <div className="full-span inline-error">Set Scope type for this document in Master Data &gt; Documents.</div>
      ) : null}
      <label>
        Reference number
        <input className="field" defaultValue={initial?.reference_no ?? ""} name="reference_no" placeholder="GSTIN / PAN / license no" />
      </label>
      <label>
        Issue date
        <input className="field" defaultValue={initial?.issue_date ?? ""} name="issue_date" type="date" />
      </label>
      <label className="check-row business-expiry-check">
        <input checked={trackExpiry} onChange={(event) => setTrackExpiry(event.target.checked)} type="checkbox" />
        <span>Track expiry date for this document</span>
      </label>
      <label>
        Expiry date
        <input className="field" defaultValue={initial?.expiry_date ?? ""} disabled={!trackExpiry} name="expiry_date" required={trackExpiry} type="date" />
      </label>
      <label className="full-span">
        File
        <input className="field" name="file" type="file" />
      </label>
      <div className="form-actions full-span">
        <SubmitButton disabled={Boolean(documentTypeId && !scopeType)} disabledText="Scope needed" pendingText="Saving">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

function ScopeAccessMultiSelect({
  name,
  options,
  primaryScopeId,
  selectedValues,
  scopeType
}: {
  name: string;
  options: ScopeOption[];
  primaryScopeId: string;
  selectedValues: string[];
  scopeType: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(selectedValues);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filteredOptions = useMemo(() => {
    const term = query.trim().toLowerCase();
    return options.filter((option) => option.id !== primaryScopeId && (!term || `${option.code} ${option.name}`.toLowerCase().includes(term)));
  }, [options, primaryScopeId, query]);
  const selectedLabels = options.filter((option) => selectedSet.has(option.id)).map((option) => option.code);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    setSelected(selectedValues);
  }, [selectedValues]);

  useEffect(() => {
    if (!primaryScopeId) return;
    setSelected((current) => current.filter((id) => id !== primaryScopeId));
  }, [primaryScopeId]);

  function toggle(value: string) {
    setSelected((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function toggleAllFiltered() {
    const filteredIds = filteredOptions.map((option) => option.id);
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedSet.has(id));
    setSelected((current) => {
      if (allSelected) return current.filter((id) => !filteredIds.includes(id));
      return Array.from(new Set([...current, ...filteredIds]));
    });
  }

  return (
    <div className="multi-select business-scope-access-select" ref={rootRef}>
      {selected.map((value) => <input key={value} name={name} type="hidden" value={value} />)}
      <button className={`multi-select-trigger ${open ? "open" : ""}`} onClick={() => setOpen((current) => !current)} type="button">
        <span>{selectedLabels.length ? selectedLabels.join(", ") : `Select ${scopeLabel(scopeType).toLowerCase()} access`}</span>
        <strong>v</strong>
      </button>
      {open ? (
        <div className="multi-select-menu">
          <div className="multi-select-search">
            <input className="field multi-select-search-field" onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${scopeLabel(scopeType).toLowerCase()}`} value={query} />
          </div>
          <label className="multi-select-all">
            <input checked={filteredOptions.length > 0 && filteredOptions.every((option) => selectedSet.has(option.id))} onChange={toggleAllFiltered} type="checkbox" />
            <span>Select visible</span>
            <small>{filteredOptions.length} item{filteredOptions.length === 1 ? "" : "s"}</small>
          </label>
          <div className="multi-select-options">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <label className="multi-select-option" key={option.id}>
                <input checked={selectedSet.has(option.id)} onChange={() => toggle(option.id)} type="checkbox" />
                <span>{option.code}</span>
                <small>{option.name}</small>
              </label>
            )) : <div className="searchable-empty">No items found.</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function scopeLabel(scopeType: string) {
  const labels: Record<string, string> = {
    company: "Company",
    state: "State",
    provider: "Provider",
    location: "Location"
  };
  return labels[scopeType] ?? "Scope";
}
