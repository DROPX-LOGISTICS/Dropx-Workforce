"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type FuelPortalSource = "iocl_fuel" | "bpcl_fuel";

type PortalSession = {
  ok: boolean;
  portal: FuelPortalSource;
  username?: string;
  userId?: string;
  password: string;
  customerId?: string;
  loginUrl: string;
  txnUrl?: string;
  error?: string;
};

function proxyUrl(target: string) {
  return `/portal-fuel-proxy/?url=${encodeURIComponent(target)}`;
}

async function ensureFuelServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are unavailable in this browser.");
  }
  const reg = await navigator.serviceWorker.register("/portal-fuel-proxy/sw.js", {
    scope: "/portal-fuel-proxy/"
  });
  await navigator.serviceWorker.ready;
  return reg;
}

async function loadPortalSession(sourceType: FuelPortalSource): Promise<PortalSession> {
  const portal = sourceType === "iocl_fuel" ? "iocl" : "bpcl";
  const response = await fetch(`/api/report-imports/portal-session?portal=${portal}`, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as PortalSession;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Unable to load ${sourceType} portal session (${response.status}).`);
  }
  return payload;
}

async function probePortalFromBrowser(loginUrl: string) {
  const response = await fetch(loginUrl, {
    headers: { "accept-language": "en-IN,en;q=0.9" },
    credentials: "omit",
    cache: "no-store"
  });
  const body = await response.text();
  const blocked = response.status === 403
    || /Request Rejected|support ID|403 Forbidden|Application-Gateway/i.test(body);
  return { ok: !blocked && response.ok, status: response.status };
}

/** Corner popup runner — uses SW proxy + operator ISP for IOCL portal APIs. */
function FuelPortalRunnerInner() {
  const params = useSearchParams();
  const started = useRef(false);
  const [status, setStatus] = useState("Starting…");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const portal = (params.get("portal") || "").trim() as FuelPortalSource;
    const reportDate = (params.get("reportDate") || "").trim();
    const targetOrigin = window.location.origin;
    const notifyParent = (payload: Record<string, unknown>, transfer?: Transferable[]) => {
      const target = window.opener || window.parent;
      if (!target || target === window) return;
      target.postMessage(payload, targetOrigin, transfer || []);
    };

    void (async () => {
      try {
        if (portal !== "iocl_fuel" && portal !== "bpcl_fuel") {
          throw new Error("Unsupported fuel portal.");
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
          throw new Error("reportDate must be YYYY-MM-DD.");
        }

        setStatus("Preparing proxy…");
        await ensureFuelServiceWorker();
        setStatus("Loading credentials…");
        const session = await loadPortalSession(portal);
        setStatus("Checking portal access…");
        const probe = await probePortalFromBrowser(session.loginUrl);
        if (!probe.ok) {
          throw new Error(`Portal login page blocked from your browser (HTTP ${probe.status}).`);
        }

        if (portal === "iocl_fuel") {
          setStatus("Downloading IOCL report…");
          setDetail("Logging in and fetching transactions");
          const { runIoclFuelInBrowser } = await import("@/lib/portal-client/iocl-browser");
          const file = await runIoclFuelInBrowser({
            session,
            reportDate,
            proxyFetch: (url: string, init?: RequestInit) => fetch(proxyUrl(url), init)
          });
          const buffer = await file.arrayBuffer();
          setStatus("Download complete");
          setDetail("Sending to dashboard…");
          notifyParent(
            {
              type: "fuel-portal-done",
              ok: true,
              portal,
              reportDate,
              fileName: file.name,
              mime: file.type,
              buffer
            },
            [buffer]
          );
          window.setTimeout(() => {
            if (window.opener) window.close();
          }, 400);
          return;
        }

        throw new Error("BPCL browser auto-upload is not available yet — use Manual upload.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus("Failed");
        setDetail(message);
        notifyParent({ type: "fuel-portal-done", ok: false, portal, reportDate, error: message });
        window.setTimeout(() => {
          if (window.opener) window.close();
        }, 2500);
      }
    })();
  }, [params]);

  const portal = (params.get("portal") || "").trim();
  const label = portal === "bpcl_fuel" ? "BPCL" : "IOCL";

  return (
    <main style={{
      margin: 0,
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      padding: "20px",
      fontFamily: "system-ui, sans-serif",
      background: "#0f172a",
      color: "#e2e8f0"
    }}>
      <div style={{ textAlign: "center", maxWidth: 320 }}>
        <p style={{ margin: "0 0 8px", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#38bdf8" }}>
          Dropx {label} runner
        </p>
        <strong style={{ display: "block", fontSize: 18, marginBottom: 8 }}>{status}</strong>
        {detail ? <span style={{ color: "#94a3b8", fontSize: 13 }}>{detail}</span> : null}
        <p style={{ marginTop: 16, color: "#64748b", fontSize: 12 }}>This window closes automatically when finished.</p>
      </div>
    </main>
  );
}

export default function FuelPortalRunnerPage() {
  return (
    <Suspense fallback={null}>
      <FuelPortalRunnerInner />
    </Suspense>
  );
}
