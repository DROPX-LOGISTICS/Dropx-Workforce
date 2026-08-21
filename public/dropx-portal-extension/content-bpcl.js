/** BPCL portal automation (basic) inside the extension window. */

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

  async function typeIntoField(el, text) {
    el.focus();
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  chrome.storage.local.get(["pendingJob", "bpclUserId", "bpclPassword"], async (data) => {
    const job = data.pendingJob;
    if (!job || job.portal !== "bpcl") return;
    if (Date.now() - (job.ts || 0) > 20 * 60 * 1000) return;

    const user = job.bpclUserId || data.bpclUserId || "";
    const pass = job.bpclPassword || data.bpclPassword || "";
    if (!user || !pass) {
      toast("BPCL credentials missing — start from the dashboard.");
      return;
    }

    toast("Dropx: BPCL auto-login…");
    const timer = setInterval(async () => {
      const userField = document.querySelector('#login-user-id, input[name="username"]');
      if (userField && !userField.dataset.dropxFilled) {
        userField.dataset.dropxFilled = "1";
        clearInterval(timer);
        await typeIntoField(userField, user);
        const continueBtn =
          document.querySelector('[data-test-id="continue-btn"]') ||
          Array.from(document.querySelectorAll("button")).find((b) =>
            /continue/i.test(b.textContent || "")
          );
        if (continueBtn) continueBtn.click();
        setTimeout(async () => {
          const passField = document.querySelector('input[type="password"]');
          if (passField) {
            await typeIntoField(passField, pass);
            toast("Solve captcha if shown, then continue. Export will upload automatically when ready.");
            chrome.storage.local.get(["runnerWindowId"], (d) => {
              chrome.runtime.sendMessage({
                type: "DROPX_EXT_NEED_FOCUS",
                windowId: d.runnerWindowId
              });
            });
          }
        }, 1500);
      }
    }, 800);
  });
})();
