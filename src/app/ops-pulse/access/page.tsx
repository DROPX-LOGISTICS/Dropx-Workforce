import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations, locationLabel } from "@/lib/ops-pulse/cod";
import { operatingModeForLocation, operatingModeLabel } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort();
}

export default async function OpsAccessPage() {
  const authorization = await requirePagePermission("users", "access");
  const companyId = requireCompanyId(authorization);
  const [{ locations, error: locationError }, profiles, roles] = await Promise.all([
    loadCodLocations(companyId, [], true),
    supabaseAdmin?.from("profiles").select("id,full_name,email,role,role_id,location_scope_ids,is_active").eq("company_id", companyId).order("full_name"),
    supabaseAdmin?.from("user_roles").select("id,name,location_access_mode").eq("company_id", companyId)
  ]);
  const roleMap = new Map((roles?.data ?? []).map((role) => [role.id, role]));
  const rows = (profiles?.data ?? []).map((profile) => {
    const role = roleMap.get(profile.role_id ?? "");
    const scoped = role?.location_access_mode === "all_locations"
      ? locations
      : locations.filter((location) => (profile.location_scope_ids ?? []).includes(location.id));
    const modes = unique(scoped.map((location) => {
      const mode = operatingModeForLocation(location);
      return mode ? operatingModeLabel(mode) : null;
    }));
    return { profile, role, scoped, modes };
  });

  return (
    <AppShell active="Users & Access" pageCode="users">
      <div className="ops-command-center">
        <PageHead
          eyebrow="OpsPulse Administration"
          title="Users & Operational Access"
          subtitle="Model, hierarchy and station visibility for OpsPulse. General dashboard permissions are not shown here."
          action={<Link className="button secondary" href="/users?section=users">Manage identities & roles</Link>}
        />
        {locationError || profiles?.error || roles?.error ? <section className="panel message-panel error"><div className="panel-body">{locationError ?? profiles?.error?.message ?? roles?.error?.message}</div></section> : null}
        <section className="summary-grid">
          <div className="metric-card"><span>Ops users</span><strong>{rows.filter((row) => row.profile.is_active && row.scoped.length).length}</strong><small>Active users with station scope</small></div>
          <div className="metric-card"><span>All-location roles</span><strong>{rows.filter((row) => row.role?.location_access_mode === "all_locations").length}</strong><small>Control Tower / senior scope</small></div>
          <div className="metric-card"><span>Scoped users</span><strong>{rows.filter((row) => row.role?.location_access_mode !== "all_locations" && row.scoped.length).length}</strong><small>Explicit permitted locations</small></div>
          <div className="metric-card"><span>Unassigned</span><strong>{rows.filter((row) => !row.scoped.length).length}</strong><small>Needs OpsPulse location access</small></div>
        </section>
        <section className="panel">
          <div className="panel-head"><div><h2>OpsPulse scope register</h2><p className="subtle">Every model and hierarchy value below is derived from that user’s permitted stations.</p></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Ops role</th><th>Models</th><th>Region</th><th>AOM</th><th>Cluster Manager</th><th>Cluster</th><th>Locations</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map(({ profile, role, scoped, modes }) => (
                  <tr key={profile.id}>
                    <td><strong>{profile.full_name || profile.email}</strong><br /><span className="subtle">{profile.email}</span></td>
                    <td>{role?.name || profile.role}</td>
                    <td>{modes.join(", ") || "-"}</td>
                    <td>{unique(scoped.map((location) => location.region)).join(", ") || "-"}</td>
                    <td>{unique(scoped.map((location) => location.aom)).join(", ") || "-"}</td>
                    <td>{unique(scoped.map((location) => location.cluster_manager)).join(", ") || "-"}</td>
                    <td>{unique(scoped.map((location) => location.cluster)).join(", ") || "-"}</td>
                    <td title={scoped.map(locationLabel).join(", ")}>{scoped.length} stations</td>
                    <td><span className={`status-pill ${profile.is_active && scoped.length ? "good" : "warn"}`}>{profile.is_active ? scoped.length ? "Active" : "Unassigned" : "Inactive"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
