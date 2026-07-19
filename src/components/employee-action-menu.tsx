"use client";

import { useEffect, useRef, useState } from "react";
import { EllipsisVertical, Eye, Pencil } from "lucide-react";
import { PendingLink } from "@/components/pending-link";

export function EmployeeActionMenu({
  canEdit,
  employeeId,
  fullName
}: {
  canEdit: boolean;
  employeeId: string;
  fullName: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const tableWrap = menuRef.current?.closest(".employee-table-wrap");
    tableWrap?.classList.add("menu-open");

    function closeMenu(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      tableWrap?.classList.remove("menu-open");
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="row-action-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Actions for ${fullName}`}
        className="icon-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <EllipsisVertical size={17} aria-hidden="true" />
      </button>
      {open ? (
        <div className="row-action-popover">
          <PendingLink className="row-action-item" href={`/employees?view=${employeeId}`} scroll={false}>
            <Eye size={15} aria-hidden="true" /> View
          </PendingLink>
          {canEdit ? (
            <PendingLink className="row-action-item" href={`/employees?edit=${employeeId}`} scroll={false}>
              <Pencil size={15} aria-hidden="true" /> Edit
            </PendingLink>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
