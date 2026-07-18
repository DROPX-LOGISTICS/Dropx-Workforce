"use client";

import { useEffect, useRef } from "react";

type InboxNotification = {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  text: string | null;
  type: string | null;
  createdAt: string;
  conversationId: string | null;
  profileName: string | null;
};

const storageKey = "dropx_inbox_notification_since";

function canNotify() {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

export function InboxNotificationListener({ enabled }: { enabled: boolean }) {
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !canNotify()) return undefined;

    let stopped = false;
    const initializeSince = () => {
      const existing = window.localStorage.getItem(storageKey);
      if (existing) return existing;
      const now = new Date().toISOString();
      window.localStorage.setItem(storageKey, now);
      return now;
    };

    async function poll() {
      if (stopped || !canNotify()) return;
      const since = initializeSince();
      try {
        const response = await fetch(`/api/inbox/notifications?since=${encodeURIComponent(since)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { messages?: InboxNotification[] };
        const messages = payload.messages ?? [];
        messages.forEach((message) => {
          if (seenIds.current.has(message.id)) return;
          seenIds.current.add(message.id);
          const title = `New WhatsApp message${message.profileName ? ` - ${message.profileName}` : ""}`;
          const body = [message.contactName || message.contactPhone || "Unknown contact", message.text || message.type || "New message"].join("\n");
          const notification = new Notification(title, {
            body,
            icon: "/dropx-favicon.png",
            tag: message.id
          });
          notification.onclick = () => {
            window.focus();
            if (message.conversationId) {
              window.location.href = `/inbox?conversation=${encodeURIComponent(message.conversationId)}`;
            }
          };
        });
        const latest = messages.at(-1)?.createdAt;
        if (latest) window.localStorage.setItem(storageKey, latest);
      } catch {
        // Notification polling should never interrupt the dashboard.
      }
    }

    poll();
    const timer = window.setInterval(poll, 15_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return null;
}

export function NotificationPermissionButton() {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission === "granted") return null;

  return (
    <button
      className="button secondary compact"
      onClick={async () => {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          window.localStorage.setItem(storageKey, new Date().toISOString());
        }
      }}
      type="button"
    >
      Enable alerts
    </button>
  );
}
