export type FuelPortalSource = "iocl_fuel" | "bpcl_fuel";

function runnerFeatures() {
  return "popup=yes,width=1,height=1,left=-12000,top=-12000,toolbar=no,menubar=no,location=no,status=no";
}

function waitForFuelPortalMessage(timeoutMs: number) {
  return new Promise<{ ok: boolean; file?: File; error?: string }>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Browser portal auto-upload timed out."));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        ok?: boolean;
        error?: string;
        fileName?: string;
        mime?: string;
        buffer?: ArrayBuffer;
      };
      if (data?.type !== "fuel-portal-done") return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (data.ok && data.buffer && data.fileName) {
        resolve({
          ok: true,
          file: new File([data.buffer], data.fileName, { type: data.mime || "application/octet-stream" })
        });
        return;
      }
      resolve({ ok: false, error: data.error || "Browser portal run failed." });
    }

    window.addEventListener("message", onMessage);
  });
}

/** Silent browser-side fuel download using operator ISP + SW proxy (no worker API). */
export async function runFuelPortalInBrowser(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ file: File; fileName: string }> {
  const url = `/portal-client/fuel-runner?portal=${encodeURIComponent(args.sourceType)}&reportDate=${encodeURIComponent(args.reportDate)}`;
  const popup = window.open(url, `fuelPortal_${Date.now()}`, runnerFeatures());
  if (!popup) {
    throw new Error("Unable to open a hidden portal window. Allow pop-ups for Ops Pulse and retry.");
  }

  const result = await waitForFuelPortalMessage(args.sourceType === "iocl_fuel" ? 180_000 : 240_000);
  try {
    popup.close();
  } catch {
    /* ignore */
  }

  if (!result.ok || !result.file) {
    throw new Error(result.error || "Browser portal auto-upload failed.");
  }
  return { file: result.file, fileName: result.file.name };
}

export function isFuelPortalSource(value: string): value is FuelPortalSource {
  return value === "iocl_fuel" || value === "bpcl_fuel";
}
