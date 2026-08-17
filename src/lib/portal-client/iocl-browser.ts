import CryptoJS from "crypto-js";

const TOKEN = "8080808080808080";

type IoclSession = {
  username?: string;
  password: string;
  customerId?: string;
};

function encryptJson(obj: unknown): string {
  const plain = JSON.stringify(obj);
  const key = CryptoJS.enc.Utf8.parse(TOKEN);
  const iv = CryptoJS.lib.WordArray.create([0, 0, 0, 0]);
  return CryptoJS.AES.encrypt(plain, key, { iv }).toString();
}

function decryptString(cipherText: string): string {
  const key = CryptoJS.enc.Utf8.parse(TOKEN);
  const iv = CryptoJS.lib.WordArray.create([0, 0, 0, 0]);
  return CryptoJS.AES.decrypt(cipherText, key, { iv }).toString(CryptoJS.enc.Utf8);
}

function unwrapPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.data !== "string") return payload;
  const dataStr = obj.data.trim();
  if (dataStr.startsWith("{") || dataStr.startsWith("[")) {
    try {
      return { ...obj, data: JSON.parse(dataStr) };
    } catch {
      return payload;
    }
  }
  const plain = decryptString(dataStr);
  if (!plain) return payload;
  try {
    return { ...obj, data: JSON.parse(plain) };
  } catch {
    return { ...obj, data: plain };
  }
}

function uniqueKey(userName: string) {
  const stamp = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date()).replace(",", "");
  const rand = Math.floor(Math.random() * 900_000) + 100_000;
  return `${userName}|${stamp}|${rand}`;
}

function ymdToIoclUi(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function addDaysYmd(ymd: string, days: number) {
  const dt = new Date(`${ymd}T00:00:00+05:30`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function postEncrypted(
  proxyFetch: typeof fetch,
  base: string,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  const payload = { ...body, Uniquekey: body.Uniquekey || uniqueKey(String(body.UserName || body.userName || "")) };
  const response = await proxyFetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: "https://beta.iocxtrapower.com",
      referer: "https://beta.iocxtrapower.com/account/login",
      ...headers
    },
    body: JSON.stringify({ Request: encryptJson(payload) })
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return unwrapPayload(json) as Record<string, unknown>;
}

function rowsToCsv(rows: unknown[]): string {
  if (!rows.length) return "";
  const objects = rows.filter((r) => r && typeof r === "object") as Record<string, unknown>[];
  if (!objects.length) return "";
  const headers = [...new Set(objects.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown) => {
    const raw = value == null ? "" : String(value);
    return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };
  return [
    headers.join(","),
    ...objects.map((row) => headers.map((key) => escape(row[key])).join(","))
  ].join("\n");
}

export async function runIoclFuelInBrowser(args: {
  session: IoclSession;
  reportDate: string;
  proxyFetch: typeof fetch;
}): Promise<File> {
  const loginBase = "https://betaapi.iocxtrapower.com/LoginAPI/api/";
  const apiBase = "https://betaapi.iocxtrapower.com/APIGateway/api/";
  const username = String(args.session.username || "").trim();
  const password = String(args.session.password || "").trim();
  if (!username || !password) throw new Error("IOCL credentials are missing.");

  const login = await postEncrypted(args.proxyFetch, loginBase, "Login", { UserName: username, Password: password });
  const info = (login.info || {}) as { message?: string; isSuccess?: boolean };
  const data = login.data as Record<string, unknown> | string | null;
  let token = "";
  if (data && typeof data === "object") {
    token = String(data.token || data.Token || data.accessToken || "");
  }
  if (!token && typeof login.data === "string") {
    try {
      const parsed = JSON.parse(login.data) as Record<string, unknown>;
      token = String(parsed.token || parsed.Token || "");
    } catch {
      /* ignore */
    }
  }
  if (!token) {
    throw new Error(info.message || "IOCL login did not return a token (browser path). Use Manual upload.");
  }

  const fromUi = ymdToIoclUi(args.reportDate);
  const toUi = ymdToIoclUi(addDaysYmd(args.reportDate, 1));
  const customerId = String(args.session.customerId || "1002424122").trim();
  const authHeaders = {
    authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
    username
  };

  const summary = await postEncrypted(
    args.proxyFetch,
    apiBase,
    "Transaction/GetTransactionSummary",
    {
      CustomerId: customerId,
      FromDate: fromUi,
      ToDate: toUi,
      PageIndex: 1,
      PageSize: 5000
    },
    authHeaders
  );
  const summaryData = summary.data;
  const rows = Array.isArray(summaryData)
    ? summaryData
    : summaryData && typeof summaryData === "object" && Array.isArray((summaryData as { rows?: unknown[] }).rows)
      ? (summaryData as { rows: unknown[] }).rows
      : [];
  let csv = rowsToCsv(rows);

  if (!csv || csv.length < 40) {
    const exp = await postEncrypted(
      args.proxyFetch,
      apiBase,
      "Transaction/GetTransactionSummaryEXP",
      {
        CustomerId: customerId,
        FromDate: fromUi,
        ToDate: toUi
      },
      authHeaders
    );
    const expData = exp.data;
    if (typeof expData === "string" && expData.includes("SNo")) {
      csv = expData;
    }
  }

  if (!csv || csv.length < 20) {
    throw new Error("IOCL export returned no transaction rows. Use Manual upload.");
  }

  const fileName = `iocl_fuel_${args.reportDate}.csv`;
  return new File([csv], fileName, { type: "text/csv" });
}
