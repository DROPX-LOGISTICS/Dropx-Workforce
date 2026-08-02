"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

function send(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) navigator.sendBeacon("/api/event-log", new Blob([body], { type: "application/json" }));
  else void fetch("/api/event-log", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
}

function labelFor(element: HTMLElement) {
  return String(element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "")
    .replace(/\s+/g, " ").trim().slice(0, 80);
}

export function EventLogTracker() {
  const pathname = usePathname();
  useEffect(() => {
    send({ eventCode: "page_view", module: pathname.split("/").filter(Boolean)[0] || "dashboard", action: "view", route: pathname });
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("button, a[href], [role='button']");
      if (!target || target.closest("[data-event-log-ignore]")) return;
      const label = labelFor(target);
      if (!label) return;
      send({ eventCode: "ui_action", module: location.pathname.split("/").filter(Boolean)[0] || "dashboard", action: "click", route: location.pathname, metadata: { label, element: target.tagName.toLowerCase() } });
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement;
      send({ eventCode: "form_submit", module: location.pathname.split("/").filter(Boolean)[0] || "dashboard", action: "submit", route: location.pathname, metadata: { form: form.getAttribute("aria-label") || form.getAttribute("name") || "form" } });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("submit", onSubmit, true); };
  }, []);
  return null;
}
