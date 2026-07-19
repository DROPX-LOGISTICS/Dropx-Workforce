import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 8080);
const WORKER_SECRET = process.env.OPS_PORTAL_WORKER_SECRET || "";
const HEADLESS = String(process.env.HEADLESS ?? "true").toLowerCase() !== "false";
const SLOW_MO_MS = Number(process.env.SLOW_MO_MS || 0);
const WORKER_TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS || 90000);
const DEBUG_ARTIFACT_DIR = process.env.DEBUG_ARTIFACT_DIR || "";

const DRIVER_RECON_URL = "https://www.amazonlogistics.eu/station/dashboard/driverreconciliation";
const BANK_DEPOSITS_URL = "https://www.amazonlogistics.eu/station/dashboard/bankdeposits";

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function unauthorized(res) {
  jsonResponse(res, 401, { error: "Unauthorized" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function requiredString(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function safeNumber(value) {
  const text = String(value ?? "").replace(/[,₹\s]/g, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAmountNear(text, labels) {
  const normalized = text.replace(/\s+/g, " ");
  for (const label of labels) {
    const pattern = new RegExp(`${label}[^0-9-]*(-?\\d[\\d,]*(?:\\.\\d+)?)`, "i");
    const match = normalized.match(pattern);
    if (match) return safeNumber(match[1]);
  }
  return 0;
}

function hasMfaOrHumanBlocker(text) {
  return /otp|one time password|two.?step|multi.?factor|verification code|captcha|approve.*notification|authentication required/i.test(text);
}

function isLoginVisible(text, url) {
  return /sign in|login|password|email|username/i.test(text) || /signin|login/i.test(url);
}

async function fillFirst(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      if (await locator.isVisible().catch(() => false)) {
        await locator.fill(value);
        return true;
      }
    }
  }
  return false;
}

async function clickFirst(page, candidates) {
  for (const candidate of candidates) {
    const locator = typeof candidate === "string"
      ? page.locator(candidate).first()
      : page.getByRole(candidate.role, { name: candidate.name }).first();
    if (await locator.count().catch(() => 0)) {
      if (await locator.isVisible().catch(() => false)) {
        await locator.click();
        return true;
      }
    }
  }
  return false;
}

async function maybeLogin(page, payload) {
  const loginUrl = payload.login_url || "https://www.amazonlogistics.eu/";
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);

  let text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (!isLoginVisible(text, page.url())) return { loggedIn: true, message: "Session already active." };

  const userFilled = await fillFirst(page, [
    "#ap_email",
    "input[type='email']",
    "input[name='email']",
    "input[name='username']",
    "input[name='userName']",
    "input[id*='email' i]",
    "input[id*='user' i]"
  ], payload.username);

  if (userFilled) {
    await clickFirst(page, [
      "#continue",
      { role: "button", name: /continue|next/i },
      "button[type='submit']",
      "input[type='submit']"
    ]);
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => null);
  }

  const passwordFilled = await fillFirst(page, [
    "#ap_password",
    "input[type='password']",
    "input[name='password']",
    "input[id*='password' i]"
  ], payload.password);

  if (!passwordFilled) {
    text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    if (hasMfaOrHumanBlocker(text)) return { loggedIn: false, manualReview: true, message: "Amazon requested MFA or manual verification." };
    return { loggedIn: false, manualReview: true, message: "Password field was not found. Amazon login layout needs mapping." };
  }

  await clickFirst(page, [
    "#signInSubmit",
    { role: "button", name: /sign in|log in|login|submit/i },
    "button[type='submit']",
    "input[type='submit']"
  ]);
  await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);

  text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (hasMfaOrHumanBlocker(text)) return { loggedIn: false, manualReview: true, message: "Amazon requested MFA or manual verification." };
  if (isLoginVisible(text, page.url())) return { loggedIn: false, manualReview: true, message: "Login did not complete. Check SCC credentials or Amazon login challenge." };
  return { loggedIn: true, message: "Login completed." };
}

async function setStation(page, stationCode) {
  const station = String(stationCode ?? "").trim();
  if (!station) return { changed: false, message: "No station code provided." };

  const selectors = [
    "select[name*='station' i]",
    "select[id*='station' i]",
    "input[name*='station' i]",
    "input[id*='station' i]",
    "input[placeholder*='station' i]"
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
    if (tagName === "select") {
      const matchingValue = await locator.evaluate((select, expected) => {
        const options = Array.from(select.options || []);
        const match = options.find((option) => {
          const haystack = `${option.textContent || ""} ${option.value || ""}`;
          return haystack.toLowerCase().includes(String(expected).toLowerCase());
        });
        return match?.value || "";
      }, station).catch(() => "");
      if (matchingValue) await locator.selectOption(matchingValue);
    } else {
      await locator.fill(station);
      await page.keyboard.press("Enter").catch(() => null);
    }
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
    return { changed: true, message: `Station set to ${station}.` };
  }

  await clickFirst(page, [
    { role: "button", name: /station|site|location/i },
    "[aria-label*='station' i]",
    "[data-testid*='station' i]"
  ]).catch(() => null);

  const option = page.getByText(new RegExp(`\\b${station}\\b`, "i")).first();
  if (await option.count().catch(() => 0)) {
    await option.click().catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
    return { changed: true, message: `Station selected from visible option ${station}.` };
  }

  return { changed: false, message: "Station selector was not found; inspected currently active station." };
}

async function setDate(page, checkDate) {
  const date = String(checkDate ?? "").trim();
  if (!date) return { changed: false, message: "No date provided." };
  const [year, month, day] = date.split("-");
  const displayDate = [day, month, year].filter(Boolean).join("/");

  const selectors = [
    "input[type='date']",
    "input[name*='date' i]",
    "input[id*='date' i]",
    "input[placeholder*='date' i]"
  ];

  for (const selector of selectors) {
    const inputs = await page.locator(selector).all().catch(() => []);
    for (const input of inputs) {
      if (!(await input.isVisible().catch(() => false))) continue;
      const type = await input.getAttribute("type").catch(() => "");
      await input.fill(type === "date" ? date : displayDate).catch(() => null);
      await page.keyboard.press("Enter").catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
      return { changed: true, message: `Date set to ${date}.` };
    }
  }

  return { changed: false, message: "Date input was not found; inspected the default date shown by SCC." };
}

async function applyFilters(page) {
  await clickFirst(page, [
    { role: "button", name: /search|apply|filter|show|submit|go/i },
    "button[type='submit']",
    "input[type='submit']"
  ]).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
}

async function collectPageEvidence(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    const tables = Array.from(document.querySelectorAll("table")).map((table) => {
      const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th, tr:first-child td"))
        .map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const rows = Array.from(table.querySelectorAll("tbody tr, tr")).slice(0, 200).map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim())
      ).filter((row) => row.some(Boolean));
      return { headers, rows };
    });
    return {
      title: document.title,
      url: location.href,
      text: bodyText.replace(/\s+/g, " ").slice(0, 12000),
      tables
    };
  });
}

function countPendingRows(tables) {
  let pending = 0;
  const examples = [];
  for (const table of tables) {
    for (const row of table.rows || []) {
      const text = row.join(" ");
      if (/pending|not reconciled|unreconciled|short|liability/i.test(text) && !/header/i.test(text)) {
        pending += 1;
        if (examples.length < 10) examples.push(row);
      }
    }
  }
  return { pending, examples };
}

function summarizeDriverReconciliation(evidence, stationCode, checkDate) {
  const text = evidence.text || "";
  if (hasMfaOrHumanBlocker(text)) {
    return {
      status: "Manual Review",
      pending_count: 0,
      pending_amount: 0,
      summary: "Amazon SCC needs MFA or manual verification before Driver Reconciliation can be inspected.",
      evidence
    };
  }

  const pendingAmount = parseAmountNear(text, [
    "pending recon amount",
    "pending reconciliation amount",
    "pending amount",
    "recon amount",
    "short amount"
  ]);
  const pendingRows = countPendingRows(evidence.tables || []);
  const explicitZero = /pending\s*(recon|reconciliation)?\s*(amount|count)?\s*[:=-]?\s*(0|0\.00|₹\s*0)/i.test(text) ||
    /no\s+(pending|liability|reconciliation)/i.test(text);
  const hasReportRows = (evidence.tables || []).some((table) => (table.rows || []).length > 1);
  const status = pendingAmount > 0 || pendingRows.pending > 0 ? "Fail" : (explicitZero || hasReportRows ? "Pass" : "Manual Review");

  return {
    status,
    pending_count: pendingRows.pending,
    pending_amount: pendingAmount,
    summary: status === "Pass"
      ? `Driver reconciliation is clear for ${stationCode} on ${checkDate}.`
      : status === "Fail"
        ? `Driver reconciliation has pending rows or amount for ${stationCode} on ${checkDate}.`
        : `Driver reconciliation page loaded, but layout was not clear enough to confirm ${stationCode} on ${checkDate}.`,
    evidence: {
      ...evidence,
      pending_examples: pendingRows.examples
    }
  };
}

function summarizePreparedDeposit(evidence, stationCode, checkDate) {
  const text = evidence.text || "";
  if (hasMfaOrHumanBlocker(text)) {
    return {
      status: "Manual Review",
      pending_count: 0,
      pending_amount: 0,
      summary: "Amazon SCC needs MFA or manual verification before Prepared Deposit can be inspected.",
      evidence
    };
  }

  const pendingAmount = parseAmountNear(text, [
    "pending liability",
    "liability amount",
    "amount to generate",
    "pending amount",
    "deposit amount"
  ]);
  const pendingRows = countPendingRows(evidence.tables || []);
  const noLiability = /no\s+(pending\s+)?liability|no\s+amount|nothing\s+to\s+generate|0\.00/i.test(text);
  const pageLooksRelevant = /prepared deposit|bank deposit|liability|remittance/i.test(text);
  const status = pendingAmount > 0 || pendingRows.pending > 0 ? "Fail" : (noLiability || pageLooksRelevant ? "Pass" : "Manual Review");

  return {
    status,
    pending_count: pendingRows.pending,
    pending_amount: pendingAmount,
    summary: status === "Pass"
      ? `Prepared deposit is clear for ${stationCode} on ${checkDate}.`
      : status === "Fail"
        ? `Prepared deposit shows pending liability for ${stationCode} on ${checkDate}.`
        : `Prepared deposit page loaded, but layout was not clear enough to confirm ${stationCode} on ${checkDate}.`,
    evidence: {
      ...evidence,
      pending_examples: pendingRows.examples
    }
  };
}

async function captureDebug(page, runId, label) {
  if (!DEBUG_ARTIFACT_DIR) return null;
  await mkdir(DEBUG_ARTIFACT_DIR, { recursive: true });
  const safeRunId = String(runId || "manual").replace(/[^a-z0-9_-]/gi, "_");
  const filePath = path.join(DEBUG_ARTIFACT_DIR, `${safeRunId}-${label}-${Date.now()}.png`);
  await page.screenshot({ path: filePath, fullPage: true }).catch(() => null);
  return filePath;
}

async function runSccCheck(payload) {
  requiredString(payload.username, "username");
  requiredString(payload.password, "password");
  const stationCode = requiredString(payload.portal_station_code || payload.station_code, "station_code");
  const checkDate = requiredString(payload.check_date, "check_date");
  const checkType = requiredString(payload.check_type, "check_type");

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: Number.isFinite(SLOW_MO_MS) ? SLOW_MO_MS : 0
  });

  try {
    const context = await browser.newContext({
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      viewport: { width: 1440, height: 1000 }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);

    const loginResult = await maybeLogin(page, payload);
    if (!loginResult.loggedIn) {
      const debugScreenshot = await captureDebug(page, payload.run_id, "login-blocked");
      return {
        status: loginResult.manualReview ? "Manual Review" : "Error",
        pending_count: 0,
        pending_amount: 0,
        summary: loginResult.message,
        evidence: {
          url: page.url(),
          title: await page.title().catch(() => ""),
          debug_screenshot: debugScreenshot
        },
        raw_result: { login: loginResult }
      };
    }

    const targetUrl = checkType === "prepared_deposit"
      ? payload.urls?.bank_deposits || BANK_DEPOSITS_URL
      : payload.urls?.driver_reconciliation || DRIVER_RECON_URL;

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);

    const stationResult = await setStation(page, stationCode);
    const dateResult = await setDate(page, checkDate);

    if (checkType === "prepared_deposit") {
      await clickFirst(page, [
        { role: "button", name: /prepared\s+deposit|prepare\s+deposit|generate|search|show/i },
        "button[type='submit']"
      ]).catch(() => null);
    } else {
      await applyFilters(page);
    }

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
    const evidence = await collectPageEvidence(page);
    const debugScreenshot = await captureDebug(page, payload.run_id, checkType);
    const summary = checkType === "prepared_deposit"
      ? summarizePreparedDeposit(evidence, stationCode, checkDate)
      : summarizeDriverReconciliation(evidence, stationCode, checkDate);

    return {
      ...summary,
      evidence: {
        ...summary.evidence,
        debug_screenshot: debugScreenshot,
        station_selector: stationResult,
        date_selector: dateResult
      },
      raw_result: {
        login: loginResult,
        station_selector: stationResult,
        date_selector: dateResult,
        inspected_url: evidence.url,
        page_title: evidence.title
      }
    };
  } finally {
    await browser.close().catch(() => null);
  }
}

async function handleRun(req, res) {
  if (WORKER_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${WORKER_SECRET}`) return unauthorized(res);
  }

  const raw = await readBody(req);
  const payload = JSON.parse(raw || "{}");
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Worker timed out after ${WORKER_TIMEOUT_MS}ms.`)), WORKER_TIMEOUT_MS);
  });
  const result = await Promise.race([runSccCheck(payload), timeout]);
  jsonResponse(res, 200, result);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return jsonResponse(res, 200, {
        ok: true,
        service: "dropx-amazon-scc-playwright-worker",
        headless: HEADLESS
      });
    }
    if (req.method === "POST" && (url.pathname === "/run" || url.pathname === "/")) {
      return await handleRun(req, res);
    }
    jsonResponse(res, 404, { error: "Not found" });
  } catch (error) {
    jsonResponse(res, 500, {
      status: "Error",
      error: error instanceof Error ? error.message : "Worker failed.",
      summary: error instanceof Error ? error.message : "Worker failed.",
      pending_count: 0,
      pending_amount: 0
    });
  }
});

server.listen(PORT, () => {
  console.log(`Amazon SCC Playwright worker listening on ${PORT}`);
});
