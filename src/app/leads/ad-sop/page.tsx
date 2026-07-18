import { AppShell } from "@/components/app-shell";
import { LeadsWorkspace } from "@/components/leads-workspace";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadLeadWorkspaceData } from "@/lib/leads-data";
import { cookies } from "next/headers";

function loadFlash() {
  const raw = cookies().get("dropx_leads_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return {
      error: typeof parsed.error === "string" ? parsed.error : null,
      notice: typeof parsed.notice === "string" ? parsed.notice : null
    };
  } catch {
    return { error: null, notice: null };
  }
}

export const dynamic = "force-dynamic";

export default async function LeadAdSopPage() {
  const authorization = await requirePagePermission("leads_sop", "access");
  const pagePermission = authorization.permissions.leads_sop;
  const data = await loadLeadWorkspaceData(requireCompanyId(authorization));
  const flash = loadFlash();
  return (
    <AppShell active="Leads" pageCode="leads_sop">
      <LeadsWorkspace
        canAddSop={pagePermission.canAdd}
        canEditSop={pagePermission.canEdit}
        data={data}
        flash={flash}
        section="sop"
      />
    </AppShell>
  );
}
