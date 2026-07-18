import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { DesignationForm } from "@/components/designation-form";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { createDesignation, deleteDesignation, updateDesignation } from "./actions";

type ProviderRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type LocationRow = {
  id: string;
  station_code: string;
  station_name: string | null;
  hide_from_location_list?: boolean | null;
};

type DesignationRow = {
  id: string;
  code: string;
  name: string;
  provider_ids: string[];
  location_ids: string[];
  is_active: boolean;
};

function loadFlash() {
  const raw = cookies().get("dropx_designation_flash")?.value;
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

function isMissingColumnError(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return message.includes("column") && (message.includes("does not exist") || message.includes("schema cache"));
}

async function loadDesignations(companyId: string, locationScopeIds: string[], hasAllLocationAccess: boolean) {
  if (!supabaseAdmin) {
    return {
      designations: [] as DesignationRow[],
      providers: [] as ProviderRow[],
      locations: [] as LocationRow[],
      error: "Supabase service role key is not configured."
    };
  }

  const [designationsResult, providersResult, locationsResult] = await Promise.all([
    supabaseAdmin.from("designations").select("id, code, name, provider_ids, location_ids, is_active").eq("company_id", companyId).order("code"),
    supabaseAdmin.from("providers").select("id, code, name, is_active").eq("company_id", companyId).order("code"),
    supabaseAdmin.from("stations").select("id, station_code, station_name, hide_from_location_list").eq("company_id", companyId).eq("is_active", true).order("station_code")
  ]);
  let designationRows = designationsResult.data ?? [];
  let designationError = designationsResult.error;
  if (isMissingColumnError(designationsResult.error)) {
    const fallbackResult = await supabaseAdmin.from("designations").select("id, code, name, provider_ids, is_active").eq("company_id", companyId).order("code");
    designationRows = (fallbackResult.data ?? []).map((row) => ({ ...row, location_ids: [] }));
    designationError = fallbackResult.error;
  }

  if (designationError) {
    return {
      designations: [] as DesignationRow[],
      providers: [] as ProviderRow[],
      locations: [] as LocationRow[],
      error: designationError.message
    };
  }
  if (providersResult.error) {
    return {
      designations: [] as DesignationRow[],
      providers: [] as ProviderRow[],
      locations: [] as LocationRow[],
      error: providersResult.error.message
    };
  }
  if (locationsResult.error) {
    return {
      designations: [] as DesignationRow[],
      providers: [] as ProviderRow[],
      locations: [] as LocationRow[],
      error: locationsResult.error.message
    };
  }

  const locations = hasAllLocationAccess
    ? (locationsResult.data ?? [])
    : (locationsResult.data ?? []).filter((location) => locationScopeIds.includes(location.id) && !location.hide_from_location_list);

  return {
    designations: designationRows as DesignationRow[],
    providers: (providersResult.data ?? []) as ProviderRow[],
    locations: locations as LocationRow[],
    error: null
  };
}

export const dynamic = "force-dynamic";

export default async function DesignationsPage({
  searchParams
}: {
  searchParams?: { add?: string; edit?: string; q?: string };
}) {
  const authorization = await requirePagePermission("designations", "access");
  const companyId = requireCompanyId(authorization);
  const pagePermission = authorization.permissions.designations;
  const { designations, providers, locations, error } = await loadDesignations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const flash = loadFlash();
  const query = String(searchParams?.q ?? "").trim().toLowerCase();
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const filteredDesignations = designations.filter((designation) => {
    const providerText = designation.provider_ids
      .map((providerId) => providerById.get(providerId))
      .filter(Boolean)
      .map((provider) => `${provider?.code} ${provider?.name}`)
      .join(" ");
    const locationText = designation.location_ids
      .map((locationId) => locationById.get(locationId))
      .filter(Boolean)
      .map((location) => `${location?.station_code} ${location?.station_name ?? ""}`)
      .join(" ");
    return `${designation.code} ${designation.name} ${providerText} ${locationText}`.toLowerCase().includes(query);
  });
  const editDesignation = designations.find((designation) => designation.id === searchParams?.edit) ?? null;

  return (
    <AppShell active="Designations" pageCode="designations">
      <PageHead
        eyebrow="Master Data"
        title="Designations"
        subtitle="Maintain role/designation codes used in lead ad SOP and station-wise hiring ads."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {error} Run `scripts/designations_v1.sql` in Supabase SQL Editor, then refresh this page.
            </p>
          </div>
        </section>
      ) : null}

      {!error && (flash.error || flash.notice) ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{flash.error ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p>
          </div>
        </section>
      ) : null}

      {!error ? (
        <section className="panel">
          <div className="panel-head toolbar">
            <div>
              <h2>Designation list</h2>
              <p className="subtle">{filteredDesignations.length} of {designations.length} records</p>
            </div>
            <div className="master-toolbar">
              <form className="inline-search" action="/master/designations">
                <input className="field" defaultValue={searchParams?.q ?? ""} name="q" placeholder="Search designation or location" />
                <button className="button secondary compact" type="submit">Search</button>
                {query ? <PendingLink className="button secondary compact" href="/master/designations">Clear</PendingLink> : null}
              </form>
              {pagePermission.canAdd ? <PendingLink className="button compact" href="/master/designations?add=1" scroll={false}>Add designation</PendingLink> : null}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Designation</th>
                  <th>Locations</th>
                  <th>Status</th>
                  {pagePermission.canEdit ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredDesignations.length ? filteredDesignations.map((designation) => {
                  const designationLocations = designation.location_ids
                    .map((locationId) => locationById.get(locationId))
                    .filter(Boolean) as LocationRow[];
                  return (
                    <tr key={designation.id}>
                      <td><strong>{designation.code}</strong></td>
                      <td>{designation.name}</td>
                      <td>
                        {designationLocations.length ? (
                          <div className="mini-chip-list">
                            {designationLocations.slice(0, 3).map((location) => <span className="mini-tag" key={location.id}>{location.station_code}</span>)}
                            {designationLocations.length > 3 ? <span className="mini-tag">+{designationLocations.length - 3}</span> : null}
                          </div>
                        ) : <span className="subtle">-</span>}
                      </td>
                      <td><StatusPill status={designation.is_active ? "Active" : "Inactive"} /></td>
                      {pagePermission.canEdit ? <td><PendingLink className="button secondary compact" href={`/master/designations?edit=${designation.id}`} scroll={false}>Edit</PendingLink></td> : null}
                    </tr>
                  );
                }) : (
                  <tr><td className="empty-cell" colSpan={pagePermission.canEdit ? 5 : 4}>No designations found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!error && searchParams?.add === "1" && pagePermission.canAdd ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide">
            <div className="panel-head">
              <div>
                <h2>Add designation</h2>
                <p className="subtle">Select one or more locations where this designation applies.</p>
              </div>
              <PendingLink className="icon-button" href="/master/designations" scroll={false} aria-label="Close">x</PendingLink>
            </div>
            <DesignationForm action={createDesignation} locations={locations} />
          </section>
        </div>
      ) : null}

      {!error && editDesignation && pagePermission.canEdit ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide">
            <div className="panel-head">
              <div>
                <h2>Edit designation</h2>
                <p className="subtle">Code and location assignment can be changed without affecting old rows.</p>
              </div>
              <PendingLink className="icon-button" href="/master/designations" scroll={false} aria-label="Close">x</PendingLink>
            </div>
            <DesignationForm action={updateDesignation} initial={editDesignation} locations={locations} submitLabel="Save changes" />
            <form action={deleteDesignation} className="danger-form">
              <input name="id" type="hidden" value={editDesignation.id} />
              <SubmitButton
                className="button warning"
                confirmMessage="Delete this designation?"
                confirmSubmitText="Delete"
                pendingText="Deleting"
              >
                Delete designation
              </SubmitButton>
            </form>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
