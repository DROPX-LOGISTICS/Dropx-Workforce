import { supabaseAdmin } from "@/lib/supabase-admin";

export type AmazonPortalCode = "yms" | "lsc" | "scc";

export const amazonPortalDefinitions: Array<{
  code: AmazonPortalCode;
  description: string;
  loginUrl: string;
  name: string;
  shortName: string;
  baseUrl: string;
}> = [
  {
    code: "yms",
    name: "Amazon YMS",
    shortName: "YMS",
    baseUrl: "https://www.amazonlogistics.eu/",
    loginUrl: "https://www.amazonlogistics.eu/",
    description: "Yard and vehicle movement portal."
  },
  {
    code: "lsc",
    name: "Amazon LSC",
    shortName: "LSC",
    baseUrl: "https://logistics.amazon.in/",
    loginUrl: "https://logistics.amazon.in/",
    description: "Logistics Support Center reports such as daily shipment count."
  },
  {
    code: "scc",
    name: "Amazon SCC",
    shortName: "SCC",
    baseUrl: "https://www.amazonlogistics.eu/",
    loginUrl: "https://www.amazonlogistics.eu/station/dashboard/workitemsvisibility",
    description: "Station Command Center checks for work items, driver reconciliation, and bank deposits."
  }
];

export const amazonTaskDefinitions: Record<AmazonPortalCode, Array<{ code: string; name: string; sourceUrl: string; interval: number }>> = {
  yms: [
    { code: "yard_management", name: "Yard management", sourceUrl: "https://www.amazonlogistics.eu/", interval: 30 },
    { code: "vehicle_movement", name: "Vehicle movement", sourceUrl: "https://www.amazonlogistics.eu/", interval: 30 }
  ],
  lsc: [
    { code: "daily_shipment_count", name: "Daily shipment count", sourceUrl: "https://logistics.amazon.in/", interval: 60 },
    { code: "performance_reports", name: "Performance reports", sourceUrl: "https://logistics.amazon.in/", interval: 60 }
  ],
  scc: [
    { code: "work_items_visibility", name: "Work items visibility", sourceUrl: "https://www.amazonlogistics.eu/station/dashboard/workitemsvisibility", interval: 30 },
    { code: "driver_reconciliation", name: "Driver reconciliation", sourceUrl: "https://www.amazonlogistics.eu/station/dashboard/driverreconciliation", interval: 30 },
    { code: "prepared_deposit", name: "Prepared deposit", sourceUrl: "https://www.amazonlogistics.eu/station/dashboard/bankdeposits", interval: 30 }
  ]
};

export type AmazonConnectorRow = {
  auth_mode: string;
  base_url: string;
  id: string;
  is_enabled: boolean;
  last_checked_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  last_success_at: string | null;
  login_url: string;
  mfa_secret_id: string | null;
  notes: string | null;
  password_secret_id: string | null;
  portal_code: AmazonPortalCode;
  portal_name: string;
  status: string;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  timezone: string;
  username: string | null;
};

export type AmazonConnectorTaskRow = {
  connector_id: string;
  id: string;
  is_enabled: boolean;
  last_message: string | null;
  last_run_at: string | null;
  last_status: string;
  next_run_at: string | null;
  source_url: string;
  sync_interval_minutes: number;
  task_code: string;
  task_name: string;
};

export type LoadedAmazonConnector = {
  connector: AmazonConnectorRow | null;
  definition: (typeof amazonPortalDefinitions)[number];
  tasks: AmazonConnectorTaskRow[];
};

export function isAmazonConnectorSetupError(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return message.includes("amazon_connectors") ||
    message.includes("amazon_connector_tasks") ||
    message.includes("could not find") ||
    message.includes("schema cache") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("column") && message.includes("does not exist"));
}

export async function loadAmazonConnectors(companyId: string): Promise<{
  connectors: LoadedAmazonConnector[];
  error: string | null;
}> {
  if (!supabaseAdmin) return { connectors: [], error: "Supabase service role key is not configured." };

  const { data, error } = await supabaseAdmin
    .from("amazon_connectors")
    .select("id, portal_code, portal_name, base_url, login_url, username, password_secret_id, mfa_secret_id, auth_mode, is_enabled, sync_enabled, sync_interval_minutes, timezone, status, last_checked_at, last_success_at, last_error_at, last_error_message, notes")
    .eq("company_id", companyId)
    .order("portal_code", { ascending: true });

  if (error) {
    return {
      connectors: amazonPortalDefinitions.map((definition) => ({ definition, connector: null, tasks: [] })),
      error: error.message
    };
  }

  const connectorRows = (data ?? []) as AmazonConnectorRow[];
  const connectorIds = connectorRows.map((connector) => connector.id);
  let taskRows: AmazonConnectorTaskRow[] = [];

  if (connectorIds.length) {
    const taskResult = await supabaseAdmin
      .from("amazon_connector_tasks")
      .select("id, connector_id, task_code, task_name, source_url, is_enabled, sync_interval_minutes, next_run_at, last_run_at, last_status, last_message")
      .eq("company_id", companyId)
      .in("connector_id", connectorIds)
      .order("task_name", { ascending: true });
    if (taskResult.error) return { connectors: [], error: taskResult.error.message };
    taskRows = (taskResult.data ?? []) as AmazonConnectorTaskRow[];
  }

  return {
    error: null,
    connectors: amazonPortalDefinitions.map((definition) => {
      const connector = connectorRows.find((row) => row.portal_code === definition.code) ?? null;
      return {
        definition,
        connector,
        tasks: connector ? taskRows.filter((row) => row.connector_id === connector.id) : []
      };
    })
  };
}
