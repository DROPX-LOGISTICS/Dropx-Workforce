import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { inferFormTypeFromLocation, loadCodLocations } from "@/lib/ops-pulse/cod";

export const dynamic = "force-dynamic";

export default async function OpsPulsePage() {
  const authorization = await requirePagePermission("ops_pulse", "access");
  const companyId = requireCompanyId(authorization);
  const { locations, error } = await loadCodLocations(
    companyId,
    authorization.locationScopeIds,
    authorization.hasAllLocationAccess
  );
  const amazonStations = locations.filter((location) => inferFormTypeFromLocation(location) === "amazon");
  const flipkartStations = locations.filter((location) => inferFormTypeFromLocation(location) === "flipkart");

  return (
    <AppShell active="Overview" pageCode="ops_pulse">
      <PageHead
        eyebrow="DropX Operations"
        title="Ops Pulse"
        subtitle="Client-aware station operations, daily closure, COD reconciliation, validation, and exception control."
        action={<a className="button secondary" href="https://dashboard.dropxlogistics.com/dashboard">Open main dashboard</a>}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Unable to load station scope</strong><p className="subtle">{error}</p></div>
        </section>
      ) : null}

      <section className="summary-grid">
        <div className="metric-card"><span>Permitted stations</span><strong>{locations.length}</strong><small>Based on your dashboard access</small></div>
        <div className="metric-card"><span>Amazon</span><strong>{amazonStations.length}</strong><small>SCC reconciliation and remittance flow</small></div>
        <div className="metric-card"><span>Flipkart</span><strong>{flipkartStations.length}</strong><small>ERP COD and deposit-proof flow</small></div>
        <div className="metric-card"><span>Client scope</span><strong>{amazonStations.length && flipkartStations.length ? "Multi-client" : amazonStations.length ? "Amazon" : flipkartStations.length ? "Flipkart" : "Unmapped"}</strong><small>Automatically derived from station master</small></div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Select client workflow</h2><p className="subtle">Station users see only the client mapped to their permitted station. Owners and multi-station managers can choose either workflow.</p></div></div>
        <div className="panel-body">
          <div className="summary-grid">
            {amazonStations.length ? (
              <div className="metric-card">
                <span>Amazon Operations</span>
                <strong>{amazonStations.length} stations</strong>
                <small>Daily submission → executive COD → SCC Driver Reconciliation → Bank Deposit → closure.</small>
                <div className="form-actions" style={{ marginTop: 14 }}><Link className="button" href="/ops-pulse/client/amazon">Open Amazon</Link></div>
              </div>
            ) : null}
            {flipkartStations.length ? (
              <div className="metric-card">
                <span>Flipkart Operations</span>
                <strong>{flipkartStations.length} stations</strong>
                <small>Daily submission → ERP COD amount → deposited amount/UTR/proof → validation → closure.</small>
                <div className="form-actions" style={{ marginTop: 14 }}><Link className="button" href="/ops-pulse/client/flipkart">Open Flipkart</Link></div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
