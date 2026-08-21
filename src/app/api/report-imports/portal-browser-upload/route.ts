export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { POST as importReportPost } from "@/app/api/report-imports/route";

/**
 * Portal Helper (Tampermonkey) uploads captured IOCL/BPCL files here using the
 * operator's dashboard session cookies — no admin API key required in the browser.
 *
 * Body JSON: { source_type, report_date, fileName, contentType, bytesBase64 }
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    source_type?: string;
    report_date?: string;
    fileName?: string;
    contentType?: string;
    bytesBase64?: string;
  };

  const sourceType = String(body.source_type || "").trim();
  const reportDate = String(body.report_date || "").trim();
  const fileName = String(body.fileName || `${sourceType || "portal"}_${reportDate || "file"}`).trim();
  const contentType = String(body.contentType || "application/octet-stream").trim();
  const bytesBase64 = String(body.bytesBase64 || "").trim();

  if (!sourceType || !reportDate || !bytesBase64) {
    return Response.json(
      { error: "source_type, report_date, and bytesBase64 are required." },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return Response.json({ error: "report_date must be YYYY-MM-DD." }, { status: 400 });
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(bytesBase64), (ch) => ch.charCodeAt(0));
  } catch {
    return Response.json({ error: "bytesBase64 is not valid base64." }, { status: 400 });
  }
  if (!bytes.byteLength) {
    return Response.json({ error: "Uploaded file is empty." }, { status: 400 });
  }

  const form = new FormData();
  form.set("source_type", sourceType);
  form.set("report_date", reportDate);
  form.set("file", new File([new Uint8Array(bytes)], fileName, { type: contentType }));

  const cookie = request.headers.get("cookie") || "";
  const forward = new Request(new URL("/api/report-imports", request.url), {
    method: "POST",
    body: form,
    headers: cookie ? { cookie } : undefined
  });
  return importReportPost(forward);
}
