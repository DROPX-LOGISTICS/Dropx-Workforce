/** Opens a minimized Chrome window on this PC (uses this machine’s IP). */

const IOCL_LOGIN =
  "https://beta.iocxtrapower.com/account/login?returnUrl=%2FTransactions%2FTransactionDetails";
const BPCL_LOGIN = "https://hellobpcl.in/login/";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "DROPX_EXT_PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return true;
  }

  if (msg?.type === "DROPX_EXT_START") {
    startJob(msg)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (msg?.type === "DROPX_EXT_UPLOAD") {
    uploadFile(msg)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (msg?.type === "DROPX_EXT_DONE" || msg?.type === "DROPX_EXT_NEED_FOCUS") {
    if (msg.type === "DROPX_EXT_NEED_FOCUS" && msg.windowId) {
      chrome.windows.update(msg.windowId, { state: "normal", focused: true }).catch(() => {});
    }
    if (msg.type === "DROPX_EXT_DONE") {
      notifyDashboardTabs(msg.payload || msg);
      if (msg.windowId) {
        setTimeout(() => chrome.windows.remove(msg.windowId).catch(() => {}), 1500);
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

async function startJob(msg) {
  const portal = msg.portal === "bpcl" ? "bpcl" : "iocl";
  const reportDate = String(msg.reportDate || "").slice(0, 10);
  const dashboardOrigin = String(msg.dashboardOrigin || "https://dashboard.dropxlogistics.com").replace(/\/$/, "");

  await chrome.storage.local.set({
    pendingJob: {
      portal,
      reportDate,
      ts: Date.now(),
      uploadTarget: "dashboard",
      dashboardUploadUrl: `${dashboardOrigin}/api/report-imports/portal-browser-upload`,
      dashboardOrigin,
      ioclUsername: msg.ioclUsername || "",
      ioclPassword: msg.ioclPassword || "",
      bpclUserId: msg.bpclUserId || "",
      bpclPassword: msg.bpclPassword || ""
    }
  });

  const url = portal === "iocl" ? IOCL_LOGIN : BPCL_LOGIN;
  const win = await chrome.windows.create({
    url,
    type: "normal",
    state: "minimized",
    focused: false,
    width: 1100,
    height: 800
  });

  await chrome.storage.local.set({ runnerWindowId: win.id || null });
  return { ok: true, windowId: win.id };
}

async function uploadFile(msg) {
  const url = String(msg.dashboardUploadUrl || "").trim();
  if (!url) return { ok: false, error: "Missing dashboard upload URL" };

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_type: msg.sourceType,
      report_date: msg.reportDate,
      fileName: msg.fileName,
      contentType: msg.contentType || "text/csv",
      bytesBase64: msg.bytesBase64
    })
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Upload failed (${res.status}): ${text.slice(0, 200)}` };
  }
  return { ok: true, detail: text.slice(0, 200) };
}

function notifyDashboardTabs(payload) {
  const patterns = [
    "https://dashboard.dropxlogistics.com/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ];
  chrome.tabs.query({ url: patterns }, (tabs) => {
    for (const tab of tabs || []) {
      if (!tab.id) continue;
      chrome.tabs
        .sendMessage(tab.id, { type: "DROPX_PORTAL_DONE", ...payload })
        .catch(() => {});
    }
  });
}
