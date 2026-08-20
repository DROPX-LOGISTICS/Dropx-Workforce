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

  const waitForState = (worker: ServiceWorker | null, state: ServiceWorkerState, ms = 20_000) =>
    new Promise<void>((resolve, reject) => {
      if (!worker) {
        reject(new Error("Service worker did not start."));
        return;
      }
      if (worker.state === state || worker.state === "activated") {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => reject(new Error("Service worker activation timed out.")), ms);
      worker.addEventListener("statechange", () => {
        if (worker.state === state || worker.state === "activated") {
          window.clearTimeout(timer);
          resolve();
        }
      });
    });

  if (reg.installing) await waitForState(reg.installing, "activated");
  else if (reg.waiting) {
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
    await waitForState(reg.waiting, "activated");
  } else if (reg.active) {
    await waitForState(reg.active, "activated");
  }

  // This page is under /portal-fuel-proxy/, so ready should resolve once claimed.
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("Service worker ready timed out.")), 20_000);
    })
  ]);

  if (!navigator.serviceWorker.controller) {
    // First activation often needs one reload before this client is controlled.
    const url = new URL(window.location.href);
    if (url.searchParams.get("sw") !== "1") {
      url.searchParams.set("sw", "1");
      window.location.replace(url.toString());
      await new Promise(() => undefined);
    }
    throw new Error("Service worker is active but not controlling this page. Close and retry.");
  }
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

function FuelPortalRunnerInner() {
  const params = useSearchParams();
  const started = useRef(false);
  const [status, setStatus] = useState("Starting…");
  const [detail, setDetail] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const pushLog = (line: string) => {
    setLog((prev) => [...prev.slice(-8), line]);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const portal = (params.get("portal") || "").trim() as FuelPortalSource;
    const reportDate = (params.get("reportDate") || "").trim();
    const targetOrigin = window.location.origin;
    const notifyParent = (payload: Record<string, unknown>, transfer?: Transferable[]) => {
      const target = window.opener || window.parent;
      if (!target || target === window) return;
      try {
        target.postMessage(payload, targetOrigin, transfer || []);
      } catch {
        // Structured clone of transferred buffer can fail if already used — retry without transfer.
        try {
          target.postMessage(payload, targetOrigin);
        } catch {
          /* ignore */
        }
      }
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
        pushLog("Registering service worker under /portal-fuel-proxy/");
        await ensureFuelServiceWorker();
        pushLog("Service worker controlling this page");

        setStatus("Loading credentials…");
        const session = await loadPortalSession(portal);
        pushLog(`Credentials loaded for ${session.username || session.userId || portal}`);

        setStatus("Checking portal proxy…");
        pushLog("Service worker ready — starting download");
        // No CORS probe to the IOCL website; the SW proxy is validated by the login call itself.

        if (portal === "iocl_fuel") {
          setStatus("Downloading IOCL report…");
          setDetail("Logging in and fetching transactions");
          pushLog("Starting IOCL browser download");
          const { runIoclFuelInBrowser } = await import("@/lib/portal-client/iocl-browser");
          const file = await runIoclFuelInBrowser({
            session,
            reportDate,
            proxyFetch: (url: string, init?: RequestInit) => fetch(proxyUrl(url), init)
          });
          const buffer = await file.arrayBuffer();
          setStatus("Download complete");
          setDetail(file.name);
          pushLog(`Downloaded ${file.name} (${buffer.byteLength} bytes)`);
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
          }, 600);
          return;
        }

        throw new Error("BPCL browser auto-upload is not available yet — use Manual upload.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus("Failed");
        setDetail(message);
        pushLog(`Error: ${message}`);
        notifyParent({ type: "fuel-portal-done", ok: false, portal, reportDate, error: message });
        window.setTimeout(() => {
          if (window.opener) window.close();
        }, 4000);
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
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <p style={{ margin: "0 0 8px", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#38bdf8" }}>
          Dropx {label} runner
        </p>
        <strong style={{ display: "block", fontSize: 18, marginBottom: 8 }}>{status}</strong>
        {detail ? <span style={{ display: "block", color: "#94a3b8", fontSize: 13, marginBottom: 12 }}>{detail}</span> : null}
        {log.length ? (
          <ul style={{ textAlign: "left", listStyle: "none", padding: 0, margin: "12px 0 0", color: "#64748b", fontSize: 11, lineHeight: 1.5 }}>
            {log.map((line, index) => <li key={`${index}-${line.slice(0, 24)}`}>• {line}</li>)}
          </ul>
        ) : null}
        <p style={{ marginTop: 16, color: "#64748b", fontSize: 12 }}>This window closes automatically when finished.</p>
      </div>
    </main>
  );
}

export default function FuelPortalProxyRunnerPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", display: "grid", placeItems: "center" }}>Starting…</main>}>
      <FuelPortalRunnerInner />
    </Suspense>
  );
}
