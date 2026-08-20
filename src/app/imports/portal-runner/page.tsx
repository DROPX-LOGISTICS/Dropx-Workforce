import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PortalFuelRunnerPanel } from "@/components/portal-fuel-runner-panel";
import { requirePagePermission } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function PortalRunnerPage() {
  await requirePagePermission("imports", "add");

  return (
    <AppShell active="Report Imports" pageCode="imports">
      <PageHead
        eyebrow="Report Imports"
        title="Portal auto runner"
        subtitle="Download IOCL fuel reports from your browser in a minimized popup, then import automatically."
        action={<Link className="button secondary compact" href="/imports">Report imports</Link>}
      />

      <section className="panel">
        <div className="panel-head compact-import-head">
          <div>
            <h2>Fuel portal runner</h2>
            <p className="subtle">Uses your browser IP — no proxy or VM required.</p>
          </div>
        </div>
        <PortalFuelRunnerPanel />
      </section>
    </AppShell>
  );
}
