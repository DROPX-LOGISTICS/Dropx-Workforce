export type ReportImportMaster = {
  id: string;
  source_code: string;
  name: string;
  description: string | null;
  file_types: string[];
  day_offset: number;
  upload_time: string | null;
  frequency: "daily" | "weekly" | "monthly" | "adhoc";
  weekday: number | null;
  parser_type: string;
  dedupe_fields: string[];
  is_active: boolean;
};

export const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function reportSchedule(report: ReportImportMaster) {
  const offset = report.day_offset === -1 ? "D-1" : report.day_offset === 0 ? "D0" : `D${report.day_offset > 0 ? "+" : ""}${report.day_offset}`;
  const time = report.upload_time
    ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
      .format(new Date(`2000-01-01T${report.upload_time}+05:30`))
      .toLowerCase()
    : "time not set";
  const cadence = report.frequency === "weekly" && report.weekday !== null
    ? `weekly - every ${weekdayNames[report.weekday]}`
    : report.frequency;
  return `${offset} · ${time} · ${cadence}`;
}
