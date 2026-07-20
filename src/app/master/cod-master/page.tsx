import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SearchableSelect } from "@/components/searchable-select";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { codSetupMessage, isMissingCodSetup, loadCodLocations, loadCodStationSettings, locationLabel, type CodStationSettingRow } from "@/lib/ops-pulse/cod";
import { isSupabaseAdminConfigured } from "@/lib/supabase-admin";
import { createCodMaster, deleteCodMaster, updateCodMaster } from "./actions";

function loadFlash() {
  const raw = cookies().get("dropx_cod_master_flash")?.value;
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

function timeText(value: string | null | undefined) {
  return value ? String(value).slice(0, 5) : "";
}

function StationFields({
  canEdit,
  locations,
  row
}: {
  canEdit: boolean;
  locations: Array<{ helper?: string; label: string; value: string }>;
  row?: CodStationSettingRow;
}) {
  return (
    <>
      {row ? <input name="id" type="hidden" value={row.id} /> : null}
      <label className="span-2">Station
        <SearchableSelect
          disabled={!canEdit}
          name="location_id"
          options={locations}
          placeholder="Select station"
          required
          defaultValue={row?.location_id ?? ""}
        />
      </label>
      <label>CMS Agency<input className="field" defaultValue={row?.cms_agency ?? ""} name="cms_agency" placeholder="Radiant, Airtel, etc." required /></label>
      <label>Agent Name<input className="field" defaultValue={row?.agent_name ?? ""} name="agent_name" placeholder="CMS agent name" required /></label>
      <label>Mobile No<input className="field" defaultValue={row?.agent_mobile ?? ""} name="agent_mobile" inputMode="tel" placeholder="Agent mobile no." required /></label>
      <label>COD Deposit Day
        <select className="field" defaultValue={row?.cod_deposit_day ?? "Same Day"} name="cod_deposit_day" required>
          <option>Same Day</option>
          <option>Next Day</option>
        </select>
      </label>
      <label>Pickup Time<input className="field" defaultValue={row?.pickup_time ?? ""} name="pickup_time" placeholder="18:30-19:00 / Morning and evening" required /></label>
      <label>Pickup Start<input className="field" defaultValue={timeText(row?.pickup_window_start)} name="pickup_window_start" type="time" /></label>
      <label>Pickup End<input className="field" defaultValue={timeText(row?.pickup_window_end)} name="pickup_window_end" type="time" /></label>
      <label>COD Due Time<input className="field" defaultValue={timeText(row?.cod_submission_due_time)} name="cod_submission_due_time" type="time" /></label>
      <label>EOD Due Time<input className="field" defaultValue={timeText(row?.eod_submission_due_time)} name="eod_submission_due_time" type="time" /></label>
      <label>Escalation Contact<input className="field" defaultValue={row?.escalation_contact ?? ""} name="escalation_contact" inputMode="tel" placeholder="Escalation mobile" /></label>
      <label>Escalation Email<input className="field" defaultValue={row?.escalation_email ?? ""} name="escalation_email" type="email" placeholder="Escalation email" /></label>
      <div className="span-3 section-divider">
        <strong>Station Command Center checks</strong>
        <span>Station-specific schedule for driver reconciliation and prepared deposit checks. Login credentials and base URLs stay in Settings.</span>
      </div>
      <label>SCC Station Code<input className="field" defaultValue={row?.portal_station_code ?? row?.station_code ?? ""} name="portal_station_code" placeholder="TIRC / JDBD / station portal code" /></label>
      <label>Driver Recon Due<input className="field" defaultValue={timeText(row?.driver_recon_due_time)} name="driver_recon_due_time" type="time" /></label>
      <label>Prepared Deposit Due<input className="field" defaultValue={timeText(row?.prepared_deposit_due_time)} name="prepared_deposit_due_time" type="time" /></label>
      <label>Check Gap Minutes<input className="field" defaultValue={String(row?.portal_check_interval_minutes ?? 30)} name="portal_check_interval_minutes" inputMode="numeric" /></label>
      <label>Portal Checks
        <select className="field" defaultValue={row?.portal_checks_enabled ? "true" : "false"} name="portal_checks_enabled">
          <option value="false">Disabled</option>
          <option value="true">Enabled</option>
        </select>
      </label>
      <label>Status
        <select className="field" defaultValue={row?.is_active === false ? "false" : "true"} name="is_active">
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </label>
    </>
  );
}

export const dynamic = "force-dynamic";

export default async function CodMasterPage() {
  const authorization = await requirePagePermission("cod_master", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.cod_master;
  const flash = loadFlash();
  const [{ locations, error: locationsError }, settingsResult] = await Promise.all([
    loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess),
    loadCodStationSettings(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess)
  ]);
  const setupError = settingsResult.error && isMissingCodSetup({ message: settingsResult.error }) ? settingsResult.error : null;
  const stationOptions = locations.map((location) => ({
    value: location.id,
    label: locationLabel(location),
    helper: [location.state, location.station_manager_email].filter(Boolean).join(" / ")
  }));

  return (
    <AppShell active="COD Master" pageCode="cod_master">
      <PageHead
        eyebrow="Master Data"
        title="COD Master"
        subtitle="Station-wise CMS agency, pickup window, escalation, and due-time setup for COD operations."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />

      {setupError ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Database setup needed</strong><p className="subtle" style={{ marginTop: 6 }}>{codSetupMessage(setupError)}</p></div>
        </section>
      ) : null}

      {!setupError && (locationsError || settingsResult.error) ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Unable to load COD Master</strong><p className="subtle" style={{ marginTop: 6 }}>{locationsError ?? settingsResult.error}</p></div>
        </section>
      ) : null}

      {!setupError && (flash.error || flash.notice) ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body"><strong>{flash.error ? "Action required" : "Completed"}</strong><p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p></div>
        </section>
      ) : null}

      {!setupError ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Add COD station setup</h2>
                <p className="subtle">One station can have one active COD setup. This controls due reminders and submission routing.</p>
              </div>
            </div>
            <div className="panel-body">
              <form action={createCodMaster} className="form-grid three">
                <StationFields canEdit={permission.canAdd} locations={stationOptions} />
                <div className="form-actions span-3 align-right">
                  <SubmitButton disabled={!permission.canAdd}>Save COD Master</SubmitButton>
                </div>
              </form>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head toolbar">
              <div>
                <h2>COD station register</h2>
                <p className="subtle">{settingsResult.rows.length} configured stations</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Station Code</th>
                    <th>State</th>
                    <th>CMS Agency</th>
                    <th>Agent</th>
                    <th>Mobile No</th>
                    <th>Deposit Day</th>
                    <th>Pickup Time</th>
                    <th>COD Due</th>
                    <th>EOD Due</th>
                    <th>Portal Checks</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {settingsResult.rows.length ? settingsResult.rows.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.station_code ?? "-"}</strong></td>
                      <td>{row.state ?? "-"}</td>
                      <td>{row.cms_agency ?? "-"}</td>
                      <td>{row.agent_name ?? "-"}</td>
                      <td>{row.agent_mobile ?? "-"}</td>
                      <td>{row.cod_deposit_day}</td>
                      <td>{row.pickup_time ?? "-"}</td>
                      <td>{timeText(row.cod_submission_due_time) || "-"}</td>
                      <td>{timeText(row.eod_submission_due_time) || "-"}</td>
                      <td>
                        <StatusPill status={row.portal_checks_enabled ? "Enabled" : "Disabled"} />
                        <div className="subtle">{row.portal_station_code ?? row.station_code ?? "-"}</div>
                      </td>
                      <td><StatusPill status={row.is_active ? "Active" : "Inactive"} /></td>
                      <td>
                        <details className="row-details">
                          <summary className="button secondary compact">Edit</summary>
                          <div className="inline-edit-panel">
                            <form action={updateCodMaster} className="form-grid three">
                              <StationFields canEdit={permission.canEdit} locations={stationOptions} row={row} />
                              <div className="form-actions span-3 align-right">
                                <SubmitButton className="button compact" disabled={!permission.canEdit}>Save changes</SubmitButton>
                              </div>
                            </form>
                            <form action={deleteCodMaster} className="form-actions align-right">
                              <input name="id" type="hidden" value={row.id} />
                              <SubmitButton className="button danger compact" disabled={!permission.canEdit}>Remove</SubmitButton>
                            </form>
                          </div>
                        </details>
                      </td>
                    </tr>
                  )) : (
                    <tr><td className="empty-cell" colSpan={12}>No COD station setup added yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
