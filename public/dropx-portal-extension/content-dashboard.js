/** Dashboard page bridge — no PowerShell; Auto talks to this content script. */

(function () {
  const ORIGIN = location.origin;

  function announceReady() {
    window.postMessage({ type: "DROPX_PORTAL_HELPER_READY", via: "chrome-extension" }, ORIGIN);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "DROPX_PORTAL_DONE") {
      window.postMessage(
        {
          type: "DROPX_PORTAL_DONE",
          ok: msg.ok,
          portal: msg.portal,
          reportDate: msg.reportDate,
          fileName: msg.fileName,
          error: msg.error
        },
        ORIGIN
      );
    }
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== ORIGIN) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "DROPX_PORTAL_HELPER_PING") {
      announceReady();
      return;
    }

    if (msg.type === "DROPX_PORTAL_CONFIG") {
      chrome.storage.local.set({
        ioclUsername: msg.ioclUsername || "",
        ioclPassword: msg.ioclPassword || "",
        bpclUserId: msg.bpclUserId || "",
        bpclPassword: msg.bpclPassword || "",
        uploadTarget: msg.uploadTarget || "dashboard",
        dashboardUploadUrl: msg.dashboardUploadUrl || `${ORIGIN}/api/report-imports/portal-browser-upload`
      });
      return;
    }

    if (msg.type === "DROPX_PORTAL_TRIGGER") {
      chrome.runtime.sendMessage(
        {
          type: "DROPX_EXT_START",
          portal: msg.portal,
          reportDate: msg.reportDate,
          dashboardOrigin: ORIGIN,
          ioclUsername: msg.ioclUsername,
          ioclPassword: msg.ioclPassword,
          bpclUserId: msg.bpclUserId,
          bpclPassword: msg.bpclPassword
        },
        () => {
          /* ignore */
        }
      );
    }
  });

  if (!document.getElementById("dropx-helper-badge")) {
    const badge = document.createElement("div");
    badge.id = "dropx-helper-badge";
    badge.textContent = "Dropx Portal ready";
    badge.title = "Chrome extension active — Auto upload uses this PC’s internet";
    badge.style.cssText =
      "position:fixed;bottom:12px;right:12px;background:#059669;color:#fff;padding:6px 12px;border-radius:999px;font-size:12px;z-index:99999;font-family:system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.15)";
    document.documentElement.appendChild(badge);
  }

  announceReady();
})();
