"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 5000;

export function LiveCacheRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement
        || activeElement instanceof HTMLTextAreaElement
        || activeElement instanceof HTMLSelectElement
      ) return;
      router.refresh();
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [router]);

  return null;
}
