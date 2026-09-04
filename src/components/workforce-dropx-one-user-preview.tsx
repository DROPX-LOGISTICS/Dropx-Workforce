"use client";

import { Search, UserRoundSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { DropxOneDesignationPreview } from "@/components/dropx-one-designation-preview";
import { workforceProfileFields, type ProfileFieldChannelRules } from "@/lib/profile-field-rules";

export type WorkforceDropxOnePreviewUser = {
  id: string;
  name: string;
  reference: string;
  designation: string;
  status: string;
  location: string;
  pageAccess: string[];
  fieldRules: ProfileFieldChannelRules;
};

export function WorkforceDropxOneUserPreview({ users }: { users: WorkforceDropxOnePreviewUser[] }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? "");
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term
      ? users.filter((user) => `${user.name} ${user.reference} ${user.designation} ${user.status} ${user.location}`.toLowerCase().includes(term))
      : users;
  }, [query, users]);
  const selected = filtered.find((user) => user.id === selectedId) ?? filtered[0] ?? null;

  return <div className="workforce-one-user-preview">
    <section className="panel workforce-one-user-list">
      <div className="panel-head"><div><h2>Registered Workforce users</h2><p className="subtle">Active and in-progress registrations are available for read-only app preview.</p></div><span className="status-pill neutral">{users.length} users</span></div>
      <label className="workforce-one-search"><Search size={16} /><input onChange={(event) => setQuery(event.target.value)} placeholder="Search name, DropX ID, designation or station" value={query} /></label>
      <div>{filtered.map((user) => <button className={selected?.id === user.id ? "active" : ""} key={user.id} onClick={() => setSelectedId(user.id)} type="button">
        <i><UserRoundSearch /></i><span><strong>{user.name}</strong><small>{user.reference || "ID pending"} · {user.designation}</small><em>{user.location || "No station"}</em></span><b className={user.status === "Active" ? "active" : "pending"}>{user.status}</b>
      </button>)}{!filtered.length ? <p className="empty-cell">No matching Workforce user.</p> : null}</div>
    </section>
    <section className="workforce-one-user-stage">
      {selected ? <DropxOneDesignationPreview
        accountName={selected.name}
        accountStatus={selected.status}
        designationName={selected.designation}
        fields={workforceProfileFields}
        pageAccess={selected.pageAccess}
        rules={selected.fieldRules}
        scopeLabel={[selected.status, selected.location].filter(Boolean).join(" · ")}
      /> : <div className="panel empty-cell">No Workforce registration is available for preview.</div>}
    </section>
  </div>;
}
