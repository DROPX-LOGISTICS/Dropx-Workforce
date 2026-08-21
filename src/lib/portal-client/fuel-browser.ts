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

const HELPER_TIMEOUT_MS = 10 * 60_000;
const HELPER_READY_MS = 2_500;

function portalCode(sourceType: FuelPortalSource) {
  return sourceType === "iocl_fuel" ? "iocl" : "bpcl";
}

async function loadPortalSession(sourceType: FuelPortalSource): Promise<FuelPortalSession> {
  const portal = portalCode(sourceType);
  const response = await fetch(`/api/report-imports/portal-session?portal=${portal}`, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as FuelPortalSession;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Unable to load ${sourceType} portal session (${response.status}).`);
  }
  return payload;
}

function waitForHelperReady(timeoutMs = HELPER_READY_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "DROPX_PORTAL_HELPER_READY") finish(true);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    window.addEventListener("message", onMessage);
    // Ask an already-loaded helper to re-announce itself.
    window.postMessage({ type: "DROPX_PORTAL_HELPER_PING" }, window.location.origin);
  });
}

/**
 * Opens a minimized Chrome window on this PC (extension) and drives IOCL/BPCL
 * using the machine’s internet/IP. No PowerShell — install Dropx Portal Helper once.
 */
export async function runFuelPortalInPopup(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ fileName: string; uploaded: true }> {
  if (args.sourceType !== "iocl_fuel") {
    throw new Error("BPCL browser auto-upload is not available yet — use Manual upload.");
  }

  const helperReady = await waitForHelperReady();
  if (!helperReady) {
    throw new Error(
      "Install the Dropx Portal Helper Chrome extension once (Imports → Portal Helper), then refresh and try again. No PowerShell needed."
    );
  }

  const session = await loadPortalSession(args.sourceType);
  const portal = portalCode(args.sourceType);
  const config = {
    ioclUsername: session.username,
    ioclPassword: session.password,
    bpclUserId: session.userId,
    bpclPassword: session.password,
    uploadTarget: "dashboard" as const,
    dashboardUploadUrl: `${window.location.origin}/api/report-imports/portal-browser-upload`
  };
  window.postMessage({ type: "DROPX_PORTAL_CONFIG", ...config }, window.location.origin);
  window.postMessage(
    {
      type: "DROPX_PORTAL_TRIGGER",
      portal,
      reportDate: args.reportDate,
      ...config
    },
    window.location.origin
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            "Timed out waiting for the portal window. If a captcha appeared, solve it and click Login, then wait for upload — or use Manual upload."
          )
        )
      );
    }, HELPER_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        ok?: boolean;
        error?: string;
        fileName?: string;
        portal?: string;
      } | null;
      if (!data || data.type !== "DROPX_PORTAL_DONE") return;
      if (!data.ok) {
        finish(() => reject(new Error(String(data.error || "Portal Helper upload failed."))));
        return;
      }
      finish(() =>
        resolve({
          uploaded: true,
          fileName: String(data.fileName || `${args.sourceType}_${args.reportDate}`)
        })
      );
    };

    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      action();
    }

    window.addEventListener("message", onMessage);
  });
}

/** @deprecated Same as runFuelPortalInPopup — SW API proxy cannot bypass IOCL CORS. */
export async function runFuelPortalInline(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ file: File; fileName: string }> {
  const result = await runFuelPortalInPopup(args);
  // Callers that still expect a File should not re-upload — helper already imported.
  throw new Error(
    `Portal Helper already imported ${result.fileName}. Refresh Import Master — no second upload needed.`
  );
}

export async function runFuelPortalInBrowser(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ fileName: string; uploaded: true }> {
  return runFuelPortalInPopup(args);
}

export function isFuelPortalSource(value: string): value is FuelPortalSource {
  return value === "iocl_fuel" || value === "bpcl_fuel";
}

export function portalHelperInstallUrl() {
  return "/imports/portal-extension";
}
