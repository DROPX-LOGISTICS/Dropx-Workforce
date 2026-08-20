export type FuelPortalSource = "iocl_fuel" | "bpcl_fuel";

export type FuelPortalSession = {
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
  await navigator.serviceWorker.register("/portal-fuel-proxy/sw.js", {
    scope: "/portal-fuel-proxy/"
  });
  await navigator.serviceWorker.ready;
}

async function loadPortalSession(sourceType: FuelPortalSource): Promise<FuelPortalSession> {
  const portal = sourceType === "iocl_fuel" ? "iocl" : "bpcl";
  const response = await fetch(`/api/report-imports/portal-session?portal=${portal}`, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as FuelPortalSession;
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

/** Runs IOCL/BPCL download inline on the current page (no popup/iframe). */
export async function runFuelPortalInline(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ file: File; fileName: string }> {
  await ensureFuelServiceWorker();
  const session = await loadPortalSession(args.sourceType);
  const probe = await probePortalFromBrowser(session.loginUrl);
  if (!probe.ok) {
    throw new Error(`Portal login page blocked from your browser (HTTP ${probe.status}).`);
  }

  if (args.sourceType === "iocl_fuel") {
    const { runIoclFuelInBrowser } = await import("@/lib/portal-client/iocl-browser");
    const file = await runIoclFuelInBrowser({
      session,
      reportDate: args.reportDate,
      proxyFetch: (url: string, init?: RequestInit) => fetch(proxyUrl(url), init)
    });
    return { file, fileName: file.name };
  }

  throw new Error("BPCL browser auto-upload is not available yet — use Manual upload.");
}

const POPUP_TIMEOUT_MS = 180_000;

function openFuelPortalPopup(url: string, name: string) {
  const width = 380;
  const height = 240;
  const left = Math.max(0, window.screen.availWidth - width - 16);
  const top = Math.max(0, window.screen.availHeight - height - 48);
  return window.open(
    url,
    name,
    [
      "popup=yes",
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      "menubar=no",
      "toolbar=no",
      "location=no",
      "status=no",
      "resizable=yes",
      "scrollbars=no"
    ].join(",")
  );
}

/** Opens a small corner popup, runs IOCL download there, and closes when finished. */
export async function runFuelPortalInPopup(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ file: File; fileName: string }> {
  if (args.sourceType !== "iocl_fuel") {
    throw new Error("BPCL browser auto-upload is not available yet — use Manual upload.");
  }

  const url = `/portal-client/fuel-runner?portal=${encodeURIComponent(args.sourceType)}&reportDate=${encodeURIComponent(args.reportDate)}`;
  const popup = openFuelPortalPopup(url, `dropx-fuel-${args.sourceType}-${Date.now()}`);
  if (!popup) {
    throw new Error("Popup blocked. Allow popups for this site and try again.");
  }

  return new Promise((resolve, reject) => {
    const origin = window.location.origin;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Portal runner timed out after 3 minutes."));
    }, POPUP_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const data = event.data as {
        type?: string;
        ok?: boolean;
        error?: string;
        fileName?: string;
        mime?: string;
        buffer?: ArrayBuffer;
      } | null;
      if (!data || data.type !== "fuel-portal-done") return;
      cleanup();
      if (!data.ok || !data.buffer) {
        reject(new Error(String(data.error || "Portal download failed.")));
        return;
      }
      const fileName = String(data.fileName || `${args.sourceType}_${args.reportDate}.csv`);
      const mime = String(data.mime || "text/csv");
      resolve({ file: new File([data.buffer], fileName, { type: mime }), fileName });
    };

    const onClosePoll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("Portal runner window was closed before the download finished."));
      }
    }, 500);

    function cleanup() {
      window.clearTimeout(timeout);
      window.clearInterval(onClosePoll);
      window.removeEventListener("message", onMessage);
      try {
        if (!popup.closed) popup.close();
      } catch {
        /* ignore */
      }
    }

    window.addEventListener("message", onMessage);
  });
}

/** Runs inline on the current page (blocks the tab until done). */
export async function runFuelPortalInBrowser(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ file: File; fileName: string }> {
  return runFuelPortalInline(args);
}

export function isFuelPortalSource(value: string): value is FuelPortalSource {
  return value === "iocl_fuel" || value === "bpcl_fuel";
}
