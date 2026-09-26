import type { AuthorizationContext } from "@/lib/authorization";

export type NavItem = {
  children?: Array<{ code?: string; href?: string; label: string; secondary?: boolean }>;
  code: string;
  href?: string;
  icon: string;
  label: string;
};

export const fleetNavItem: NavItem = {
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
};

export const navItems: NavItem[] = [
  { code: "dashboard", label: "Command Center", href: "/dashboard", icon: "#" },
  fleetNavItem,
  { code: "assets", label: "Assets", href: "/assets", icon: "A" },
  { code: "imports", label: "Report Imports", href: "/imports", icon: "^" },
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
      { code: "attendance_reports", label: "Attendance", href: "/attendance" },
      { code: "raw_punch_reports", label: "Raw Punches", href: "/reports/raw-punches" },
      { code: "verification_api_reports", label: "Verification API", href: "/reports/verification-api" },
      { code: "event_log_reports", label: "Event Log", href: "/reports/event-log" }
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
      { code: "notifications_app", label: "App Notifications", href: "/notifications/app" }
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
      { code: "master_contacts", label: "Contacts", href: "/master/contacts" },
      { code: "workforce_categories", label: "Registration Policies", href: "/master/workforce-categories" },
      { code: "workforce_whatsapp", label: "Workforce WhatsApp", href: "/master/workforce-whatsapp" },
      { code: "designations", label: "Workforce Designations", href: "/delivery-network/designations" },
      { code: "biometric_devices", label: "Device Master", href: "/master/biometric-devices" },
      { code: "master_documents", label: "Documents", href: "/master/documents" },
      { code: "master_imports", label: "Import Master", href: "/master/imports" },
      { code: "master_asset_types", label: "Asset Categories", href: "/master/assets" }
    ]
  },
  {
    code: "app_settings",
    label: "Settings",
    icon: "S",
    children: [
      { code: "app_settings", label: "General", href: "/settings" },
      { code: "app_settings", label: "DropX ID Generation", href: "/settings/dropx-id-generation?type=dropx_id" },
      { code: "app_settings", label: "Biometric ID Generation", href: "/settings/dropx-id-generation?type=biometric_id" },
      { code: "app_settings", label: "App Notification", href: "/settings/app-notifications" },
      { code: "app_settings", label: "Verification APIs", href: "/settings/verification-apis" },
      { code: "app_settings", label: "Biometric Config", href: "/settings/biometric" },
      { code: "app_settings", label: "Biometric Monitor", href: "/biometric" },
      { code: "ai_connector", label: "AI Connector", href: "/settings/ai" },
      { code: "amazon_connector", label: "Amazon Connector", href: "/settings/amazon" },
      { code: "developer_mode", label: "Developer Mode", href: "/developer" }
    ]
  }
];

export const workforceNavItems: NavItem[] = [
  { code: "delivery_associates", label: "Workforce Dashboard", href: "/delivery-network", icon: "WR" },
  {
    code: "delivery_associates",
    label: "Associate Lifecycle",
    icon: "DA",
    children: [
      { code: "delivery_associates", label: "Associate Lifecycle", href: "/delivery-network/associates" },
      { code: "executive_id_onboarding", label: "Amazon lifecycle", href: "/delivery-network/amazon-lifecycle" },
      { code: "executive_id_onboarding", label: "Amazon ID & Activation", href: "/delivery-network/id-onboarding", secondary: true }
    ]
  },
  {
    code: "provider_mapping", label: "IDs & rates", icon: "ID",
    children: [
      { code: "provider_mapping", label: "ID & Rate Mapping", href: "/delivery-network/rate-mapping" },
      { code: "workforce_rate_cards", label: "Rate Cards", href: "/delivery-network/rate-cards" }
    ]
  },
  {
    code: "workforce_activity",
    label: "Attendance & routes",
    icon: "ID",
    children: [
      { code: "workforce_activity", label: "Attendance & Activity", href: "/delivery-network/activity" },
      { code: "workforce_activity", label: "Roster & Route Planning", href: "/delivery-network/associate-rostering" }
    ]
  },
  {
    code: "workforce_earnings",
    label: "Payments",
    icon: "₹",
    children: [
      { code: "workforce_earnings", label: "Live Earnings", href: "/delivery-network/earnings" },
      { code: "workforce_payroll", label: "Payouts", href: "/delivery-network/payroll" },
      { code: "workforce_adjustments", label: "Disputes & corrections", href: "/delivery-network/payout-review" },
      { code: "workforce_adjustments", label: "Adjustments & holds", href: "/delivery-network/adjustments", secondary: true },
      { code: "workforce_payroll", label: "Payment history", href: "/delivery-network/payment-ledger", secondary: true }
    ]
  },
  {
    code: "workforce_earnings",
    label: "Reports",
    icon: "RP",
    href: "/delivery-network/reports"
  },
  {
    code: "workforce_communications",
    label: "Connect",
    icon: "CM",
    children: [
      { code: "workforce_communications", label: "Workforce Connect Centre", href: "/delivery-network/communications" },
      { code: "workforce_communications", label: "Workforce support desk", href: "/delivery-network/connect" },
      { code: "workforce_speak_up", label: "Confidential Speak Up", href: "/delivery-network/speak-up" },
      { code: "workforce_communications_app", label: "DropX One Notifications", href: "/delivery-network/communications/dropx-one", secondary: true },
      { code: "workforce_communications_whatsapp", label: "WhatsApp", href: "/delivery-network/communications/whatsapp", secondary: true },
      { code: "workforce_communications_history", label: "Communication History", href: "/delivery-network/communications/history", secondary: true }
    ]
  },
  {
    code: "users", label: "User access", icon: "UA",
    children: [
      { code: "users", label: "Users & Access", href: "/users?section=users" },
      { code: "users", label: "User Roles", href: "/users?section=roles" }
    ]
  },
  {
    code: "payment_methods", label: "Master", icon: "MD",
    children: [
      { code: "payment_methods", label: "Payment Methods", href: "/master/payment-methods" }
    ]
  },
  {
    code: "designations",
    label: "Settings",
    icon: "WM",
    children: [
      { code: "people_review", label: "Setup Checklist", href: "/delivery-network/setup", secondary: true },
      { code: "executive_id_onboarding", label: "Amazon Activation Master", href: "/delivery-network/amazon-onboarding-settings" },
      { code: "executive_id_onboarding", label: "Amazon Status Guidance", href: "/delivery-network/amazon-status-guidance", secondary: true },
      { code: "workforce_payroll", label: "Payout calendars", href: "/delivery-network/payroll-calendars" },
      { code: "workforce_incentives", label: "Incentive rules", href: "/delivery-network/incentives", secondary: true },
      { code: "amazon_connector", label: "Amazon Connection", href: "/settings/amazon-onboarding", secondary: true },
      { code: "workforce_categories", label: "Registration Policies", href: "/delivery-network/engagement-types", secondary: true },
      { code: "designations", label: "Workforce Designations", href: "/delivery-network/designations", secondary: true },
      { code: "designations", label: "DropX One User Preview", href: "/delivery-network/dropx-one-preview", secondary: true },
      { code: "designations", label: "Designation Routing", href: "/delivery-network/designation-routing", secondary: true },
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
