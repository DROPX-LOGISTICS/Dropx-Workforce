"use client";

import { Check, ChevronDown, Link2, Search, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { WorkforceProfileType } from "@/lib/workforce-profiles";

export type AppNotificationRecipient = {
  id: string;
  profileType: WorkforceProfileType;
  name: string;
  reference: string;
  biometricId: string;
  category: string;
  location: string;
  designation: string;
};

const variables = [
  { token: "{full_name}", label: "Full name" },
  { token: "{dropx_id}", label: "DropX ID" },
  { token: "{biometric_id}", label: "Biometric ID" },
  { token: "{category}", label: "Category" },
  { token: "{location}", label: "Location" },
  { token: "{designation}", label: "Designation" }
];

function SendButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="app-notification-send" disabled={pending || count === 0} type="submit">
      {pending ? "Sending..." : `Send to ${count} ${count === 1 ? "person" : "people"}`}
    </button>
  );
}

export function AppNotificationComposer({
  action,
  recipients
}: {
  action: (formData: FormData) => void | Promise<void>;
  recipients: AppNotificationRecipient[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [openTarget, setOpenTarget] = useState("");
  const [activeField, setActiveField] = useState<"title" | "body">("body");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const keyFor = (recipient: AppNotificationRecipient) => `${recipient.profileType}:${recipient.id}`;
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const categories = useMemo(
    () => Array.from(new Set(recipients.map((recipient) => recipient.category))).sort(),
    [recipients]
  );
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return recipients.filter((recipient) => {
      if (category && recipient.category !== category) return false;
      if (!term) return true;
      return [
        recipient.name,
        recipient.reference,
        recipient.biometricId,
        recipient.location,
        recipient.designation,
        recipient.category
      ].join(" ").toLowerCase().includes(term);
    });
  }, [category, query, recipients]);
  const selected = useMemo(
    () => recipients.filter((recipient) => selectedSet.has(keyFor(recipient))),
    [recipients, selectedSet]
  );
  const allFilteredSelected = filtered.length > 0 && filtered.every((recipient) => selectedSet.has(keyFor(recipient)));

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, []);

  function toggleRecipient(recipient: AppNotificationRecipient) {
    const key = keyFor(recipient);
    setSelectedKeys((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]);
  }

  function toggleAllFiltered() {
    const filteredKeys = filtered.map(keyFor);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (allFilteredSelected) filteredKeys.forEach((key) => next.delete(key));
      else filteredKeys.forEach((key) => next.add(key));
      return Array.from(next);
    });
  }

  function insertVariable(token: string) {
    const target = activeField === "title" ? titleRef.current : bodyRef.current;
    if (!target) return;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const nextValue = `${target.value.slice(0, start)}${token}${target.value.slice(end)}`;
    const setter = Object.getOwnPropertyDescriptor(
      target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(target, nextValue);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.focus();
    requestAnimationFrame(() => target.setSelectionRange(start + token.length, start + token.length));
  }

  return (
    <form action={action}>
      <input name="selectedRecipients" type="hidden" value={JSON.stringify(selectedKeys)} />
      <div className="wide app-notification-recipient-field" ref={rootRef}>
        <span className="app-notification-field-label">Recipients</span>
        <button
          aria-expanded={menuOpen}
          className={`app-recipient-trigger ${menuOpen ? "open" : ""}`}
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          <span className="app-recipient-trigger-copy">
            <Users aria-hidden="true" size={17} />
            <span>{selected.length ? `${selected.length} selected` : "Select recipients"}</span>
          </span>
          <ChevronDown aria-hidden="true" size={17} />
        </button>
        {selected.length ? (
          <div className="app-recipient-tags">
            {selected.slice(0, 4).map((recipient) => (
              <button key={keyFor(recipient)} onClick={() => toggleRecipient(recipient)} type="button">
                {recipient.name}<X aria-hidden="true" size={13} />
              </button>
            ))}
            {selected.length > 4 ? <span>+{selected.length - 4} more</span> : null}
            <button className="clear" onClick={() => setSelectedKeys([])} type="button">Clear all</button>
          </div>
        ) : null}
        {menuOpen ? (
          <div className="app-recipient-menu">
            <div className="app-recipient-filters">
              <label>
                <Search aria-hidden="true" size={16} />
                <input
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, ID, biometric ID, location"
                  value={query}
                />
              </label>
              <select aria-label="Filter recipients by category" onChange={(event) => setCategory(event.target.value)} value={category}>
                <option value="">All categories</option>
                {categories.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <button className="app-recipient-select-all" onClick={toggleAllFiltered} type="button">
              <span className={`app-recipient-checkbox ${allFilteredSelected ? "selected" : ""}`}>
                {allFilteredSelected ? <Check aria-hidden="true" size={14} /> : null}
              </span>
              <span>{allFilteredSelected ? "Clear filtered" : "Select all filtered"}</span>
              <small>{filtered.length} shown</small>
            </button>
            <div className="app-recipient-options">
              {filtered.map((recipient) => {
                const checked = selectedSet.has(keyFor(recipient));
                return (
                  <button key={keyFor(recipient)} onClick={() => toggleRecipient(recipient)} type="button">
                    <span className={`app-recipient-checkbox ${checked ? "selected" : ""}`}>
                      {checked ? <Check aria-hidden="true" size={14} /> : null}
                    </span>
                    <span className="app-recipient-option-copy">
                      <strong>{recipient.name}</strong>
                      <small>{[recipient.reference, recipient.biometricId, recipient.category, recipient.location].filter(Boolean).join(" · ")}</small>
                    </span>
                  </button>
                );
              })}
              {!filtered.length ? <p>No matching people found.</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      <label>
        Title
        <input
          maxLength={120}
          name="title"
          onFocus={() => setActiveField("title")}
          placeholder="Notification title"
          ref={titleRef}
          required
        />
      </label>
      <label>
        Open page
        <select name="openTarget" onChange={(event) => setOpenTarget(event.target.value)} value={openTarget}>
          <option value="">No linked page</option>
          <option value="dashboard">Dashboard</option>
          <option value="profile">My Profile</option>
          <option value="attendance">Attendance</option>
          <option value="leave">Leave</option>
          <option value="settings">Settings</option>
          <option value="custom_url">Custom URL</option>
        </select>
      </label>
      {openTarget === "custom_url" ? (
        <label className="wide app-notification-custom-url">
          Custom URL
          <span><Link2 aria-hidden="true" size={17} /><input maxLength={2048} name="customUrl" placeholder="https://example.com/page" required type="url" /></span>
        </label>
      ) : null}
      <label className="wide">
        Message
        <textarea
          maxLength={1000}
          name="body"
          onFocus={() => setActiveField("body")}
          placeholder="Write the notification message"
          ref={bodyRef}
          required
          rows={4}
        />
      </label>
      <div className="wide app-notification-variables">
        <span>Insert into {activeField === "title" ? "title" : "message"}</span>
        <div>
          {variables.map((variable) => (
            <button key={variable.token} onClick={() => insertVariable(variable.token)} type="button">
              {variable.label}
            </button>
          ))}
        </div>
        <small>Each variable is replaced separately for every selected person.</small>
      </div>
      <SendButton count={selected.length} />
    </form>
  );
}
