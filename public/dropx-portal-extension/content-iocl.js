/** IOCL portal automation inside the minimized window opened by the extension. */

(function () {
  function toast(msg) {
    let box = document.getElementById("dropx-toast-container");
    if (!box) {
      box = document.createElement("div");
      box.id = "dropx-toast-container";
      box.style.cssText =
        "position:fixed;top:12px;right:12px;z-index:999999;display:flex;flex-direction:column;gap:8px";
      document.documentElement.appendChild(box);
    }
    const el = document.createElement("div");
    el.style.cssText =
      "background:#1e293b;color:#fff;padding:10px 14px;border-radius:8px;font:13px system-ui;max-width:340px";
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function typeIntoField(el, text) {
    el.focus();
    el.value = "";
    el.dispatchEvent(new Event("focus", { bubbles: true }));
    for (const ch of text) {
      el.value += ch;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(40);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function highlightCaptcha() {
    const node = document.querySelector(
      '.g-recaptcha, #recaptcha, iframe[src*="recaptcha"], canvas#canv, #user_captcha_input'
    );
    if (node) {
      node.style.outline = "3px solid #ef4444";
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function askFocus(reason) {
    chrome.storage.local.get(["runnerWindowId"], (data) => {
      chrome.runtime.sendMessage({
        type: "DROPX_EXT_NEED_FOCUS",
        windowId: data.runnerWindowId,
        reason
      });
    });
  }

  function finish(payload) {
    chrome.storage.local.get(["runnerWindowId"], (data) => {
      chrome.runtime.sendMessage({
        type: "DROPX_EXT_DONE",
        windowId: data.runnerWindowId,
        payload
      });
    });
  }

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function uploadCaptured(portal, reportDate, arrayBuffer, contentType, fileName) {
    chrome.storage.local.get(["pendingJob"], (stored) => {
      const job = stored.pendingJob || {};
      const dashboardUploadUrl =
        job.dashboardUploadUrl ||
        "https://dashboard.dropxlogistics.com/api/report-imports/portal-browser-upload";
      toast(`Uploading ${fileName}…`);
      chrome.runtime.sendMessage(
        {
          type: "DROPX_EXT_UPLOAD",
          dashboardUploadUrl,
          sourceType: portal === "iocl" ? "iocl_fuel" : "bpcl_fuel",
          reportDate,
          fileName,
          contentType,
          bytesBase64: toBase64(arrayBuffer)
        },
        (res) => {
          if (res?.ok) {
            toast("Uploaded to Import Master.");
            chrome.storage.local.set({ pendingJob: null });
            finish({
              type: "DROPX_PORTAL_DONE",
              ok: true,
              portal,
              reportDate,
              fileName
            });
          } else {
            const err = res?.error || "Upload failed";
            toast(err);
            finish({ type: "DROPX_PORTAL_DONE", ok: false, portal, reportDate, error: err });
          }
        }
      );
    });
  }

  function interceptDownload(portal, reportDate) {
    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
        const ct = res.headers.get("content-type") || "";
        const cd = res.headers.get("content-disposition") || "";
        const looksFile =
          /attachment/i.test(cd) ||
          /spreadsheet|excel|octet-stream|csv|zip/i.test(ct) ||
          /export|download/i.test(url);
        if (res.ok && looksFile) {
          const clone = res.clone();
          clone.arrayBuffer().then((buf) => {
            const match = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
            const name = match
              ? match[1].replace(/['"]/g, "")
              : `${portal}_fuel_${reportDate}.csv`;
            uploadCaptured(portal, reportDate, buf, ct || "text/csv", name);
          });
        }
      } catch {
        /* never break page fetch */
      }
      return res;
    };
  }

  async function downloadIoclReport(reportDate) {
    toast(`Opening transactions for ${reportDate}…`);
    if (!location.href.includes("Transactions")) {
      location.href = "https://beta.iocxtrapower.com/Transactions/TransactionDetails";
      return;
    }
    await sleep(2500);
    interceptDownload("iocl", reportDate);
    toast("Looking for export…");
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 180000) {
        clearInterval(timer);
        finish({
          ok: false,
          portal: "iocl",
          reportDate,
          error: "Export button not found. Use Manual upload or try again."
        });
        return;
      }
      const btns = Array.from(document.querySelectorAll("button, a, span"));
      const exportBtn = btns.find(
        (b) =>
          /export|excel|download|csv/i.test(b.textContent || "") ||
          b.querySelector("i.fa-file-excel, i.fa-download, .export-icon")
      );
      if (exportBtn) {
        clearInterval(timer);
        toast("Exporting…");
        exportBtn.click();
      }
    }, 1500);
  }

  function waitForLoginSuccess(reportDate) {
    const check = setInterval(() => {
      if (!location.href.includes("/account/login") && !location.href.includes("returnUrl")) {
        clearInterval(check);
        toast("Login OK — downloading…");
        setTimeout(() => downloadIoclReport(reportDate), 1500);
      }
    }, 1200);
  }

  chrome.storage.local.get(["pendingJob", "ioclUsername", "ioclPassword"], async (data) => {
    const job = data.pendingJob;
    if (!job || job.portal !== "iocl") return;
    if (Date.now() - (job.ts || 0) > 20 * 60 * 1000) return;

    const user = job.ioclUsername || data.ioclUsername || "";
    const pass = job.ioclPassword || data.ioclPassword || "";
    const reportDate = job.reportDate || new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (!user || !pass) {
      toast("IOCL credentials missing — start again from the dashboard.");
      return;
    }

    if (!location.href.includes("/account/login") && location.href.includes("Transactions")) {
      downloadIoclReport(reportDate);
      return;
    }

    toast("Dropx: filling IOCL login…");
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > 60000) {
        clearInterval(timer);
        return;
      }
      const userField = document.querySelector(
        'input[formcontrolname="userName"], input[name="userName"], #userName'
      );
      const passField = document.querySelector(
        'input[type="password"], input[formcontrolname="password"]'
      );

      if (userField && !userField.dataset.dropxFilled) {
        userField.dataset.dropxFilled = "1";
        await typeIntoField(userField, user);
      }
      if (passField && !passField.dataset.dropxFilled) {
        passField.dataset.dropxFilled = "1";
        clearInterval(timer);
        await typeIntoField(passField, pass);
        highlightCaptcha();
        askFocus("Solve captcha if shown, then click Login");
        toast("If a captcha appears, solve it and click Login — then leave the window.");
        waitForLoginSuccess(reportDate);
        const loginBtn = Array.from(document.querySelectorAll("button, input[type='submit']")).find(
          (b) => /login|sign.?in|continue|submit/i.test(b.textContent || b.value || "")
        );
        if (loginBtn) {
          setTimeout(() => loginBtn.click(), 400);
        }
      }
    }, 800);
  });
})();
