import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PortalExtensionInstall } from "@/components/portal-extension-install";
import { requirePagePermission } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function PortalExtensionPage() {
  await requirePagePermission("imports", "add");

  return (
    <AppShell active="Report Imports" pageCode="imports">
      <PageHead
        eyebrow="Report Imports"
        title="Fuel auto-upload"
        subtitle="Company-standard setup: staff use the website; IT keeps one office gateway PC online."
        action={<Link className="button secondary compact" href="/imports">Report imports</Link>}
      />
      <PortalExtensionInstall />
    </AppShell>
  );
}
