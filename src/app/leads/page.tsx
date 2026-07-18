import { AppShell } from "@/components/app-shell";
import { LeadsWorkspace } from "@/components/leads-workspace";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadLeadWorkspaceData } from "@/lib/leads-data";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const authorization = await requirePagePermission("leads_dashboard", "access");
  const companyId = requireCompanyId(authorization);
  const data = await loadLeadWorkspaceData(companyId);
  return (
    <AppShell active="Leads" pageCode="leads_dashboard">
      <LeadsWorkspace data={data} section="dashboard" />
    </AppShell>
  );
}
