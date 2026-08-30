"use client";

import { useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import {
  defaultWorkforceAppPageAccess,
  workforceAppPageOptions
} from "@/lib/workforce-app-pages";

export const appPageOptions = workforceAppPageOptions;
export const defaultAppPageAccess = defaultWorkforceAppPageAccess;

export function AppPageAccessSelect({
  initialPages,
  name = "app_page_access",
  onChange
}: {
  initialPages: string[];
  name?: string;
  onChange?: (pages: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialPages);

  useEffect(() => {
    onChange?.(selected);
  }, [onChange, selected]);

  function toggle(value: string) {
    setSelected((current) => (
      current.includes(value)
        ? current.filter((page) => page !== value)
        : [...current, value]
    ));
  }

  return (
    <div className="workforce-app-access-editor">
      {selected.map((page) => (
        <input key={page} name={name} type="hidden" value={page} />
      ))}
      <div className="workforce-app-page-switches">
        {appPageOptions.map((page) => {
          const checked = selected.includes(page.value);
          return (
            <label className={checked ? "enabled" : ""} key={page.value}>
              <span><strong>{page.label}</strong><small>{checked ? "Visible in DropX One" : "Hidden for this designation"}</small></span>
              <input checked={checked} onChange={() => toggle(page.value)} type="checkbox" />
              <i aria-hidden="true" />
            </label>
          );
        })}
      </div>
      <div className="workforce-app-permanent-pages">
        <span><LockKeyhole size={14} /><strong>My Profile</strong><small>Includes resignation &amp; exit</small></span>
        <span><LockKeyhole size={14} /><strong>Settings</strong><small>Permanently enabled</small></span>
      </div>
    </div>
  );
}
