import type { AuthorizationContext } from "@/lib/authorization";

export type NavItem = {
  children?: Array<{ code?: string; href?: string; label: string }>;
  code: string;
  href?: string;
  icon: string;
  label: string;
};

export const navItems: NavItem[] = [
  { code: "dashboard", label: "Command Center", href: "/dashboard", icon: "#" },
  {
    code: "leads",
    label: "Leads",
    icon: "L",
    children: [
      { code: "leads_dashboard", label: "Dashboard", href: "/leads" },
      { code: "leads_all", label: "All Leads", href: "/leads/all" },
      { code: "leads_followups", label: "Follow-ups", href: "/leads/follow-ups" },
      { code: "leads_interviews", label: "Interviews", href: "/leads/interviews" },
      { code: "leads_reports", label: "Reports", href: "/leads/reports" },
      { code: "leads_ads", label: "All Ads", href: "/leads/ads" },
      { code: "leads_sop", label: "Ad SOP", href: "/leads/ad-sop" }
    ]
  },
  {
    code: "onboard",
    label: "Onboard",
    icon: "+",
    children: [
      { code: "delivery_associates", label: "Field Executive", href: "/field-executive" },
      { code: "employees", label: "Employees", href: "/employees" },
      { code: "contractors", label: "Contractors" },
      { code: "vendors", label: "Vendors" },
      { code: "workers", label: "Workers" }
    ]
  },
  { code: "provider_mapping", label: "ID Mapping", href: "/provider-mapping", icon: "<>" },
  {
    code: "fleet",
    label: "Fleet",
    icon: "F",
    children: [
      { code: "fleet_action_center", label: "Action Center", href: "/fleet?tab=action-center" },
      { code: "fleet_vehicle_view", label: "Vehicles", href: "/fleet?tab=vehicle-view" },
      { code: "fleet_date_view", label: "Documents", href: "/fleet?tab=date-view" },
      { code: "fleet_station_view", label: "Station View", href: "/fleet?tab=station-view" },
      { code: "fleet_tracking", label: "Tracking", href: "/fleet?tab=tracking" },
      { code: "fleet_fuel_log", label: "Fuel Log", href: "/fleet?tab=fuel-log" },
      { code: "fleet_live_gps", label: "Live GPS", href: "/fleet?tab=live-gps" },
      { code: "fleet_maintenance", label: "Maintenance", href: "/fleet?tab=maintenance" },
      { code: "fleet_reports", label: "Report", href: "/fleet?tab=report" }
    ]
  },
  { code: "mapping", label: "Mapping", href: "/mapping", icon: "<>" },
  { code: "rate_cards", label: "Rate Cards", href: "/rate-cards", icon: "Rs" },
  { code: "imports", label: "Report Imports", href: "/imports", icon: "^" },
  {
    code: "ops_pulse",
    label: "Ops Pulse",
    icon: "O",
    children: [
      { code: "daily_submission", label: "Daily Submission", href: "/ops-pulse/daily-submission" },
      { code: "cod", label: "COD", href: "/ops-pulse/cod" }
    ]
  },
  {
    code: "cps",
    label: "CPS",
    icon: "C",
    children: [
      { code: "cps_overview", label: "Overview", href: "/cps" },
      { code: "cps_stations", label: "Stations", href: "/cps?view=stations" },
      { code: "cps_shipments", label: "Shipments", href: "/cps?view=shipments" },
      { code: "cps_associates", label: "Associates", href: "/cps?view=associates" },
      { code: "cps_reports", label: "Reports", href: "/cps?view=reports" },
      { code: "imports", label: "Imports", href: "/imports" },
      { code: "cps_unmapped", label: "Unmapped IDs", href: "/cps?view=unmapped" },
      { code: "cps_inputs", label: "Inputs", href: "/cps?view=inputs" }
    ]
  },
  { code: "earnings", label: "Earnings Review", href: "/earnings", icon: "$" },
  { code: "exceptions", label: "Exceptions", href: "/exceptions", icon: "!" },
  { code: "inbox", label: "Inbox", href: "/inbox", icon: "I" },
  { code: "business_documents", label: "Business Docs", href: "/business-documents", icon: "D" },
  {
    code: "payments",
    label: "Payments",
    icon: "P",
    children: [
      { code: "expense_requests", label: "Expense Request", href: "/payments/expense-request" },
      { code: "payment_requests", label: "Payment Requests", href: "/payments/requests" },
      { code: "payment_approvals", label: "Approvals", href: "/payments/approvals" },
      { code: "payment_process", label: "Process", href: "/payments/process" },
      { code: "payment_reports", label: "Report", href: "/payments/report" }
    ]
  },
  {
    code: "reports",
    label: "Reports",
    icon: "R",
    children: [
      { code: "attendance_reports", label: "Attendance", href: "/attendance" }
    ]
  },
  { code: "trash", label: "Trash", href: "/trash", icon: "T" },
  {
    code: "notifications",
    label: "Notifications",
    icon: "N",
    children: [
      { code: "notifications_whatsapp", label: "WhatsApp", href: "/notifications/whatsapp" },
      { code: "notifications_history", label: "History", href: "/notifications/history" },
      { code: "notifications_app", label: "App Notifications" }
    ]
  },
  {
    code: "users",
    label: "Users & Access",
    icon: "@",
    children: [
      { code: "users", label: "Users", href: "/users?section=users" },
      { code: "users", label: "User Roles", href: "/users?section=roles" }
    ]
  },
  {
    code: "master_data",
    label: "Master Data",
    icon: "*",
    children: [
      { code: "master_locations", label: "Locations", href: "/master/location" },
      { code: "master_providers", label: "Providers", href: "/master/providers" },
      { code: "master_models", label: "Models", href: "/master/models" },
      { code: "payment_methods", label: "Payment Methods", href: "/master/payment-methods" },
      { code: "master_payment_banks", label: "Payment Banks", href: "/master/payment-banks" },
      { code: "master_payment_heads", label: "Payment Heads", href: "/master/payment-heads" },
      { code: "designations", label: "Designations", href: "/master/designations" },
      { code: "biometric_devices", label: "Device Master", href: "/master/biometric-devices" },
      { code: "cod_master", label: "COD Master", href: "/master/cod-master" },
      { code: "master_documents", label: "Documents", href: "/master/documents" }
    ]
  },
  {
    code: "app_settings",
    label: "Settings",
    icon: "S",
    children: [
      { code: "app_settings", label: "General", href: "/settings" },
      { code: "app_settings", label: "DropX ID Generation", href: "/settings/dropx-id-generation" },
      { code: "app_settings", label: "Biometric Config", href: "/settings/biometric" },
      { code: "app_settings", label: "Biometric Monitor", href: "/biometric" },
      { code: "ai_connector", label: "AI Connector", href: "/settings/ai" },
      { code: "amazon_connector", label: "Amazon Connector", href: "/settings/amazon" },
      { code: "developer_mode", label: "Developer Mode", href: "/developer" }
    ]
  }
];

function canAccess(authorization: AuthorizationContext, code?: string) {
  if (!code) return true;
  const permission = authorization.permissions[code];
  return Boolean(permission?.canView || permission?.canAdd || permission?.canEdit);
}

export function firstAllowedHref(authorization: AuthorizationContext) {
  for (const item of navItems) {
    if (item.href && canAccess(authorization, item.code)) return item.href;
    const child = item.children?.find((entry) => entry.href && canAccess(authorization, entry.code));
    if (child?.href) return child.href;
  }
  return null;
}
