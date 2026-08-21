"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { runFuelPortalInPopup } from "@/lib/portal-client/fuel-browser";

/**
 * Legacy SW runner path. Browser CORS blocks IOCL API calls from the dashboard
 * origin, so this page now hands off to Portal Helper (real IOCL tab).
 */
function LegacyRunnerInner() {
  const params = useSearchParams();

  useEffect(() => {
    const portal = (params.get("portal") || "iocl_fuel").trim();
    const reportDate = (params.get("reportDate") || "").trim();
    if (portal !== "iocl_fuel" || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return;

    void runFuelPortalInPopup({ sourceType: "iocl_fuel", reportDate })
      .then((result) => {
        const target = window.opener || window.parent;
        if (target && target !== window) {
          target.postMessage(
            { type: "fuel-portal-done", ok: true, portal, reportDate, fileName: result.fileName },
            window.location.origin
          );
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        const target = window.opener || window.parent;
        if (target && target !== window) {
          target.postMessage(
            { type: "fuel-portal-done", ok: false, portal, reportDate, error: message },
            window.location.origin
          );
        }
      });
  }, [params]);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f172a", color: "#e2e8f0", fontFamily: "system-ui", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <strong style={{ fontSize: 18 }}>Handing off to Portal Helper…</strong>
        <p style={{ color: "#94a3b8", marginTop: 12, fontSize: 14 }}>
          IOCL opens in a new tab. Solve the captcha there. Keep the dashboard tab open until upload finishes.
        </p>
      </div>
    </main>
  );
}

export default function FuelPortalProxyRunnerPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: "#0f172a" }} />}>
      <LegacyRunnerInner />
    </Suspense>
  );
}
