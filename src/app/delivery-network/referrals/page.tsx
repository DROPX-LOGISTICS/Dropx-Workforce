import { SlidersHorizontal, UserRoundPlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { WorkforceReferralDesk } from "@/components/workforce-referral-desk";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function WorkforceReferralsPage({
  searchParams = {},
}: {
  searchParams?: { area?: string; notice?: string; error?: string };
}) {
  const authorization = await requirePagePermission("delivery_associates", "access");
  const companyId = requireCompanyId(authorization);
  const canEdit = hasPermission(authorization, "delivery_associates", "edit") && !authorization.readOnly;
  const area = searchParams.area === "programs" ? "programs" : "candidates";
  let programs: any[] = [];
  let referrals: any[] = [];
  let stations: Array<{ id: string; station_code: string; station_name: string | null }> = [];
  let sources: Array<{ code: string; name: string; description: string | null }> = [];
  let error = "";

  if (!supabaseAdmin) error = "Workforce connection is unavailable.";
  else {
    const [programResult, referralResult, stationResult, sourceResult] = await Promise.all([
      supabaseAdmin.from("workforce_referral_programs").select("*").eq("company_id", companyId).order("effective_from", { ascending: false }),
      supabaseAdmin.from("workforce_referrals").select("id,referred_full_name,referred_country_code,referred_mobile,status,qualification_progress,qualifying_days_snapshot,reward_amount_snapshot,qualification_source_snapshot,submitted_at,qualified_at,approved_at,paid_at,decision_remarks,preferred_station_id,adjustment_id,referrer:workforce!workforce_referrals_referrer_workforce_id_fkey(full_name,dropx_id),station:stations!workforce_referrals_preferred_station_id_fkey(station_code,station_name),adjustment:workforce_adjustments!workforce_referrals_adjustment_id_fkey(status,payroll_run_id)").eq("company_id", companyId).order("submitted_at", { ascending: false }),
      supabaseAdmin.from("stations").select("id,station_code,station_name").eq("company_id", companyId).eq("is_active", true).order("station_code"),
      supabaseAdmin.from("workforce_referral_qualification_sources").select("code,name,description").eq("company_id", companyId).eq("is_active", true).order("sort_order"),
    ]);
    const dataError = [programResult, referralResult, stationResult, sourceResult].find((result) => result.error)?.error;
    if (dataError) error = dataError.message;
    else {
      programs = (programResult.data ?? []).filter((row) => authorization.hasAllLocationAccess || !row.station_id || authorization.locationScopeIds.includes(row.station_id));
      referrals = (referralResult.data ?? []).filter((row) => authorization.hasAllLocationAccess || !row.preferred_station_id || authorization.locationScopeIds.includes(row.preferred_station_id));
      stations = (stationResult.data ?? []).filter((row) => authorization.hasAllLocationAccess || authorization.locationScopeIds.includes(row.id));
      sources = sourceResult.data ?? [];
    }
  }

  const activePrograms = programs.filter((program) => program.is_active).length;

  return (
    <AppShell active="Referrals" pageCode="delivery_associates">
      <PageHead
        action={area === "candidates" && canEdit ? <PendingLink className="button compact" href="/delivery-network/onboarding/associates"><UserRoundPlus size={15} /> Onboard referred associate</PendingLink> : undefined}
        eyebrow="Refer & earn operations"
        title={area === "candidates" ? "Referral journey" : "Referral program master"}
        subtitle={area === "candidates"
          ? "Update the candidate, onboard them, verify qualifying days and send the earned bonus for approval."
          : "Set the location rule, reward, evidence source and qualifying days used by DropX One."}
      />

      <nav className="wf-journey-nav wf-referral-tabs" aria-label="Referral workspace">
        <PendingLink aria-current={area === "candidates" ? "page" : undefined} href="/delivery-network/referrals?area=candidates">
          Referred candidates<strong>{referrals.length}</strong>
        </PendingLink>
        <PendingLink aria-current={area === "programs" ? "page" : undefined} href="/delivery-network/referrals?area=programs">
          <SlidersHorizontal size={14} /> Program rules<strong>{activePrograms}</strong>
        </PendingLink>
      </nav>

      {error || searchParams.error ? <section className="panel message-panel error"><div className="panel-body"><strong>Referral data is unavailable</strong><p className="subtle">{error || searchParams.error}</p></div></section> : null}
      {searchParams.notice ? <div className="message-panel success">{searchParams.notice}</div> : null}
      <WorkforceReferralDesk area={area} programs={programs} referrals={referrals} stations={stations} sources={sources} canEdit={canEdit} />
    </AppShell>
  );
}
