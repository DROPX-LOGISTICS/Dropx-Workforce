import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readAllRows } from "@/lib/supabase-pagination";
import {
  deleteCatalogStation,
  deleteSupervisor,
  saveAmazonStation,
  saveCatalogStation,
  saveSupervisor,
} from "./actions";
import styles from "../joining/page.module.css";

export const dynamic = "force-dynamic";

type AmazonStationSettings = {
  station_id: string;
  service_area_code: string;
  amazon_service_area_id: string | null;
  service_type: string;
  supervisor_alias: string;
  contract_type: string;
  associate_email_pattern: string | null;
  invitation_enabled: boolean;
  version: number;
  updated_at: string;
};

type CatalogRow = {
  id: string;
  station_code: string;
  display_name: string | null;
  notes: string | null;
  station_id: string | null;
  is_active: boolean;
  sort_order: number;
};

type SupervisorRow = {
  id: string;
  supervisor_alias: string;
  display_name: string | null;
  is_active: boolean;
};

export default async function AmazonSettings({
  searchParams: params = {},
}: {
  searchParams?: {
    station?: string;
    supervisor?: string;
    catalog?: string;
    tab?: string;
    notice?: string;
    error?: string;
  };
}) {
  const auth = await requirePagePermission("executive_id_onboarding", "access");
  const company = requireCompanyId(auth);
  if (!supabaseAdmin) {
    return (
      <AppShell active="Amazon Station Defaults" pageCode="executive_id_onboarding">
        <p>Database is unavailable.</p>
      </AppShell>
    );
  }

  const tab = ["catalog", "supervisors", "stations"].includes(params.tab || "")
    ? (params.tab as "catalog" | "supervisors" | "stations")
    : "catalog";

  let opsQuery = supabaseAdmin
    .from("stations")
    .select("id,station_code,station_name")
    .eq("company_id", company)
    .order("station_code");
  if (!auth.hasAllLocationAccess) {
    opsQuery = opsQuery.in(
      "id",
      auth.locationScopeIds.length ? auth.locationScopeIds : ["00000000-0000-0000-0000-000000000000"],
    );
  }

  const [stationsResult, settingsResult, areasResult, catalogResult, supervisorsResult, mapResult, defaultSupervisor] =
    await Promise.all([
      readAllRows(opsQuery),
      readAllRows(
        supabaseAdmin
          .from("workforce_amazon_station_settings")
          .select(
            "station_id,service_area_code,amazon_service_area_id,service_type,supervisor_alias,contract_type,associate_email_pattern,invitation_enabled,version,updated_at",
          )
          .eq("company_id", company)
          .order("station_id"),
      ),
      readAllRows(
        supabaseAdmin
          .from("workforce_amazon_service_areas")
          .select("service_area_id,service_area_name,station_code,station_state")
          .eq("company_id", company)
          .order("station_code"),
      ),
      readAllRows(
        supabaseAdmin
          .from("workforce_amazon_station_catalog")
          .select("id,station_code,display_name,notes,station_id,is_active,sort_order")
          .eq("company_id", company)
          .order("sort_order")
          .order("station_code"),
      ),
      readAllRows(
        supabaseAdmin
          .from("workforce_amazon_supervisors")
          .select("id,supervisor_alias,display_name,is_active")
          .eq("company_id", company)
          .order("supervisor_alias"),
      ),
      readAllRows(
        supabaseAdmin
          .from("workforce_amazon_supervisor_stations")
          .select("supervisor_id,station_code")
          .eq("company_id", company)
          .order("station_code"),
      ),
      supabaseAdmin.from("workforce_amazon_supervisor_defaults").select("supervisor_alias").eq("company_id", company).maybeSingle(),
    ]);

  const opsStations = stationsResult.data ?? [];
  const settings = (settingsResult.data ?? []) as AmazonStationSettings[];
  const areas = areasResult.data ?? [];
  const catalog = (catalogResult.data ?? []) as CatalogRow[];
  const supervisors = (supervisorsResult.data ?? []) as SupervisorRow[];
  const maps = mapResult.data ?? [];
  const supervisorDefault = defaultSupervisor.data?.supervisor_alias || "anbaba";

  const stationsByCode = new Map(opsStations.map((s) => [String(s.station_code).toUpperCase(), s]));
  const codesForSupervisor = (supervisorId: string) =>
    maps.filter((m) => m.supervisor_id === supervisorId).map((m) => String(m.station_code));

  const station = opsStations.find((row) => row.id === params.station) ?? opsStations[0];
  const current = settings.find((row) => row.station_id === station?.id);
  const selectedSupervisor =
    supervisors.find((row) => row.id === params.supervisor) ?? supervisors[0] ?? null;
  const selectedCatalog = catalog.find((row) => row.id === params.catalog) ?? null;
  const selectedCodes = selectedSupervisor ? new Set(codesForSupervisor(selectedSupervisor.id)) : new Set<string>();

  const canEdit = hasPermission(auth, "executive_id_onboarding", "edit") && !auth.readOnly;
  const error =
    stationsResult.error?.message ||
    settingsResult.error?.message ||
    areasResult.error?.message ||
    catalogResult.error?.message ||
    supervisorsResult.error?.message ||
    mapResult.error?.message ||
    params.error;

  const matchedCount = catalog.filter((row) => row.station_id || stationsByCode.has(row.station_code)).length;
  const missingInOps = catalog.filter((row) => !row.station_id && !stationsByCode.has(row.station_code));

  return (
    <AppShell active="Amazon Station Defaults" pageCode="executive_id_onboarding">
      <div className={styles.desk}>
        <PageHead
          eyebrow="Workforce configuration"
          title="Amazon activation master"
          subtitle="Editable station catalog and multi-station supervisors. Synced against Ops / Workforce stations — nothing hardcoded in the worker."
          action={
            <div className="component-chip-list">
              <Link href="/delivery-network/amazon-lifecycle" className="button secondary compact">
                Amazon lifecycle
              </Link>
              <Link href="/delivery-network/id-onboarding" className="button secondary compact">
                Activation desk
              </Link>
            </div>
          }
        />

        {error || params.notice ? (
          <div role="status" className={`${styles.message} ${error ? styles.error : ""}`}>
            {error || params.notice}
          </div>
        ) : null}

        <section className="performance-summary-grid" style={{ marginBottom: 16 }}>
          <article>
            <span>Catalog stations</span>
            <strong>{catalog.length}</strong>
            <small>Editable Amazon network list</small>
          </article>
          <article>
            <span>Matched in Ops</span>
            <strong>{matchedCount}</strong>
            <small>Found in DropX stations table</small>
          </article>
          <article>
            <span>Supervisors</span>
            <strong>{supervisors.length}</strong>
            <small>Default {supervisorDefault}</small>
          </article>
          <article>
            <span>Missing in Ops</span>
            <strong>{missingInOps.length}</strong>
            <small>Catalog only — still usable</small>
          </article>
        </section>

        <div className="component-chip-list" style={{ marginBottom: 16 }}>
          <Link className={`button secondary compact ${tab === "catalog" ? "active" : ""}`} href="?tab=catalog">
            Station catalog
          </Link>
          <Link className={`button secondary compact ${tab === "supervisors" ? "active" : ""}`} href="?tab=supervisors">
            Supervisors
          </Link>
          <Link className={`button secondary compact ${tab === "stations" ? "active" : ""}`} href="?tab=stations">
            Invite settings
          </Link>
        </div>

        {tab === "catalog" ? (
          <div className={styles.layout}>
            <section className={styles.queue}>
              <header>
                <strong>Catalog</strong>
                <small>{catalog.length} codes</small>
              </header>
              {catalog.map((row) => {
                const ops = stationsByCode.get(row.station_code);
                return (
                  <Link
                    key={row.id}
                    className={`${styles.person} ${row.id === selectedCatalog?.id ? styles.current : ""}`}
                    href={`?tab=catalog&catalog=${row.id}`}
                  >
                    <strong>
                      {row.station_code}
                      {row.notes ? ` (${row.notes})` : ""}
                    </strong>
                    <span>
                      {row.display_name || ops?.station_name || "—"} ·{" "}
                      {row.station_id || ops ? "Matched in Ops" : "Not in Ops stations"}
                      {!row.is_active ? " · inactive" : ""}
                    </span>
                  </Link>
                );
              })}
              {!catalog.length ? <p className={styles.empty}>No catalog rows. Add a station or run the migration seed.</p> : null}
            </section>

            <div className={styles.detail}>
              <section className={styles.card}>
                <header>
                  <div>
                    <h2>{selectedCatalog ? `Edit ${selectedCatalog.station_code}` : "Add station"}</h2>
                    <p>Codes should match Amazon service areas and Ops station codes when available. You can add, edit, or delete anytime.</p>
                  </div>
                </header>
                <form className={styles.plan} action={saveCatalogStation} key={selectedCatalog?.id || "new"}>
                  {selectedCatalog ? <input type="hidden" name="catalog_id" value={selectedCatalog.id} /> : null}
                  <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
                    <div className={styles.fields}>
                      <label>
                        Station code
                        <input
                          name="station_code"
                          required
                          maxLength={24}
                          defaultValue={selectedCatalog?.station_code ?? ""}
                          placeholder="e.g. KOZA"
                        />
                      </label>
                      <label>
                        Display name
                        <input
                          name="display_name"
                          maxLength={120}
                          defaultValue={selectedCatalog?.display_name ?? ""}
                          placeholder="Optional Ops name"
                        />
                      </label>
                      <label>
                        Notes
                        <input name="notes" maxLength={80} defaultValue={selectedCatalog?.notes ?? ""} placeholder="e.g. XPT" />
                      </label>
                      <label>
                        Sort order
                        <input name="sort_order" type="number" defaultValue={selectedCatalog?.sort_order ?? 100} />
                      </label>
                      {selectedCatalog ? (
                        <label className="checkbox-row">
                          <input name="is_active" type="checkbox" defaultChecked={selectedCatalog.is_active} /> Active
                        </label>
                      ) : null}
                    </div>
                    <div className={styles.save}>
                      <SubmitButton pendingText="Saving…">{selectedCatalog ? "Save station" : "Add station"}</SubmitButton>
                      <Link className="button secondary compact" href="?tab=catalog">
                        New
                      </Link>
                    </div>
                  </fieldset>
                </form>
                {selectedCatalog && canEdit ? (
                  <form className={styles.plan} action={deleteCatalogStation}>
                    <input type="hidden" name="catalog_id" value={selectedCatalog.id} />
                    <SubmitButton className="button secondary" pendingText="Deleting…">
                      Delete from catalog
                    </SubmitButton>
                  </form>
                ) : null}
              </section>
            </div>
          </div>
        ) : null}

        {tab === "supervisors" ? (
          <div className={styles.layout}>
            <section className={styles.queue}>
              <header>
                <strong>Supervisors</strong>
                <small>{supervisors.length}</small>
              </header>
              {supervisors.map((row) => (
                <Link
                  key={row.id}
                  className={`${styles.person} ${row.id === selectedSupervisor?.id ? styles.current : ""}`}
                  href={`?tab=supervisors&supervisor=${row.id}`}
                >
                  <strong>{row.supervisor_alias}</strong>
                  <span>
                    {codesForSupervisor(row.id).length} stations · {row.display_name || "No label"}
                    {!row.is_active ? " · inactive" : ""}
                  </span>
                </Link>
              ))}
              <div style={{ padding: 12 }}>
                <Link className="button secondary compact" href="?tab=supervisors">
                  Add supervisor
                </Link>
              </div>
            </section>

            <div className={styles.detail}>
              <section className={styles.card}>
                <header>
                  <div>
                    <h2>{selectedSupervisor ? `Edit ${selectedSupervisor.supervisor_alias}` : "Add supervisor"}</h2>
                    <p>One supervisor badge login can cover many stations. Tick every station this alias owns.</p>
                  </div>
                </header>
                <form className={styles.plan} action={saveSupervisor} key={selectedSupervisor?.id || "new-sup"}>
                  {selectedSupervisor ? <input type="hidden" name="supervisor_id" value={selectedSupervisor.id} /> : null}
                  <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
                    <div className={styles.fields}>
                      <label>
                        Supervisor alias
                        <input
                          name="supervisor_alias"
                          required
                          maxLength={80}
                          defaultValue={selectedSupervisor?.supervisor_alias ?? supervisorDefault}
                          placeholder="Without @amazon.com"
                        />
                      </label>
                      <label>
                        Display name
                        <input
                          name="display_name"
                          maxLength={120}
                          defaultValue={selectedSupervisor?.display_name ?? ""}
                          placeholder="Optional"
                        />
                      </label>
                      {selectedSupervisor ? (
                        <label className="checkbox-row">
                          <input name="is_active" type="checkbox" defaultChecked={selectedSupervisor.is_active} /> Active
                        </label>
                      ) : null}
                    </div>
                    <h4>Stations covered</h4>
                    <div className={styles.fields} style={{ maxHeight: 360, overflow: "auto" }}>
                      {(catalog.length ? catalog : opsStations.map((s) => ({
                        id: s.id,
                        station_code: String(s.station_code),
                        display_name: s.station_name,
                        notes: null,
                        station_id: s.id,
                        is_active: true,
                        sort_order: 0,
                      }))).map((row) => (
                        <label key={row.station_code} className="checkbox-row">
                          <input
                            type="checkbox"
                            name="station_codes"
                            value={row.station_code}
                            defaultChecked={selectedCodes.has(row.station_code)}
                          />
                          <span>
                            <strong>{row.station_code}</strong>
                            {row.notes ? ` (${row.notes})` : ""} — {row.display_name || "—"}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className={styles.save}>
                      <SubmitButton pendingText="Saving…">Save supervisor</SubmitButton>
                    </div>
                  </fieldset>
                </form>
                {selectedSupervisor && canEdit ? (
                  <form className={styles.plan} action={deleteSupervisor}>
                    <input type="hidden" name="supervisor_id" value={selectedSupervisor.id} />
                    <SubmitButton className="button secondary" pendingText="Deleting…">
                      Delete supervisor
                    </SubmitButton>
                  </form>
                ) : null}
              </section>
            </div>
          </div>
        ) : null}

        {tab === "stations" ? (
          <div className={styles.layout}>
            <section className={styles.queue}>
              <header>
                <strong>Ops stations</strong>
                <small>{opsStations.length} in scope</small>
              </header>
              {opsStations.map((row) => (
                <Link
                  className={`${styles.person} ${row.id === station?.id ? styles.current : ""}`}
                  key={row.id}
                  href={`?tab=stations&station=${row.id}`}
                >
                  <strong>{row.station_code}</strong>
                  <span>
                    {settings.find((item) => item.station_id === row.id)?.supervisor_alias ||
                      maps.find((m) => m.station_code === String(row.station_code).toUpperCase())?.supervisor_id ||
                      "Defaults not configured"}
                  </span>
                </Link>
              ))}
            </section>
            {station ? (
              <div className={styles.detail}>
                <section className={styles.card}>
                  <header>
                    <div>
                      <h2>{station.station_code}</h2>
                      <p>
                        Invite email pattern and Amazon service-area UUID for this Ops station. Supervisor coverage is
                        managed on the Supervisors tab.
                      </p>
                    </div>
                  </header>
                  <form className={styles.plan} action={saveAmazonStation} key={station.id}>
                    <input type="hidden" name="tab" value="stations" />
                    <input type="hidden" name="station_id" value={station.id} />
                    <input type="hidden" name="version" value={current?.version ?? 0} />
                    <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
                      <div className={styles.fields}>
                        <label>
                          Amazon service area
                          <select name="amazon_service_area_id" defaultValue={current?.amazon_service_area_id ?? ""}>
                            <option value="">Select from synced Amazon areas</option>
                            {areas.map((area) => (
                              <option key={String(area.service_area_id)} value={String(area.service_area_id)}>
                                {String(area.station_code)} · {String(area.service_area_name)}
                                {area.station_state ? ` (${area.station_state})` : ""}
                              </option>
                            ))}
                          </select>
                          <small>
                            {areas.length
                              ? `${areas.length} areas from Amazon API`
                              : "Use Amazon lifecycle → Sync Amazon first."}
                          </small>
                        </label>
                        <label>
                          Amazon service-area code
                          <input
                            name="service_area_code"
                            required
                            maxLength={24}
                            defaultValue={current?.service_area_code ?? station.station_code ?? ""}
                          />
                        </label>
                        <label>
                          Service type
                          <input value="Amazon Logistics" readOnly />
                        </label>
                        <label>
                          Supervisor badge login (fallback)
                          <input
                            name="supervisor_alias"
                            required
                            maxLength={80}
                            defaultValue={current?.supervisor_alias ?? supervisorDefault}
                          />
                          <small>Prefer Supervisors tab for multi-station coverage; this is the per-station fallback.</small>
                        </label>
                        <label>
                          Approved DA contract type
                          <select name="contract_type" required defaultValue={current?.contract_type ?? "Independent Contractor"}>
                            {["Independent Contractor", "Subcontractor", "DSP Employed"].map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Associate email pattern
                          <input
                            name="associate_email_pattern"
                            required
                            maxLength={254}
                            defaultValue={current?.associate_email_pattern ?? ""}
                            placeholder="{first_name}.{station_code}@yourdomain.com"
                          />
                        </label>
                        <label className="checkbox-row">
                          <input name="invitation_enabled" type="checkbox" defaultChecked={current?.invitation_enabled ?? false} />{" "}
                          Enable Create Amazon ID for this station
                        </label>
                      </div>
                      <SubmitButton pendingText="Saving station defaults">Save invite settings</SubmitButton>
                    </fieldset>
                  </form>
                </section>
              </div>
            ) : (
              <p>No permitted Ops stations found.</p>
            )}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
