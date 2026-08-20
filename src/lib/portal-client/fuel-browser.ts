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

const POPUP_TIMEOUT_MS = 180_000;
export const FUEL_PORTAL_RUNNER_PATH = "/portal-fuel-proxy/runner";

function openFuelPortalPopup(url: string, name: string) {
  const width = 420;
  const height = 320;
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
      "scrollbars=yes"
    ].join(",")
  );
}

/** Opens a small corner popup under the SW scope, runs IOCL download, closes when finished. */
export async function runFuelPortalInPopup(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ file: File; fileName: string }> {
  if (args.sourceType !== "iocl_fuel") {
    throw new Error("BPCL browser auto-upload is not available yet — use Manual upload.");
  }

  const url = `${FUEL_PORTAL_RUNNER_PATH}?portal=${encodeURIComponent(args.sourceType)}&reportDate=${encodeURIComponent(args.reportDate)}`;
  const popup = openFuelPortalPopup(url, `dropx-fuel-${args.sourceType}-${Date.now()}`);
  if (!popup) {
    throw new Error("Popup blocked. Allow popups for this site and try again.");
  }
  const runnerWindow: Window = popup;

  return new Promise((resolve, reject) => {
    const origin = window.location.origin;
    let settled = false;
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error("Portal runner timed out after 3 minutes. Check the popup for the error log.")), false);
    }, POPUP_TIMEOUT_MS);

    const onClosePoll = window.setInterval(() => {
      if (runnerWindow.closed && !settled) {
        finish(() => reject(new Error("Portal runner window was closed before the download finished.")), false);
      }
    }, 500);

    function finish(action: () => void, closePopup = true) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(onClosePoll);
      window.removeEventListener("message", onMessage);
      // On failure, leave the popup open so the operator can read the error log.
      if (closePopup) {
        try {
          if (!runnerWindow.closed) runnerWindow.close();
        } catch {
          /* ignore */
        }
      }
      action();
    }

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
      if (!data.ok || !data.buffer) {
        finish(() => reject(new Error(String(data.error || "Portal download failed."))), false);
        return;
      }
      const buffer = data.buffer;
      const fileName = String(data.fileName || `${args.sourceType}_${args.reportDate}.csv`);
      const mime = String(data.mime || "text/csv");
      finish(() => resolve({ file: new File([buffer], fileName, { type: mime }), fileName }), true);
    };

    window.addEventListener("message", onMessage);
  });
}

/**
 * Prefer popup runner (SW-scoped). Kept name for callers; do not run IOCL APIs from
 * /imports directly — that page is outside the service-worker proxy scope.
 */
export async function runFuelPortalInline(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ file: File; fileName: string }> {
  return runFuelPortalInPopup(args);
}

/** @deprecated Prefer runFuelPortalInPopup */
export async function runFuelPortalInBrowser(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ file: File; fileName: string }> {
  return runFuelPortalInPopup(args);
}

export function isFuelPortalSource(value: string): value is FuelPortalSource {
  return value === "iocl_fuel" || value === "bpcl_fuel";
}
