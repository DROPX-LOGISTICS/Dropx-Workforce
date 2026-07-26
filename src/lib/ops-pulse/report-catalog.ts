export const opsReportCatalog = [
  { type: "station_delivery", title: "Station Delivery Summary", description: "Day and station delivery, returns, MFN, active DAs and productivity.", source: "Delivery data" },
  { type: "da_delivery", title: "DA Delivery Detail", description: "Associate-level assigned, delivered, SWA, returns, MFN and activity.", source: "Delivery data" },
  { type: "capacity", title: "Capacity & Productivity", description: "Present capacity, active delivery capacity, shipment volume and SPR.", source: "Attendance + delivery" },
  { type: "attendance", title: "DA Attendance Detail", description: "Day-level attendance, punches, in/out time and work duration.", source: "Attendance" },
  { type: "cps", title: "Station CPS & Cost", description: "Station-day costs, CPS components, target, gap and impact.", source: "CPS" },
  { type: "cod", title: "COD Submission Status", description: "Submission, deposit, validation, variance and remittance status.", source: "COD" },
  { type: "closure", title: "Daily Operations Closure", description: "Station closure submissions, manager status and review timestamps.", source: "Daily operations" }
] as const;

export type OpsReportType = typeof opsReportCatalog[number]["type"];
export function isOpsReportType(value: string): value is OpsReportType {
  return opsReportCatalog.some((report) => report.type === value);
}
