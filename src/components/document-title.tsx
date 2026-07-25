"use client";

import { useEffect } from "react";

export function DocumentTitle({ pageName, productName = "DropX Dashboard" }: { pageName: string; productName?: string }) {
  useEffect(() => {
    document.title = `${pageName} · ${productName}`;
  }, [pageName, productName]);

  return null;
}
