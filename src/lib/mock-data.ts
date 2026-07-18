export type ProviderCode = "AMAZON" | "FLIPKART" | "MEESHO" | "DROPX";

export const providers = [
  { code: "AMAZON", name: "Amazon", externalIdLabel: "holder_employee_id", reportCadence: "Daily", status: "Active" },
  { code: "FLIPKART", name: "Flipkart", externalIdLabel: "Provider ID", reportCadence: "Daily", status: "Sample pending" },
  { code: "MEESHO", name: "Meesho", externalIdLabel: "Provider ID", reportCadence: "Daily", status: "Sample pending" },
  { code: "DROPX", name: "DropX", externalIdLabel: "DropX Partner ID", reportCadence: "Internal", status: "Active" }
] as const;

export const stations = [
  { code: "SBPD", name: "Sambalpur", city: "Sambalpur", state: "Odisha", provider: "Amazon", managers: 2, activeDas: 148, openBlocks: 19, status: "Active" },
  { code: "KTUB", name: "Kottakkal", city: "Malappuram", state: "Kerala", provider: "Amazon", managers: 1, activeDas: 67, openBlocks: 4, status: "Active" },
  { code: "GNTF", name: "Guntur", city: "Guntur", state: "Andhra Pradesh", provider: "Meesho", managers: 2, activeDas: 44, openBlocks: 8, status: "Active" },
  { code: "KOZA", name: "Kozhikode", city: "Kozhikode", state: "Kerala", provider: "Flipkart", managers: 3, activeDas: 121, openBlocks: 6, status: "Active" }
];

export const processStages = [
  {
    step: "1",
    title: "DA onboarding",
    owner: "Manager",
    writes: "delivery_associates, bank, documents",
    state: "Needs review"
  },
  {
    step: "2",
    title: "Provider ID mapping",
    owner: "Manager",
    writes: "provider_id_mappings",
    state: "37 unmapped"
  },
  {
    step: "3",
    title: "Rate approval",
    owner: "Admin",
    writes: "rate_cards, rate_card_lines",
    state: "1 draft"
  },
  {
    step: "4",
    title: "Daily report import",
    owner: "Admin",
    writes: "provider_report_raw, provider_daily_metrics",
    state: "Amazon processed"
  },
  {
    step: "5",
    title: "Earnings review",
    owner: "Admin",
    writes: "earnings_daily, earning_line_items",
    state: "Rs 18.42L MTD"
  },
  {
    step: "6",
    title: "Payroll close",
    owner: "Super Admin",
    writes: "salary_reports, adjustments",
    state: "Blocked by 53"
  }
];

export const dashboardMetrics = [
  { label: "MTD payable", value: "Rs 18.42L", foot: "Calculated after date-effective mapping" },
  { label: "Payroll blockers", value: "53", foot: "Unmapped IDs, rates, holds, corrections" },
  { label: "Mapping coverage", value: "97.8%", foot: "Amazon report rows resolved" },
  { label: "DAs on payout hold", value: "22", foot: "Bank, BGC, document, or approval pending" }
];

export const workQueue = [
  {
    priority: "P0",
    title: "Map 18 Amazon provider IDs before payroll close",
    owner: "SBPD Manager",
    due: "Today",
    cta: "Open mapping queue",
    status: "High"
  },
  {
    priority: "P0",
    title: "Approve Meesho GNTF rate card effective 2026-06-01",
    owner: "Admin",
    due: "Today",
    cta: "Review rate card",
    status: "High"
  },
  {
    priority: "P1",
    title: "Clear 22 payout holds before salary export",
    owner: "Admin",
    due: "2 days",
    cta: "Open hold list",
    status: "Medium"
  },
  {
    priority: "P1",
    title: "Review wrong mapping correction for FK-87421",
    owner: "Super Admin",
    due: "Tomorrow",
    cta: "Approve correction",
    status: "Pending"
  }
];

export const daRecords = [
  {
    dropxId: "DX-KTUB-1098",
    name: "Nisar Ahammed",
    phone: "98xxxxxx42",
    station: "KTUB",
    providers: "Amazon X, Amazon Y",
    onboarding: "Active",
    bank: "Verified",
    docs: "Verified",
    bgc: "Cleared",
    payout: "Ready"
  },
  {
    dropxId: "DX-SBPD-2311",
    name: "Karan Naik",
    phone: "94xxxxxx18",
    station: "SBPD",
    providers: "Flipkart FK-87421",
    onboarding: "Active",
    bank: "Verified",
    docs: "Verified",
    bgc: "Cleared",
    payout: "Ready"
  },
  {
    dropxId: "DX-GNTF-0712",
    name: "Modugula Ramprasad",
    phone: "90xxxxxx75",
    station: "GNTF",
    providers: "Meesho MSH-4418",
    onboarding: "Temporary Ops",
    bank: "Pending",
    docs: "Pending",
    bgc: "Not cleared",
    payout: "Hold"
  },
  {
    dropxId: "DX-KOZA-0844",
    name: "Rashid K",
    phone: "96xxxxxx27",
    station: "KOZA",
    providers: "Unmapped",
    onboarding: "Draft",
    bank: "Missing",
    docs: "DL expiring",
    bgc: "Pending",
    payout: "Hold"
  }
];

export const providerMappings = [
  {
    provider: "AMAZON",
    providerId: "AMZ-X-001",
    dropxId: "DX-KTUB-1098",
    name: "Nisar Ahammed",
    station: "KTUB",
    from: "2026-06-01",
    to: "2026-06-01",
    status: "Historical",
    reason: "Worked using X ID on 1st",
    approval: "Approved"
  },
  {
    provider: "AMAZON",
    providerId: "AMZ-Y-002",
    dropxId: "DX-KTUB-1098",
    name: "Nisar Ahammed",
    station: "KTUB",
    from: "2026-06-02",
    to: "Current",
    status: "Active",
    reason: "Started using Y ID from 2nd",
    approval: "Approved"
  },
  {
    provider: "AMAZON",
    providerId: "2000073546270",
    dropxId: "DX-KTUB-1042",
    name: "Muhammed Shibili CT",
    station: "KTUB",
    from: "2026-06-01",
    to: "2026-06-14",
    status: "Historical",
    reason: "Closed when remapped",
    approval: "Approved"
  },
  {
    provider: "AMAZON",
    providerId: "2000073546270",
    dropxId: "DX-KTUB-1098",
    name: "Nisar Ahammed",
    station: "KTUB",
    from: "2026-06-15",
    to: "Current",
    status: "Active",
    reason: "Ops remap",
    approval: "Approved"
  },
  {
    provider: "FLIPKART",
    providerId: "FK-87421",
    dropxId: "DX-SBPD-2311",
    name: "Karan Naik",
    station: "SBPD",
    from: "2026-06-01",
    to: "Current",
    status: "Correction pending",
    reason: "Manager selected wrong DA for 2026-06-12",
    approval: "Needs Admin"
  },
  {
    provider: "MEESHO",
    providerId: "MSH-4418",
    dropxId: "DX-GNTF-0712",
    name: "Modugula Ramprasad",
    station: "GNTF",
    from: "2026-06-11",
    to: "Current",
    status: "Active",
    reason: "Temporary ops absorption",
    approval: "Payout hold"
  }
];

export const mappingHistory = [
  {
    title: "Nisar used two Amazon IDs in one month",
    meta: "AMZ-X-001 pays 2026-06-01 to DX-KTUB-1098; AMZ-Y-002 pays from 2026-06-02 to the same DropX ID."
  },
  {
    title: "Provider ID 2000073546270 remapped",
    meta: "KTUB / Amazon / old mapping closed on 2026-06-14 / new mapping active from 2026-06-15."
  },
  {
    title: "Wrong mapping correction pending",
    meta: "SBPD / Flipkart / if June payroll is open, recalculate; if locked, create adjustment."
  },
  {
    title: "No-docs temporary mapping created",
    meta: "GNTF / Meesho / earning can calculate but payout stays on hold until onboarding is complete."
  }
];

export const rateCards = [
  {
    name: "Amazon DA - KTUB - June v1",
    provider: "AMAZON",
    station: "KTUB",
    effective: "2026-06-01",
    payType: "Per unit",
    delivery: "Rs 13.00",
    returnPickup: "Rs 6.00",
    mfn: "Rs 4.50",
    fuel: "Rs 1.25",
    status: "Active"
  },
  {
    name: "Flipkart DA - SBPD - June v1",
    provider: "FLIPKART",
    station: "SBPD",
    effective: "2026-06-01",
    payType: "Hybrid",
    delivery: "Rs 12.00",
    returnPickup: "Rs 5.50",
    mfn: "N/A",
    fuel: "Rs 1.00",
    status: "Active"
  },
  {
    name: "Meesho DA - GNTF - June draft",
    provider: "MEESHO",
    station: "GNTF",
    effective: "2026-06-01",
    payType: "Per unit",
    delivery: "Rs 10.00",
    returnPickup: "Rs 5.00",
    mfn: "N/A",
    fuel: "Rs 0.80",
    status: "Draft"
  }
];

export const reportImports = [
  {
    file: "amazon_daily_2026-06-15.xlsx",
    provider: "AMAZON",
    reportDate: "2026-06-15",
    idColumn: "holder_employee_id",
    rows: 1637,
    providerIds: 484,
    mapped: 1600,
    exceptions: 37,
    status: "Partially processed"
  },
  {
    file: "amazon_daily_2026-06-14.xlsx",
    provider: "AMAZON",
    reportDate: "2026-06-14",
    idColumn: "holder_employee_id",
    rows: 1582,
    providerIds: 469,
    mapped: 1582,
    exceptions: 0,
    status: "Processed"
  },
  {
    file: "flipkart_daily_sample_needed.xlsx",
    provider: "FLIPKART",
    reportDate: "Pending",
    idColumn: "Provider ID",
    rows: 0,
    providerIds: 0,
    mapped: 0,
    exceptions: 0,
    status: "Waiting for sample"
  }
];

export const earnings = [
  {
    dropxId: "DX-KTUB-1098",
    name: "Nisar Ahammed",
    station: "KTUB",
    providerIds: "AMZ-X-001, AMZ-Y-002, 2000073546270",
    delivery: 220,
    returns: 7,
    mfn: 16,
    gross: "Rs 3,034",
    deductions: "Rs 0",
    net: "Rs 3,034",
    hold: "No",
    status: "Ready"
  },
  {
    dropxId: "DX-SBPD-2311",
    name: "Karan Naik",
    station: "SBPD",
    providerIds: "FK-87421",
    delivery: 145,
    returns: 3,
    mfn: 0,
    gross: "Rs 1,756",
    deductions: "Rs 0",
    net: "Rs 1,756",
    hold: "Correction review",
    status: "Review"
  },
  {
    dropxId: "DX-GNTF-0712",
    name: "Modugula Ramprasad",
    station: "GNTF",
    providerIds: "MSH-4418",
    delivery: 96,
    returns: 2,
    mfn: 0,
    gross: "Rs 970",
    deductions: "Rs 0",
    net: "Rs 0",
    hold: "Docs pending",
    status: "Hold"
  }
];

export const earningLines = [
  {
    workDate: "2026-06-01",
    providerId: "AMZ-X-001",
    dropxId: "DX-KTUB-1098",
    deliveries: 42,
    rate: "Rs 13.00",
    payable: "Rs 546"
  },
  {
    workDate: "2026-06-02",
    providerId: "AMZ-Y-002",
    dropxId: "DX-KTUB-1098",
    deliveries: 39,
    rate: "Rs 13.00",
    payable: "Rs 507"
  },
  {
    workDate: "2026-06-15",
    providerId: "2000073546270",
    dropxId: "DX-KTUB-1098",
    deliveries: 45,
    rate: "Rs 13.00",
    payable: "Rs 585"
  }
];

export const exceptions = [
  {
    type: "Unmapped Provider ID",
    provider: "AMAZON",
    station: "SBPD",
    count: 18,
    owner: "Manager",
    severity: "High",
    action: "Map provider ID to DropX ID with effective date"
  },
  {
    type: "Missing rate card",
    provider: "MEESHO",
    station: "GNTF",
    count: 6,
    owner: "Admin",
    severity: "High",
    action: "Approve station/provider rate card"
  },
  {
    type: "Payout hold",
    provider: "AMAZON",
    station: "KTUB",
    count: 22,
    owner: "Admin",
    severity: "Medium",
    action: "Clear bank, BGC, and document checks"
  },
  {
    type: "Same-day split requested",
    provider: "FLIPKART",
    station: "KOZA",
    count: 2,
    owner: "Admin",
    severity: "High",
    action: "Approve manual split with audit note"
  },
  {
    type: "Wrong mapping correction",
    provider: "FLIPKART",
    station: "SBPD",
    count: 1,
    owner: "Super Admin",
    severity: "High",
    action: "Approve correction and recalculate or adjust"
  }
];

export const roleMatrix = [
  { role: "Super Admin", scope: "All providers, all stations", canApprove: "Payroll lock, corrections, role access" },
  { role: "Admin", scope: "All operational data", canApprove: "Rate cards, imports, payout holds" },
  { role: "Manager", scope: "Assigned station only", canApprove: "DA onboarding draft, mapping requests" },
  { role: "User / DA", scope: "Own profile and earnings", canApprove: "No approvals" }
];

export const appUsers = [
  {
    name: "Nisar Ahammed",
    email: "nisar@dropxlogistics.com",
    role: "Super Admin",
    stations: "All stations",
    modules: "All modules",
    status: "Active",
    lastSeen: "Today"
  },
  {
    name: "KTUB Station Lead",
    email: "ktub.manager@dropxlogistics.com",
    role: "Manager",
    stations: "KTUB",
    modules: "Onboarding, ID Mapping, Exceptions",
    status: "Active",
    lastSeen: "Yesterday"
  },
  {
    name: "Finance Admin",
    email: "finance@dropxlogistics.com",
    role: "Admin",
    stations: "All stations",
    modules: "Rate Cards, Earnings, Payroll",
    status: "Invite pending",
    lastSeen: "Not joined"
  },
  {
    name: "SBPD Team Lead",
    email: "sbpd.tl@dropxlogistics.com",
    role: "Manager",
    stations: "SBPD",
    modules: "Onboarding, ID Mapping",
    status: "Suspended",
    lastSeen: "2026-06-10"
  }
];

export const accessModules = [
  { module: "Command Center", superAdmin: "Full", admin: "Full", manager: "Station view", da: "No" },
  { module: "DA Onboarding", superAdmin: "Full", admin: "Full", manager: "Create/Edit station", da: "Own profile" },
  { module: "ID Mapping", superAdmin: "Approve correction", admin: "Approve correction", manager: "Request/Create station", da: "No" },
  { module: "Rate Cards", superAdmin: "Full", admin: "Create/Approve", manager: "Read only", da: "No" },
  { module: "Report Imports", superAdmin: "Full", admin: "Upload/Process", manager: "Read station", da: "No" },
  { module: "Earnings Review", superAdmin: "Lock payroll", admin: "Review/export", manager: "Station review", da: "Own earnings" },
  { module: "Users & Access", superAdmin: "Full", admin: "Invite managers", manager: "No", da: "No" }
];
