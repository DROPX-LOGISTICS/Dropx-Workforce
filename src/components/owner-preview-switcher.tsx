"use client";

import { Search, UserRoundSearch, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type User = { id: string; name: string; email: string; role: string; scope: string };

export function OwnerPreviewSwitcher({ active, name }: { active: boolean; name: string }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && !users.length) { setBusy(true); fetch("/api/owner-preview", { cache: "no-store" }).then((r) => r.json()).then((p) => setUsers(Array.isArray(p.users) ? p.users : [])).finally(() => setBusy(false)); } }, [open, users.length]);
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return q ? users.filter((user) => `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(q)) : users; }, [query, users]);
  async function select(userId: string) { setBusy(true); const response = await fetch("/api/owner-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId }) }); if (response.ok) window.location.assign("/"); else setBusy(false); }
  return <div className="owner-preview-switcher"><button className={active ? "active" : ""} type="button" onClick={() => setOpen((value) => !value)}><UserRoundSearch size={16} /><span>{active ? `Viewing ${name}` : "View as user"}</span></button>{active ? <button className="exit" type="button" onClick={() => select("")} aria-label="Exit user preview"><X size={15} /></button> : null}{open ? <div className="owner-preview-menu"><strong>Preview a user</strong><small>Read-only. Your owner session stays active.</small><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or role" autoFocus /></label><div>{busy && !users.length ? <p>Loading users…</p> : filtered.slice(0, 120).map((user) => <button key={user.id} type="button" onClick={() => select(user.id)}><strong>{user.name}</strong><small>{user.role} · {user.scope}</small><span>{user.email}</span></button>)}</div></div> : null}</div>;
}
