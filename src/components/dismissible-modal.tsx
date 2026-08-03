"use client";

import type { MouseEvent, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

const DismissModalContext = createContext<(() => void) | null>(null);

export function DismissibleModal({
  children,
  closeHref
}: {
  children: ReactNode;
  closeHref: string;
}) {
  const [open, setOpen] = useState(true);

  const dismiss = useCallback(() => {
    setOpen(false);
    window.history.replaceState(window.history.state, "", closeHref);
  }, [closeHref]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismiss]);

  if (!open) return null;

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) dismiss();
  }

  return (
    <DismissModalContext.Provider value={dismiss}>
      <div className="modal-backdrop" onMouseDown={handleBackdropClick}>
        {children}
      </div>
    </DismissModalContext.Provider>
  );
}

export function DismissModalButton({
  "aria-label": ariaLabel,
  children,
  className
}: {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
}) {
  const dismiss = useContext(DismissModalContext);

  return (
    <button aria-label={ariaLabel} className={className} onClick={dismiss ?? undefined} type="button">
      {children}
    </button>
  );
}
