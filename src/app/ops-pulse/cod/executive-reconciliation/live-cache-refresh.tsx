"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Soft-refresh RSC data for active portal checks.
 * Skips while the user is typing so cash-sheet forms are not interrupted.
 * Interval is intentionally long — cash-recon Amazon data is cached client-side.
 */
export function LiveCacheRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement
        || activeElement instanceof HTMLTextAreaElement
        || activeElement instanceof HTMLSelectElement
        || activeElement instanceof HTMLButtonElement
      ) return;
      // Avoid refresh while a modal/dialog is open.
      if (document.querySelector("[aria-modal='true'], dialog[open]")) return;
      router.refresh();
    }, 30000);

    return () => window.clearInterval(interval);
  }, [active, router]);

  return null;
}
