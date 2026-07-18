"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { PaymentNotificationSnapshot } from "@/lib/payment-notification-counts";

const emptySnapshot: PaymentNotificationSnapshot = {
  total: 0,
  badges: {},
  items: []
};

type PaymentNotificationContextValue = {
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  snapshot: PaymentNotificationSnapshot;
};

const PaymentNotificationContext = createContext<PaymentNotificationContextValue>({
  isRefreshing: false,
  refresh: async () => undefined,
  snapshot: emptySnapshot
});

export function PaymentNotificationProvider({
  children,
  initialData
}: {
  children: ReactNode;
  initialData: PaymentNotificationSnapshot;
}) {
  const pathname = usePathname();
  const [snapshot, setSnapshot] = useState<PaymentNotificationSnapshot>(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/payment-notifications", { cache: "no-store" });
      if (response.ok) {
        setSnapshot(await response.json());
      }
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 15000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  const value = useMemo(() => ({ isRefreshing, refresh, snapshot }), [isRefreshing, refresh, snapshot]);

  return (
    <PaymentNotificationContext.Provider value={value}>
      {children}
    </PaymentNotificationContext.Provider>
  );
}

export function usePaymentNotifications() {
  return useContext(PaymentNotificationContext);
}

export function PaymentNavBadge({ code }: { code?: string }) {
  const { snapshot } = usePaymentNotifications();
  if (!code) return null;
  const count = snapshot.badges[code] ?? 0;
  if (count <= 0) return null;
  return <span className="nav-badge">{count > 99 ? "99+" : count}</span>;
}
