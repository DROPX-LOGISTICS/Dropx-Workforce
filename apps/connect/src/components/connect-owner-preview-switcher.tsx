"use client";

import { Search, UserRoundSearch, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { AppAccount } from "./connect-profile-app";

export function ConnectOwnerPreviewSwitcher({ active, name }: { active: boolean; name: string }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<AppAccount[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return q ? users.filter((user) => `${user.name} ${user.reference} ${user.role} ${user.email}`.toLowerCase().includes(q)) : users; }, [query, users]);
  async function load() { setOpen((value) => !value); if (!users.length) { setBusy(true); const response = await fetch("/api/connect/owner-preview", { cache: "no-store" }); const payload = await response.json(); setUsers(Array.isArray(payload.users) ? payload.users : []); setBusy(false); } }
  async function select(account?: AppAccount) { setBusy(true); const response = await fetch("/api/connect/owner-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(account ? { profileType: account.profileType, accountId: account.id } : {}) }); if (response.ok) window.location.reload(); else setBusy(false); }
  return <div className="dx-owner-preview"><button className={active ? "active" : ""} type="button" onClick={load}><UserRoundSearch />{active ? <span>{name}</span> : null}</button>{active ? <button type="button" onClick={() => select()} aria-label="Exit user preview"><X /></button> : null}{open ? <aside><strong>View DropX One as user</strong><small>Read-only owner preview</small><label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID or role" autoFocus /></label><div>{busy && !users.length ? <p>Loading…</p> : filtered.slice(0, 120).map((user) => <button key={`${user.profileType}:${user.id}`} type="button" onClick={() => select(user)}><strong>{user.name || user.reference}</strong><small>{user.reference} · {user.role}</small><span>{user.profileType === "employee" ? "Employee" : "Workforce associate"}</span></button>)}</div></aside> : null}</div>;
}
