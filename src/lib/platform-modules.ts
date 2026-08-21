export const platformModules = [
  { code: "command_center", name: "Command Center" },
  { code: "leads", name: "Leads Management" },
  { code: "onboard", name: "Onboard" },
  { code: "field_executive", name: "Field Executive" },
  { code: "fleet", name: "Fleet" },
  { code: "inbox", name: "Inbox" },
  { code: "notifications", name: "Notifications" },
  { code: "id_mapping", name: "ID Mapping" },
  { code: "rate_cards", name: "Rate Cards" },
  { code: "report_imports", name: "Report Imports" },
  { code: "earnings_review", name: "Earnings Review" },
  { code: "users_access", name: "Users & Access" },
  { code: "master_data", name: "Master Data" },
  { code: "settings", name: "Settings" }
] as const;

export type PlatformModuleCode = (typeof platformModules)[number]["code"];
