"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

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
      ) return;
      router.refresh();
    }, 10000);

    return () => window.clearInterval(interval);
  }, [active, router]);

  return null;
}
