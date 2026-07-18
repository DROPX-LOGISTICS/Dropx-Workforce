import { AppShell } from "@/components/app-shell";
import { LeadsWorkspace } from "@/components/leads-workspace";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadLeadWorkspaceData } from "@/lib/leads-data";

export const dynamic = "force-dynamic";

export default async function LeadFollowUpsPage() {
  const authorization = await requirePagePermission("leads_followups", "access");
  const data = await loadLeadWorkspaceData(requireCompanyId(authorization));
  return (
    <AppShell active="Leads" pageCode="leads_followups">
      <LeadsWorkspace data={data} section="followups" />
    </AppShell>
  );
}
