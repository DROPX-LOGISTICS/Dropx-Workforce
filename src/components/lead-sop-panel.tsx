"use client";

import { useMemo, useState } from "react";
import { createLeadSop, updateLeadSop } from "@/app/leads/actions";
import { SubmitButton } from "@/components/submit-button";
import type { LeadJobRoleRow } from "@/lib/leads-data";

const defaultFields = ["full_name", "phone", "city", "post_code"];

function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function LeadFieldEditor({
  initialFields
}: {
  initialFields: string[];
}) {
  const [fields, setFields] = useState<string[]>(initialFields.length ? initialFields : defaultFields);
  const [draft, setDraft] = useState("");

  function addFromText(value: string) {
    const next = value.split(",").map((field) => field.trim()).filter(Boolean);
    if (!next.length) return;
    setFields((current) => Array.from(new Set([...current, ...next])));
    setDraft("");
  }

  return (
    <div className="sop-tag-editor">
      {fields.map((field) => <input key={field} name="required_fields" type="hidden" value={field} />)}
      <textarea
        className="field sop-tag-input"
        onChange={(event) => {
          const value = event.target.value;
          if (value.includes(",")) addFromText(value);
          else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            addFromText(draft);
          }
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (text.includes(",")) {
            event.preventDefault();
            addFromText(text);
          }
        }}
        placeholder="Type a field name, then comma"
        value={draft}
      />
      <div className="lead-field-list sop-edit-tags">
        {fields.map((field) => (
          <span key={field}>
            {field}
            <button
              aria-label={`Remove ${field}`}
              onClick={() => setFields((current) => current.filter((item) => item !== field))}
              type="button"
            >
              x
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function SopModal({
  mode,
  onClose,
  role
}: {
  mode: "add" | "edit";
  onClose: () => void;
  role?: LeadJobRoleRow;
}) {
  const [code, setCode] = useState(role?.code ?? "");

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal-panel wide" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <div>
            <h2>{mode === "add" ? "Add Ad SOP" : "Edit Ad SOP"}</h2>
            <p className="subtle">Ad name format is generated as StationCode_RoleCode.</p>
          </div>
          <button className="icon-button" onClick={onClose} type="button">x</button>
        </div>
        <form action={mode === "add" ? createLeadSop : updateLeadSop} className="sop-form">
          {role ? <input name="id" type="hidden" value={role.id} /> : null}
          <div className="form-grid two">
            <label>
              Role code
              <input
                className="field"
                name="code"
                onChange={(event) => setCode(normalizeCode(event.target.value))}
                placeholder="Enter role code"
                required
                value={code}
              />
            </label>
            <label>
              Role name
              <input className="field" defaultValue={role?.name ?? ""} name="name" placeholder="Enter role name" required />
            </label>
          </div>
          <div className="sop-preview-strip">
            <span>Generated SOP</span>
            <strong>STATIONCODE_{code || "ROLECODE"}</strong>
          </div>
          <label className="sop-fields-label">
            Lead fields to capture
            <LeadFieldEditor initialFields={role?.required_fields ?? defaultFields} />
          </label>
          <div className="form-actions right">
            <button className="button secondary" onClick={onClose} type="button">Cancel</button>
            <SubmitButton className="button" pendingText="Saving">{mode === "add" ? "Add SOP" : "Save SOP"}</SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}

export function LeadSopPanel({
  canAdd,
  canEdit,
  roles
}: {
  canAdd: boolean;
  canEdit: boolean;
  roles: LeadJobRoleRow[];
}) {
  const [query, setQuery] = useState("");
  const [modalRole, setModalRole] = useState<LeadJobRoleRow | null>(null);
  const [adding, setAdding] = useState(false);
  const filteredRoles = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return roles;
    return roles.filter((role) => `${role.code} ${role.name} ${role.required_fields.join(" ")}`.toLowerCase().includes(search));
  }, [query, roles]);

  return (
    <>
      <section className="panel lead-sop-panel">
        <div className="panel-head toolbar">
          <div>
            <h2>Ad SOP list</h2>
            <p className="subtle">{filteredRoles.length} of {roles.length} SOPs</p>
          </div>
          <div className="lead-sop-toolbar">
            <input
              className="field"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search SOP"
              value={query}
            />
            {query ? <button className="button secondary compact" onClick={() => setQuery("")} type="button">Clear</button> : null}
            {canAdd ? <button className="button compact" onClick={() => setAdding(true)} type="button">Add SOP</button> : null}
          </div>
        </div>
        <div className="lead-sop-grid">
          {filteredRoles.length ? filteredRoles.map((role) => (
            <div className="lead-sop-card" key={role.id}>
              <div className="lead-sop-card-head">
                <div className="lead-sop-code">{role.code}</div>
                {canEdit ? <button className="button secondary compact" onClick={() => setModalRole(role)} type="button">Edit</button> : null}
              </div>
              <div className="lead-sop-title">
                <h3>{role.name}</h3>
                <p className="subtle">Ad format: <strong>STATIONCODE_{role.code}</strong></p>
              </div>
              <div className="lead-field-list">
                {role.required_fields.map((field) => <span key={field}>{field}</span>)}
              </div>
            </div>
          )) : (
            <div className="empty-state lead-sop-empty">No SOP found.</div>
          )}
        </div>
      </section>
      {adding ? <SopModal mode="add" onClose={() => setAdding(false)} /> : null}
      {modalRole ? <SopModal mode="edit" onClose={() => setModalRole(null)} role={modalRole} /> : null}
    </>
  );
}
