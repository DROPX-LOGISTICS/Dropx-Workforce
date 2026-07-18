"use client";

import { ChevronDown, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";

export function UserMenu({
  action,
  email,
  name,
  role
}: {
  action: (formData: FormData) => void | Promise<void>;
  email?: string | null;
  name: string;
  role?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div className="user-menu" ref={wrapperRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={`user-menu-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="user-avatar">{name.slice(0, 1).toUpperCase()}</span>
        <span className="user-menu-name">{name}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {open ? (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-profile">
            <strong>{name}</strong>
            {role ? <span>{role}</span> : null}
            {email ? <small>{email}</small> : null}
          </div>
          <form action={action}>
            <SubmitButton className="user-menu-action" pendingText="Signing out">
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </SubmitButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}
