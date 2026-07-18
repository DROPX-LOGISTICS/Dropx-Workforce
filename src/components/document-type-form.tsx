"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";

export type DocumentRoleOption = {
  code: string;
  id: string;
  name: string;
};

type DocumentTypeFormRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  document_module: string;
  business_scope_mode: string | null;
  doc_access_mode: string | null;
  access_role_ids?: string[];
  enable_scope_access: boolean;
  requires_expiry: boolean;
  reminder_days: number;
  is_active: boolean;
};

export function DocumentTypeForm({
  action,
  initial,
  roleOptions = [],
  codeLocked = false,
  submitLabel = "Save document"
}: {
  action: (formData: FormData) => void;
  initial?: DocumentTypeFormRow;
  roleOptions?: DocumentRoleOption[];
  codeLocked?: boolean;
  submitLabel?: string;
}) {
  const [documentModule, setDocumentModule] = useState(initial?.document_module === "business" ? "business" : "fleet");
  const [docAccessMode, setDocAccessMode] = useState(initial?.doc_access_mode === "role_based" ? "role_based" : "all_users");
  const scopeDisabled = documentModule === "fleet";
  const roleSelectDisabled = docAccessMode !== "role_based";

  return (
    <form action={action} className="form-grid">
      {initial ? <input name="id" type="hidden" value={initial.id} /> : null}
      {scopeDisabled ? <input name="business_scope_mode" type="hidden" value="" /> : null}
      <label>
        Document code
        <input
          className="field"
          defaultValue={initial?.code.toUpperCase() ?? ""}
          name="code"
          placeholder="FLEET_INSURANCE"
          readOnly={codeLocked}
          required
          style={{ textTransform: "uppercase" }}
        />
      </label>
      <label>
        Document name
        <input className="field" defaultValue={initial?.name ?? ""} name="name" placeholder="Insurance" required />
      </label>
      <label>
        Document module
        <select className="field" name="document_module" onChange={(event) => setDocumentModule(event.target.value)} value={documentModule}>
          <option value="fleet">Fleet Doc</option>
          <option value="business">Business Doc</option>
        </select>
      </label>
      <label>
        Scope type
        <select className="field" defaultValue={scopeDisabled ? "" : initial?.business_scope_mode ?? ""} disabled={scopeDisabled} name="business_scope_mode">
          <option value="">Select scope</option>
          <option value="company">Company</option>
          <option value="state">State</option>
          <option value="provider">Provider</option>
          <option value="location">Location</option>
        </select>
      </label>
      <label>
        Doc access
        <select className="field" name="doc_access_mode" onChange={(event) => setDocAccessMode(event.target.value)} value={docAccessMode}>
          <option value="all_users">All user access</option>
          <option value="role_based">Role based access</option>
        </select>
      </label>
      <label>
        User role
        <RoleAccessMultiSelect
          disabled={roleSelectDisabled}
          name="access_role_ids"
          options={roleOptions}
          selectedValues={roleSelectDisabled ? [] : initial?.access_role_ids ?? []}
        />
      </label>
      <label className="full-span">
        Description
        <input className="field" defaultValue={initial?.description ?? ""} name="description" placeholder="Policy copy and renewal tracking" />
      </label>
      <label className="check-row business-expiry-check">
        <input defaultChecked={initial?.enable_scope_access ?? false} disabled={documentModule !== "business"} name="enable_scope_access" type="checkbox" />
        <span>Enable scope access</span>
      </label>
      <label>
        Reminder days
        <input className="field" defaultValue={String(initial?.reminder_days ?? 30)} min={0} max={365} name="reminder_days" type="number" />
      </label>
      <label>
        Status
        <select className="field" defaultValue={initial?.is_active === false ? "inactive" : "active"} name="status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>
      <label className="check-row business-expiry-check full-span">
        <input defaultChecked={initial?.requires_expiry ?? true} name="requires_expiry" type="checkbox" />
        <span>Track expiry date</span>
      </label>
      <div className="form-actions full-span">
        <SubmitButton pendingText="Saving">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

function RoleAccessMultiSelect({
  disabled,
  name,
  options,
  selectedValues
}: {
  disabled: boolean;
  name: string;
  options: DocumentRoleOption[];
  selectedValues: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(selectedValues);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(disabled ? [] : selected), [disabled, selected]);
  const filteredOptions = useMemo(() => {
    const term = query.trim().toLowerCase();
    return options.filter((option) => !term || `${option.name} ${option.code}`.toLowerCase().includes(term));
  }, [options, query]);
  const selectedLabels = options.filter((option) => selectedSet.has(option.id)).map((option) => option.name);

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
    if (disabled) {
      setOpen(false);
      setQuery("");
    }
  }, [disabled]);

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
    <div className="multi-select document-role-access-select" ref={rootRef}>
      {!disabled ? selected.map((value) => <input key={value} name={name} type="hidden" value={value} />) : null}
      <button
        className={`multi-select-trigger ${open ? "open" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{disabled ? "Disabled for all user access" : selectedLabels.length ? selectedLabels.join(", ") : "Select user roles"}</span>
        <strong>v</strong>
      </button>
      {open && !disabled ? (
        <div className="multi-select-menu">
          <div className="multi-select-search">
            <input className="field multi-select-search-field" onChange={(event) => setQuery(event.target.value)} placeholder="Search role" value={query} />
          </div>
          <label className="multi-select-all">
            <input checked={filteredOptions.length > 0 && filteredOptions.every((option) => selectedSet.has(option.id))} onChange={toggleAllFiltered} type="checkbox" />
            <span>Select visible roles</span>
            <small>{filteredOptions.length} role{filteredOptions.length === 1 ? "" : "s"}</small>
          </label>
          <div className="multi-select-options">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <label className="multi-select-option" key={option.id}>
                <input checked={selectedSet.has(option.id)} onChange={() => toggle(option.id)} type="checkbox" />
                <span>{option.name}</span>
                <small>{option.code}</small>
              </label>
            )) : <div className="searchable-empty">No roles found.</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
