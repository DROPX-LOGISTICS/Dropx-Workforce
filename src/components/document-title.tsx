"use client";

import { useEffect } from "react";

export function DocumentTitle({ pageName }: { pageName: string }) {
  useEffect(() => {
    document.title = `Dashboard - ${pageName} - DROPX LOGISTICS`;
  }, [pageName]);

  return null;
}
