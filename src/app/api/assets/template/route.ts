import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAuthorization, hasPermission } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthorization();
  if (!auth || !hasPermission(auth, "assets", "access")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = [{
    "Type Code": "LAPTOP", "Location Code": "HO", "Asset Code (optional)": "", Manufacturer: "Dell", Model: "Latitude 5450",
    "Serial Number": "SERIAL-001", "Purchase Date": "2026-08-10", "Purchase Value": 65000, "Warranty Expiry": "2029-08-09",
    Vendor: "Approved vendor", "PO Number": "PO-001", "Invoice Number": "INV-001", Condition: "new", Notes: "Opening stock"
  }];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [14, 16, 22, 16, 20, 20, 16, 16, 18, 20, 16, 18, 12, 24].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, "Assets");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  return new NextResponse(buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="DropX-asset-upload-template.xlsx"', "Cache-Control": "no-store" } });
}
