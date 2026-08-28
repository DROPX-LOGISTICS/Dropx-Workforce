import { ArrowRight, BadgeCheck, CirclePause, CircleStop, Plus, WalletCards } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { SubmitButton } from "@/components/submit-button";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { workforceToday } from "@/lib/workforce-earnings";
import { changeRateCardStatus, saveRateCard } from "./actions";

export const dynamic = "force-dynamic";

type RateCardRow = {
  id: string; name: string; provider_id: string; station_id: string | null; designation_id: string | null;
  pay_type: string; effective_from: string; effective_to: string | null; delivery_rate: number; return_rate: number;
  mfn_rate: number; mfn_return_rate: number; fuel_rate: number; fixed_amount: number; guarantee_amount: number;
  status: string; notes: string | null; approved_at: string | null;
};

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function WorkforceRateCardsPage({ searchParams }: { searchParams?: { add?: string; edit?: string; notice?: string; error?: string } }) {
  const authorization = await requirePagePermission("workforce_rate_cards", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.workforce_rate_cards;
  const canAdd = permission.canAdd && !authorization.readOnly;
  let cards: RateCardRow[] = [];
  let providers: Array<{ id: string; name: string; code: string }> = [];
  let stations: Array<{ id: string; station_code: string; station_name: string | null }> = [];
  let designations: Array<{ id: string; code: string; name: string; designation_category?: unknown }> = [];
  let error: string | null = null;

  if (!supabaseAdmin) error = "Supabase service role key is not configured.";
  else {
    const [cardResult, providerResult, stationResult, designationResult] = await Promise.all([
      supabaseAdmin.from("workforce_rate_cards").select("id, name, provider_id, station_id, designation_id, pay_type, effective_from, effective_to, delivery_rate, return_rate, mfn_rate, mfn_return_rate, fuel_rate, fixed_amount, guarantee_amount, status, notes, approved_at").eq("company_id", companyId).order("effective_from", { ascending: false }),
      supabaseAdmin.from("providers").select("id, name, code").eq("company_id", companyId).order("name"),
      supabaseAdmin.from("stations").select("id, station_code, station_name").eq("company_id", companyId).eq("is_active", true).order("station_code"),
      supabaseAdmin.from("designations").select("id, code, name, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active)").eq("company_id", companyId).eq("is_active", true).order("name")
    ]);
    error = cardResult.error?.message ?? providerResult.error?.message ?? stationResult.error?.message ?? designationResult.error?.message ?? null;
    cards = (cardResult.data ?? []) as RateCardRow[];
    providers = providerResult.data ?? [];
    stations = authorization.hasAllLocationAccess ? stationResult.data ?? [] : (stationResult.data ?? []).filter((station) => authorization.locationScopeIds.includes(station.id));
    designations = (designationResult.data ?? []).filter((designation) => firstDesignationBusinessCategory(designation.designation_category)?.people_module === "delivery_network");
  }
  if (!authorization.hasAllLocationAccess) cards = cards.filter((card) => !card.station_id || authorization.locationScopeIds.includes(card.station_id));
  const editing = cards.find((card) => card.id === searchParams?.edit && card.status === "draft") ?? null;
  const canEditSelected = Boolean(editing && permission.canEdit && !authorization.readOnly && (authorization.hasAllLocationAccess || (editing.station_id && authorization.locationScopeIds.includes(editing.station_id))));
  const showForm = Boolean(searchParams?.add || editing);
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const designationById = new Map(designations.map((designation) => [designation.id, designation]));

  return (
    <AppShell active="Rate Cards" pageCode="workforce_rate_cards">
      <section className="wf-finance-hero compact">
        <div><span>Commercial policy</span><h1>Date-effective rate cards</h1><p>Control provider, station and designation rates without rewriting historical earnings. Active versions are immutable.</p></div>
        <div className="wf-finance-actions">{hasPermission(authorization, "payment_methods", "access") ? <PendingLink className="wf-command-secondary" href="/master/payment-methods">Payment methods</PendingLink> : null}{canAdd ? <PendingLink className="wf-command-primary" href="/delivery-network/rate-cards?add=1"><Plus size={16} /> New rate card</PendingLink> : null}</div>
      </section>

      {searchParams?.notice || searchParams?.error ? <section className={`panel message-panel ${searchParams.error ? "error" : "success"}`}><div className="panel-body"><strong>{searchParams.error ? "Action required" : "Completed"}</strong><p>{searchParams.error ?? searchParams.notice}</p></div></section> : null}
      {error ? <section className="panel message-panel error"><div className="panel-body"><strong>Rate card storage is not ready</strong><p>{error}</p></div></section> : null}

      <section className="wf-finance-kpis mini">
        <article><span><WalletCards size={18} /></span><small>All versions</small><strong>{cards.length}</strong><em>Draft and historical</em></article>
        <article><span><BadgeCheck size={18} /></span><small>Active</small><strong>{cards.filter((card) => card.status === "active").length}</strong><em>Used in live earnings</em></article>
        <article><span><CirclePause size={18} /></span><small>Draft / paused</small><strong>{cards.filter((card) => ["draft", "paused"].includes(card.status)).length}</strong><em>Not used for accrual</em></article>
      </section>

      <section className="wf-finance-panel">
        <header><div><span>Rate registry</span><h2>Versioned commercial rules</h2><p>The most specific active match wins: provider + station + designation, then station, then provider default.</p></div>{hasPermission(authorization, "workforce_earnings", "access") ? <PendingLink href="/delivery-network/earnings">See live impact <ArrowRight size={14} /></PendingLink> : null}</header>
        <div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Rate card</th><th>Scope</th><th>Payment type</th><th>Effective period</th><th>Delivery / activity</th><th>Return</th><th>Fixed / guarantee</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {cards.map((card) => { const canManage = permission.canEdit && !authorization.readOnly && (authorization.hasAllLocationAccess || Boolean(card.station_id && authorization.locationScopeIds.includes(card.station_id))); return <tr key={card.id}>
            <td><strong>{card.name}</strong><small>{card.notes ?? "No notes"}</small></td>
            <td>{providerById.get(card.provider_id)?.name ?? "Provider"}<small>{card.station_id ? stationById.get(card.station_id)?.station_code ?? "Scoped station" : "All stations"} · {card.designation_id ? designationById.get(card.designation_id)?.name ?? "Scoped designation" : "All designations"}</small></td>
            <td>{label(card.pay_type)}</td><td>{card.effective_from}<small>to {card.effective_to ?? "ongoing"}</small></td>
            <td>{money(card.delivery_rate)}<small>Fuel {money(card.fuel_rate)}</small></td><td>{money(card.return_rate)}<small>MFN {money(card.mfn_rate)} / {money(card.mfn_return_rate)}</small></td><td>{money(card.fixed_amount)}<small>Guarantee {money(card.guarantee_amount)}</small></td>
            <td><span className={`wf-pay-state ${card.status}`}>{card.status}</span></td>
            <td><div className="wf-row-actions">
              {card.status === "draft" && canManage ? <PendingLink href={`/delivery-network/rate-cards?edit=${card.id}`}>Edit</PendingLink> : null}
              {canManage && card.status !== "closed" ? <form action={changeRateCardStatus}><input name="id" type="hidden" value={card.id} /><input name="status" type="hidden" value={card.status === "active" ? "paused" : "active"} /><SubmitButton pendingText="Saving">{card.status === "active" ? "Pause" : "Activate"}</SubmitButton></form> : null}
              {canManage && card.status !== "closed" ? <form action={changeRateCardStatus}><input name="id" type="hidden" value={card.id} /><input name="status" type="hidden" value="closed" /><SubmitButton confirmationBlocked={false} confirmMessage="Close this rate-card version? Historical earnings remain unchanged." pendingText="Closing"><CircleStop size={13} /> Close</SubmitButton></form> : null}
            </div></td>
          </tr>; })}
          {!cards.length && !error ? <tr><td className="empty-cell" colSpan={9}>No rate card versions yet. Existing mapped/imported rates continue to calculate live earnings.</td></tr> : null}
        </tbody></table></div>
      </section>

      {showForm && (editing ? canEditSelected : canAdd) ? <div className="modal-backdrop"><section className="modal-panel wide wf-finance-modal" aria-label="Rate card form">
        <header><div><span>Commercial version</span><h2>{editing ? "Edit draft rate card" : "Create draft rate card"}</h2><p>Activate only after the effective scope and amounts are reviewed.</p></div><PendingLink aria-label="Close" href="/delivery-network/rate-cards">×</PendingLink></header>
        <form action={saveRateCard} className="wf-finance-form">
          <input name="id" type="hidden" value={editing?.id ?? ""} />
          <label className="span-2">Rate card name<input defaultValue={editing?.name ?? ""} name="name" placeholder="Amazon ERSE DA · Sep 2026" required /></label>
          <label>Provider<select defaultValue={editing?.provider_id ?? ""} name="provider_id" required><option value="">Choose provider</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.code} · {provider.name}</option>)}</select></label>
          <label>Station scope<select defaultValue={editing?.station_id ?? ""} name="station_id" required={!authorization.hasAllLocationAccess}>{authorization.hasAllLocationAccess ? <option value="">All stations</option> : <option value="">Choose station</option>}{stations.map((station) => <option key={station.id} value={station.id}>{station.station_code} · {station.station_name}</option>)}</select></label>
          <label>Designation scope<select defaultValue={editing?.designation_id ?? ""} name="designation_id"><option value="">All Workforce designations</option>{designations.map((designation) => <option key={designation.id} value={designation.id}>{designation.code} · {designation.name}</option>)}</select></label>
          <label>Payment type<select defaultValue={editing?.pay_type ?? "per_shipment"} name="pay_type"><option value="per_shipment">Per shipment</option><option value="per_activity">Per activity</option><option value="hybrid">Variable with daily guarantee</option><option value="fixed_daily">Fixed daily</option><option value="fixed_monthly">Fixed monthly accrual</option></select></label>
          <label>Effective from<input defaultValue={editing?.effective_from ?? workforceToday()} name="effective_from" required type="date" /></label>
          <label>Effective to<input defaultValue={editing?.effective_to ?? ""} name="effective_to" type="date" /></label>
          <label>Delivery / activity rate<input defaultValue={editing?.delivery_rate ?? 0} min="0" name="delivery_rate" step="0.01" type="number" /></label>
          <label>Customer return rate<input defaultValue={editing?.return_rate ?? 0} min="0" name="return_rate" step="0.01" type="number" /></label>
          <label>MFN rate<input defaultValue={editing?.mfn_rate ?? 0} min="0" name="mfn_rate" step="0.01" type="number" /></label>
          <label>MFN return rate<input defaultValue={editing?.mfn_return_rate ?? 0} min="0" name="mfn_return_rate" step="0.01" type="number" /></label>
          <label>Fuel per delivery<input defaultValue={editing?.fuel_rate ?? 0} min="0" name="fuel_rate" step="0.01" type="number" /></label>
          <label>Fixed amount<input defaultValue={editing?.fixed_amount ?? 0} min="0" name="fixed_amount" step="0.01" type="number" /></label>
          <label>Daily guarantee<input defaultValue={editing?.guarantee_amount ?? 0} min="0" name="guarantee_amount" step="0.01" type="number" /></label>
          <label className="span-2">Commercial notes<textarea defaultValue={editing?.notes ?? ""} name="notes" placeholder="Approval context, client rate reference, revision reason" rows={3} /></label>
          <div className="wf-form-actions span-2"><PendingLink href="/delivery-network/rate-cards">Cancel</PendingLink><SubmitButton pendingText="Saving draft">{editing ? "Save draft changes" : "Create draft"}</SubmitButton></div>
        </form>
      </section></div> : null}
    </AppShell>
  );
}
