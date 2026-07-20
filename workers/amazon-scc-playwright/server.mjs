import http from "node:http";
import crypto from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 8080);
const WORKER_SECRET = process.env.OPS_PORTAL_WORKER_SECRET || "";
const HEADLESS = String(process.env.HEADLESS ?? "true").toLowerCase() !== "false";
const SLOW_MO_MS = Number(process.env.SLOW_MO_MS || 0);
const WORKER_TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS || 90000);
const DEBUG_ARTIFACT_DIR = process.env.DEBUG_ARTIFACT_DIR || "";
const SESSION_STATE_DIR = process.env.SESSION_STATE_DIR || path.join(process.cwd(), ".scc-sessions");
const MANUAL_APPROVAL_WAIT_MS = Number(process.env.MANUAL_APPROVAL_WAIT_MS || 45000);

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

function formatSccDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text;
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function withStationParam(url, stationCode) {
  const station = String(stationCode ?? "").trim().toUpperCase();
  if (!station) return url;
  try {
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("stationCode", station);
    return nextUrl.toString();
  } catch {
    return url;
  }
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return normalizeText(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactIdentifier(value) {
  return normalizeText(value).replace(/[^a-z0-9_-]+/gi, "").toUpperCase();
}

function stableRosterId(stationCode, name, candidateId) {
  const explicit = compactIdentifier(candidateId);
  if (explicit && !/^(0|NA|N\/A|NULL|-)$/.test(explicit)) return explicit;
  const slug = normalizeName(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `SCC-${compactIdentifier(stationCode) || "STATION"}-${slug || "ASSOCIATE"}`;
}

function isLikelyHeaderOrTotal(row) {
  const text = normalizeText((row || []).join(" ")).toLowerCase();
  if (!text) return true;
  return /\b(total|grand total|summary|station|employee count|pending count)\b/i.test(text) ||
    /\b(name|driver|associate|executive)\b.*\b(status|amount|cod|recon)\b/i.test(text);
}

function isNonNameCell(value) {
  const text = normalizeText(value);
  if (!text) return true;
  if (/^\d+([.,]\d+)?$/.test(text.replace(/[,₹\s]/g, ""))) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) return true;
  if (/^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i.test(text)) return true;
  if (/^(pending|completed|done|closed|open|yes|no|na|n\/a|status|amount|cod|cash|driver|associate)$/i.test(text)) return true;
  return false;
}

function pickByHeader(headers, row, patterns) {
  const normalizedHeaders = (headers || []).map((header) => normalizeText(header).toLowerCase());
  for (const pattern of patterns) {
    const index = normalizedHeaders.findIndex((header) => pattern.test(header));
    if (index >= 0 && row[index] !== undefined) return row[index];
  }
  return "";
}

function amountFromRow(headers, row) {
  const value = pickByHeader(headers, row, [
    /pending.*recon/i,
    /pending.*reconciliation/i,
    /pending.*amount/i,
    /pending.*cod/i,
    /short/i,
    /liability/i,
    /\bcod\b/i,
    /amount/i
  ]);
  return safeNumber(value);
}

function statusFromRow(headers, row) {
  const headerValue = pickByHeader(headers, row, [/status/i, /state/i, /recon/i, /reconciliation/i]);
  if (normalizeText(headerValue)) return normalizeText(headerValue);
  const text = normalizeText(row.join(" "));
  const match = text.match(/\b(pending|completed|done|reconciled|not reconciled|unreconciled|short|closed|open)\b/i);
  return match ? match[0] : null;
}

function nameFromRow(headers, row) {
  const headerValue = pickByHeader(headers, row, [
    /associate.*name/i,
    /driver.*name/i,
    /executive.*name/i,
    /\bda\s*name\b/i,
    /\bname\b/i
  ]);
  if (normalizeText(headerValue) && !isNonNameCell(headerValue)) return normalizeText(headerValue);

  const candidates = row
    .map(normalizeText)
    .filter((value) => value && !isNonNameCell(value) && /[a-z]/i.test(value))
    .filter((value) => !/pending|recon|amount|status|station|route|total|liability/i.test(value));
  candidates.sort((first, second) => second.length - first.length);
  return candidates[0] || "";
}

function idFromRow(headers, row, name) {
  const headerValue = pickByHeader(headers, row, [
    /provider.*id/i,
    /employee.*id/i,
    /transporter.*id/i,
    /\bda\s*id\b/i,
    /driver.*id/i,
    /executive.*id/i,
    /\bid\b/i
  ]);
  if (compactIdentifier(headerValue)) return compactIdentifier(headerValue);

  const nameText = normalizeText(name).toLowerCase();
  const candidate = row
    .map(normalizeText)
    .find((value) => {
      const compact = compactIdentifier(value);
      if (!compact || normalizeText(value).toLowerCase() === nameText) return false;
      if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value)) return false;
      if (/^\d{1,2}:\d{2}/.test(value)) return false;
      if (/^\d+([.,]\d+)?$/.test(value.replace(/[,₹\s]/g, ""))) return false;
      return /^[A-Z0-9][A-Z0-9_-]{2,30}$/i.test(compact);
    });
  return compactIdentifier(candidate);
}

function extractDriverReconciliationAssociates(evidence, stationCode = "") {
  const rowsById = new Map();
  const tables = [...(evidence.tables || [])];
  if (Array.isArray(evidence.row_groups) && evidence.row_groups.length) {
    tables.push(...evidence.row_groups);
  }
  for (const table of tables) {
    const tableRows = Array.isArray(table.rows) ? table.rows : [];
    const headerCandidates = Array.isArray(table.headers) && table.headers.length ? table.headers : tableRows[0] || [];
    const headers = headerCandidates.map(normalizeText);
    for (const row of tableRows) {
      const cells = (row || []).map(normalizeText);
      if (cells.length < 2 || isLikelyHeaderOrTotal(cells)) continue;
      const associateName = nameFromRow(headers, cells);
      if (!associateName) continue;
      const normalizedAssociateName = normalizeName(associateName);
      if (!normalizedAssociateName || normalizedAssociateName.length < 3) continue;
      const providerEmployeeId = stableRosterId(stationCode, associateName, idFromRow(headers, cells, associateName));
      const pendingAmount = amountFromRow(headers, cells);
      const reconciliationState = statusFromRow(headers, cells);
      const routeCode = normalizeText(pickByHeader(headers, cells, [/route/i, /wave/i, /cycle/i]));
      rowsById.set(providerEmployeeId, {
        provider_employee_id: providerEmployeeId,
        associate_name: associateName,
        normalized_associate_name: normalizedAssociateName,
        route_code: routeCode || null,
        reconciliation_state: reconciliationState,
        pending_amount: pendingAmount,
        raw_row: { headers, cells }
      });
    }
  }
  for (const row of evidence.text_rows || []) {
    const cells = String(row ?? "").split(/\s{2,}|\t+/).map(normalizeText).filter(Boolean);
    if (cells.length >= 2) {
      const headers = ["name", "id", "provider", "type", "expected", "undebriefed mpos", "undebriefed cash", "variance", "running balance", "pending recon"];
      const associateName = nameFromRow(headers, cells);
      if (associateName) {
        const normalizedAssociateName = normalizeName(associateName);
        const providerEmployeeId = stableRosterId(stationCode, associateName, idFromRow(headers, cells, associateName));
        if (!rowsById.has(providerEmployeeId)) {
          rowsById.set(providerEmployeeId, {
            provider_employee_id: providerEmployeeId,
            associate_name: associateName,
            normalized_associate_name: normalizedAssociateName,
            route_code: null,
            reconciliation_state: "SCC Driver Reconciliation",
            pending_amount: amountFromRow(headers, cells),
            raw_row: { headers, cells, source: "text_row" }
          });
        }
      }
    }
  }
  return Array.from(rowsById.values()).sort((first, second) =>
    String(first.associate_name).localeCompare(String(second.associate_name))
  );
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function amountTextVariants(value) {
  const amount = safeNumber(value);
  if (!amount) return [];
  return Array.from(new Set([
    String(amount),
    amount.toFixed(2),
    amount.toLocaleString("en-IN"),
    amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    `₹ ${amount.toLocaleString("en-IN")}`,
    `₹${amount.toLocaleString("en-IN")}`
  ].filter(Boolean)));
}

function detailTrackingIdFromRow(headers, row) {
  const value = pickByHeader(headers, row, [/tracking/i, /shipment/i, /package/i, /order/i, /\bawb\b/i, /\btba\b/i]);
  if (compactIdentifier(value)) return normalizeText(value);
  const candidate = row.map(normalizeText).find((cell) => {
    const compact = compactIdentifier(cell);
    if (compact.length < 7) return false;
    if (/^\d+([.,]\d+)?$/.test(cell.replace(/[,₹\s]/g, ""))) return false;
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(cell)) return false;
    return /[A-Z0-9]/i.test(compact);
  });
  return candidate ? normalizeText(candidate) : "";
}

function detailStatusFromRow(headers, row) {
  const value = pickByHeader(headers, row, [/status/i, /state/i, /reason/i, /remark/i]);
  if (normalizeText(value)) return normalizeText(value);
  const text = normalizeText(row.join(" "));
  const match = text.match(/\b(pending|open|closed|debriefed|undebriefed|reconciled|short|excess|paid|unpaid)\b/i);
  return match ? match[0] : "";
}

function detailAmountFromRow(headers, row) {
  return amountFromRow(headers, row) || safeNumber(pickByHeader(headers, row, [/amount/i, /cash/i, /\bcod\b/i, /pending/i]));
}

function extractPendingReconDetailRows(evidence, associate) {
  const details = [];
  const tables = [...(evidence.tables || [])];
  if (Array.isArray(evidence.row_groups)) tables.push(...evidence.row_groups);
  for (const table of tables) {
    const tableRows = Array.isArray(table.rows) ? table.rows : [];
    const headerCandidates = Array.isArray(table.headers) && table.headers.length ? table.headers : tableRows[0] || [];
    const headers = headerCandidates.map(normalizeText);
    for (const row of tableRows) {
      const cells = (row || []).map(normalizeText).filter(Boolean);
      if (cells.length < 2 || isLikelyHeaderOrTotal(cells)) continue;
      const trackingId = detailTrackingIdFromRow(headers, cells);
      const amount = detailAmountFromRow(headers, cells);
      const status = detailStatusFromRow(headers, cells);
      if (!trackingId && !amount) continue;
      details.push({
        tracking_id: trackingId || null,
        amount,
        status: status || null,
        description: cells.slice(0, 8).join(" | "),
        raw_row: { headers, cells, source_url: evidence.url, associate: associate.associate_name }
      });
      if (details.length >= 100) return details;
    }
  }
  if (!details.length) {
    for (const row of evidence.text_rows || []) {
      const cells = String(row ?? "").split(/\s{2,}|\t+/).map(normalizeText).filter(Boolean);
      if (cells.length < 2 || isLikelyHeaderOrTotal(cells)) continue;
      const headers = ["tracking", "amount", "status", "description"];
      const trackingId = detailTrackingIdFromRow(headers, cells);
      const amount = detailAmountFromRow(headers, cells);
      if (!trackingId && !amount) continue;
      details.push({
        tracking_id: trackingId || null,
        amount,
        status: detailStatusFromRow(headers, cells) || null,
        description: cells.slice(0, 8).join(" | "),
        raw_row: { headers, cells, source: "text_row", source_url: evidence.url, associate: associate.associate_name }
      });
      if (details.length >= 100) break;
    }
  }
  return details;
}

async function clickPendingReconForAssociate(page, associate) {
  const name = normalizeText(associate.associate_name);
  const rawCells = Array.isArray(associate.raw_row?.cells) ? associate.raw_row.cells : [];
  const explicitId = compactIdentifier(rawCells[1] || associate.provider_employee_id);
  const rowNeedle = explicitId && !explicitId.startsWith("SCC-") ? explicitId : name;
  const pendingAmount = safeNumber(associate.pending_amount);
  const amountVariants = amountTextVariants(pendingAmount);
  const rowLocator = page.locator("tr, [role='row']").filter({
    hasText: new RegExp(escapeRegex(rowNeedle), "i")
  }).first();

  if (!(await rowLocator.count().catch(() => 0))) return false;
  if (!(await rowLocator.isVisible().catch(() => false))) return false;

  const clickables = await rowLocator.locator("a, button, [role='button'], [onclick]").all().catch(() => []);
  for (const clickable of clickables) {
    const text = normalizeText(await clickable.innerText().catch(() => ""));
    const href = normalizeText(await clickable.getAttribute("href").catch(() => ""));
    const haystack = `${text} ${href}`;
    const amountMatch = amountVariants.some((variant) => haystack.includes(variant));
    if (amountMatch || /pending|recon|amount|cash|liability/i.test(haystack)) {
      await clickable.click({ timeout: 5000 }).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
      return true;
    }
  }

  for (const variant of amountVariants) {
    const amountLink = rowLocator.getByText(variant, { exact: false }).first();
    if (await amountLink.count().catch(() => 0)) {
      await amountLink.click({ timeout: 5000 }).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
      return true;
    }
  }
  return false;
}

async function closePendingDetail(page, beforeUrl) {
  if (page.url() !== beforeUrl) {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
    return;
  }
  await clickFirst(page, [
    { role: "button", name: /close|back|cancel|done|ok/i },
    "[aria-label*='close' i]",
    ".modal button.close",
    ".modal .close"
  ]).catch(() => null);
  await page.keyboard.press("Escape").catch(() => null);
  await page.waitForTimeout(400);
}

async function collectPendingDetailsForAssociates(page, associates) {
  const limit = Math.max(0, Number(process.env.SCC_PENDING_DETAIL_LIMIT || 25));
  const enriched = [];
  let checked = 0;
  for (const associate of associates) {
    const pendingAmount = safeNumber(associate.pending_amount);
    if (pendingAmount <= 0 || checked >= limit) {
      enriched.push({ ...associate, pending_details: [] });
      continue;
    }
    const beforeUrl = page.url();
    const clicked = await clickPendingReconForAssociate(page, associate);
    if (!clicked) {
      enriched.push({
        ...associate,
        pending_details: [],
        raw_row: { ...(associate.raw_row || {}), detail_error: "Pending recon link was not found." }
      });
      continue;
    }
    await page.waitForTimeout(800);
    const detailEvidence = await collectPageEvidence(page);
    const pendingDetails = extractPendingReconDetailRows(detailEvidence, associate);
    const checkedAt = new Date().toISOString();
    enriched.push({
      ...associate,
      pending_details: pendingDetails,
      last_detail_checked_at: checkedAt,
      raw_row: {
        ...(associate.raw_row || {}),
        pending_details: pendingDetails,
        detail_url: detailEvidence.url,
        detail_checked_at: checkedAt
      }
    });
    checked += 1;
    await closePendingDetail(page, beforeUrl);
  }
  return enriched;
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

function sessionStatePath(payload) {
  const key = [
    payload.company_id || "company",
    payload.portal_code || "scc",
    payload.username || "user"
  ].map((part) => compactIdentifier(part) || "X").join("-");
  return path.join(SESSION_STATE_DIR, `${key}.json`);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeTotpSecret(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^otpauth:\/\//i.test(raw)) {
    try {
      return normalizeTotpSecret(new URL(raw).searchParams.get("secret") || "");
    } catch {
      return "";
    }
  }
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

function base32ToBuffer(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = normalizeTotpSecret(secret).replace(/=+$/g, "");
  if (!normalized || /[^A-Z2-7]/.test(normalized)) {
    throw new Error("Invalid MFA authenticator secret.");
  }

  let bits = "";
  for (const char of normalized) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotp(secret, now = Date.now()) {
  const key = base32ToBuffer(secret);
  const counter = Math.floor(now / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

async function waitForLoginToClear(page, waitMs) {
  const deadline = Date.now() + Math.max(0, Number.isFinite(waitMs) ? waitMs : 0);
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => null);
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (!hasMfaOrHumanBlocker(text) && !isLoginVisible(text, page.url())) {
      return true;
    }
  }
  return false;
}

async function attemptMfa(page, payload) {
  const secret = normalizeTotpSecret(payload.mfa_secret);
  if (!secret) return { attempted: false, submitted: false, message: "No MFA authenticator secret saved." };

  let code = "";
  try {
    code = generateTotp(secret);
  } catch (error) {
    return { attempted: true, submitted: false, message: (error).message || "Invalid MFA authenticator secret." };
  }

  const filled = await fillFirst(page, [
    "#auth-mfa-otpcode",
    "input[name='otpCode']",
    "input[name='code']",
    "input[autocomplete='one-time-code']",
    "input[id*='otp' i]",
    "input[id*='mfa' i]",
    "input[type='tel']",
    "input[type='text']"
  ], code);

  if (!filled) return { attempted: true, submitted: false, message: "MFA code field was not found." };

  await clickFirst(page, [
    "#auth-signin-button",
    "#signInSubmit",
    { role: "button", name: /verify|submit|continue|sign in|log in|login/i },
    "button[type='submit']",
    "input[type='submit']"
  ]);
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  return { attempted: true, submitted: true, message: "MFA authenticator code submitted." };
}

async function resolveMfaOrManualBlocker(page, payload) {
  const mfaAttempt = await attemptMfa(page, payload);
  if (mfaAttempt.submitted) {
    const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    if (!hasMfaOrHumanBlocker(text) && !isLoginVisible(text, page.url())) {
      return { resolved: true, message: "Login completed with saved MFA authenticator secret.", mfaAttempt };
    }
  }

  const approved = await waitForLoginToClear(page, MANUAL_APPROVAL_WAIT_MS);
  if (approved) {
    return { resolved: true, message: "Login completed after Amazon approval.", mfaAttempt };
  }

  const message = mfaAttempt.attempted
    ? `${mfaAttempt.message} Amazon still needs MFA/manual verification.`
    : "Amazon requested MFA or manual verification. Save the authenticator setup key in Settings > Amazon Connector, or approve the Amazon challenge once when prompted.";

  return { resolved: false, message, mfaAttempt };
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
    if (hasMfaOrHumanBlocker(text)) {
      const challenge = await resolveMfaOrManualBlocker(page, payload);
      if (challenge.resolved) {
        return { loggedIn: true, message: challenge.message, mfaAttempt: challenge.mfaAttempt };
      }
      return { loggedIn: false, manualReview: true, message: challenge.message, mfaAttempt: challenge.mfaAttempt };
    }
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
  if (hasMfaOrHumanBlocker(text)) {
    const challenge = await resolveMfaOrManualBlocker(page, payload);
    if (challenge.resolved) {
      return { loggedIn: true, message: challenge.message, mfaAttempt: challenge.mfaAttempt };
    }
    return { loggedIn: false, manualReview: true, message: challenge.message, mfaAttempt: challenge.mfaAttempt };
  }
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
  const displayDate = formatSccDate(date);

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
      const value = type === "date" ? date : displayDate;
      await input.fill(value).catch(() => null);
      await input.evaluate((element, nextValue) => {
        element.value = nextValue;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }, value).catch(() => null);
      await page.keyboard.press("Enter").catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
      return { changed: true, message: `Date set to ${displayDate}.` };
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
    const cleanCell = (value) => (value || "").replace(/\s+/g, " ").trim();
    const tables = Array.from(document.querySelectorAll("table")).map((table) => {
      const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th, tr:first-child td"))
        .map((cell) => cleanCell(cell.textContent || ""))
        .filter(Boolean);
      const rows = Array.from(table.querySelectorAll("tbody tr, tr")).slice(0, 200).map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((cell) => cleanCell(cell.textContent || ""))
      ).filter((row) => row.some(Boolean));
      return { headers, rows };
    });
    const rowGroups = Array.from(document.querySelectorAll("[role='table'], [role='grid'], .table, .grid, .driver-reconciliation, .driverReconciliation"))
      .slice(0, 20)
      .map((group) => {
        const headerNodes = Array.from(group.querySelectorAll("[role='columnheader'], th"));
        const headers = headerNodes.map((cell) => cleanCell(cell.textContent || "")).filter(Boolean);
        const rows = Array.from(group.querySelectorAll("[role='row'], tr"))
          .slice(0, 250)
          .map((row) => {
            const cells = Array.from(row.querySelectorAll("[role='cell'], [role='gridcell'], td, th"));
            return cells.length
              ? cells.map((cell) => cleanCell(cell.textContent || "")).filter(Boolean)
              : cleanCell(row.textContent || "").split(/\s{2,}|\t+/).map(cleanCell).filter(Boolean);
          })
          .filter((row) => row.length > 1);
        return { headers, rows };
      })
      .filter((group) => group.rows.length);
    const textRows = Array.from(document.querySelectorAll("tr, [role='row']"))
      .slice(0, 250)
      .map((row) => cleanCell(row.textContent || ""))
      .filter(Boolean);
    return {
      title: document.title,
      url: location.href,
      text: bodyText.replace(/\s+/g, " ").slice(0, 12000),
      raw_text: bodyText.slice(0, 20000),
      tables,
      row_groups: rowGroups,
      text_rows: textRows
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

function summarizeDriverReconciliation(evidence, stationCode, checkDate, associatesOverride = null) {
  const text = evidence.text || "";
  if (hasMfaOrHumanBlocker(text)) {
    return {
      status: "Manual Review",
      pending_count: 0,
      pending_amount: 0,
      summary: "Amazon SCC needs MFA or manual verification before Driver Reconciliation can be inspected.",
      associates: [],
      evidence
    };
  }

  const associates = Array.isArray(associatesOverride) ? associatesOverride : extractDriverReconciliationAssociates(evidence, stationCode);
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
    associates,
    summary: status === "Pass"
      ? `Driver reconciliation is clear for ${stationCode} on ${checkDate}.`
      : status === "Fail"
        ? `Driver reconciliation has pending rows or amount for ${stationCode} on ${checkDate}.`
        : `Driver reconciliation page loaded, but layout was not clear enough to confirm ${stationCode} on ${checkDate}.`,
    evidence: {
      ...evidence,
      pending_examples: pendingRows.examples,
      associates
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
    await mkdir(SESSION_STATE_DIR, { recursive: true });
    const statePath = sessionStatePath(payload);
    const hasStoredSession = await pathExists(statePath);
    const context = await browser.newContext({
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      viewport: { width: 1440, height: 1000 },
      ...(hasStoredSession ? { storageState: statePath } : {})
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
        raw_result: { login: { ...loginResult, session_reused: hasStoredSession } }
      };
    }

    await context.storageState({ path: statePath }).catch(() => null);

    const targetUrl = checkType === "prepared_deposit"
      ? payload.urls?.bank_deposits || BANK_DEPOSITS_URL
      : payload.urls?.driver_reconciliation || DRIVER_RECON_URL;

    await page.goto(withStationParam(targetUrl, stationCode), { waitUntil: "domcontentloaded", timeout: 45000 });
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
    let summary;
    if (checkType === "prepared_deposit") {
      summary = summarizePreparedDeposit(evidence, stationCode, checkDate);
    } else {
      const rosterAssociates = extractDriverReconciliationAssociates(evidence, stationCode);
      const enrichedAssociates = await collectPendingDetailsForAssociates(page, rosterAssociates);
      summary = summarizeDriverReconciliation(evidence, stationCode, checkDate, enrichedAssociates);
    }

    return {
      ...summary,
      evidence: {
        ...summary.evidence,
        debug_screenshot: debugScreenshot,
        station_selector: stationResult,
        date_selector: dateResult
      },
      raw_result: {
        login: { ...loginResult, session_reused: hasStoredSession, session_saved: true },
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
