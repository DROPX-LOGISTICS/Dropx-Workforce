export type FuelPortalSource = "iocl_fuel" | "bpcl_fuel";

const HIDDEN_FRAME_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  width: "0",
  height: "0",
  opacity: "0",
  pointerEvents: "none",
  border: "0",
  left: "-9999px",
  top: "-9999px"
};

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

function mountHiddenFrame(url: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  Object.assign(frame.style, HIDDEN_FRAME_STYLE);
  document.body.appendChild(frame);
  return frame;
}

/** Silent browser-side fuel download using operator ISP + SW proxy (no worker API). */
export async function runFuelPortalInBrowser(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
}): Promise<{ file: File; fileName: string }> {
  const url = `/portal-client/fuel-runner?portal=${encodeURIComponent(args.sourceType)}&reportDate=${encodeURIComponent(args.reportDate)}`;
  const frame = mountHiddenFrame(url);

  try {
    const result = await waitForFuelPortalMessage(args.sourceType === "iocl_fuel" ? 180_000 : 240_000);
    if (!result.ok || !result.file) {
      throw new Error(result.error || "Browser portal auto-upload failed.");
    }
    return { file: result.file, fileName: result.file.name };
  } finally {
    frame.remove();
  }
}

export function isFuelPortalSource(value: string): value is FuelPortalSource {
  return value === "iocl_fuel" || value === "bpcl_fuel";
}
