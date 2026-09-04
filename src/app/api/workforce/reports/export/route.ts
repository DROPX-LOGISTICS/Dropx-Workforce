import { NextRequest } from "next/server";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { loadWorkforceCommunicationRecipients } from "@/lib/workforce-communication-recipients";
import { loadWorkforceEarnings, workforceEarningsDateRange } from "@/lib/workforce-earnings";

export const dynamic = "force-dynamic";

function safe(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(rows: Array<Record<string, unknown>>) {
  const headers = rows.length ? Object.keys(rows[0]) : ["Result"];
  const values = rows.length ? rows : [{ Result: "No records match the selected filters." }];
  return `\uFEFF${[headers.map(safe).join(","), ...values.map((row) => headers.map((header) => safe(row[header])).join(","))].join("\n")}`;
}
function matches(values: unknown[], q: string) { return !q || values.some((value) => String(value ?? "").toLowerCase().includes(q)); }

export async function GET(request: NextRequest) {
  try {
    const authorization = await requirePagePermission("workforce_earnings", "access");
    const params = request.nextUrl.searchParams;
    const report = ["payments", "associates", "exceptions"].includes(params.get("report") ?? "") ? params.get("report")! : "earnings";
    if (report === "payments" && !hasPermission(authorization, "workforce_payroll", "view")) return Response.json({ error: "Payment exports require payroll view permission." }, { status: 403 });
    const { from, to } = workforceEarningsDateRange({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
    const station = params.get("station") ?? "";
    const state = (params.get("state") ?? "").toLowerCase();
    const q = (params.get("q") ?? "").trim().toLowerCase();
    const [snapshot, associates] = await Promise.all([loadWorkforceEarnings(authorization, from, to), loadWorkforceCommunicationRecipients(authorization)]);
    if (report !== "associates" && (snapshot.setupRequired || snapshot.warnings.length)) return Response.json({ error: "Export cancelled because source data is incomplete.", details: snapshot.warnings }, { status: 409 });
    let rows: Array<Record<string, unknown>>;
    if (report === "payments") {
      rows = snapshot.summaries.filter((row) => (!station || row.stationCode === station) && (!state || row.status === state) && matches([row.workerName, row.dropxId, ...row.providerIds], q)).map((row) => ({
        "DropX ID": row.dropxId, Associate: row.workerName, Station: row.stationCode, "Provider IDs": row.providerIds.join(", "), "Work days": row.workDays,
        Delivered: row.shipmentCount, "Base earnings": row.baseAmount, Incentive: row.incentiveAmount, Additions: row.earningAdjustments, Deductions: row.deductions,
        Gross: row.grossAmount, Net: row.netAmount, "Bank account": row.bankAccountNo, IFSC: row.ifscCode, Status: row.status, "Hold reasons": row.holdReasons.join(" | ")
      }));
    } else if (report === "associates") {
      rows = associates.filter((row) => (!station || row.location === station) && (!state || row.status.toLowerCase() === state) && matches([row.name, row.reference, row.mobile, row.email, row.designation], q)).map((row) => ({
        "DropX ID": row.reference, Associate: row.name, Designation: row.designation, Station: row.location, Provider: row.provider, Model: row.model,
        Mobile: row.mobile ? `+${row.countryCode} ${row.mobile}` : "", Email: row.email, "Biometric ID": row.biometricId,
        "Profile source": row.compatibilityMode ? "Protected legacy link" : "Canonical Workforce", Status: row.status, Active: row.isActive ? "Yes" : "No"
      }));
    } else {
      const lines = snapshot.lines.filter((line) => (!station || line.stationCode === station) && (!state || line.status === state) && matches([line.workerName, line.dropxId, line.providerMemberId, line.providerName], q));
      rows = (report === "exceptions" ? lines.filter((line) => !line.workforceId || ["unmapped", "missing_rate"].includes(line.status)) : lines).map((line) => ({
        Date: line.workDate, "DropX ID": line.dropxId ?? "", Associate: line.workerName, Station: line.stationCode, Provider: line.providerName,
        "Provider ID": line.providerMemberId, Delivered: line.totalDelivery, Activity: line.totalActivity, "Base earnings": line.baseAmount,
        Incentive: line.incentiveAmount, Adjustment: line.adjustmentAmount, Net: line.netAmount, Source: line.calculationSource,
        Status: line.status, Reason: line.holdReasons.join(" | ")
      }));
    }
    return new Response(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="workforce-${report}-${from}-to-${to}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to export Workforce report." }, { status: 500 });
  }
}
