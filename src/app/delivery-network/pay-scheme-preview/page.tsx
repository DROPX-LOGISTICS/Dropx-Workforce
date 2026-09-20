import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { requirePagePermission } from "@/lib/authorization";
import { workforceToday } from "@/lib/workforce-earnings";
import { PaySchemePreview } from "./preview";

export const dynamic = "force-dynamic";

export default async function PaySchemePreviewPage() {
  await requirePagePermission("workforce_rate_cards", "access");
  return <AppShell active="Rate Cards" pageCode="workforce_rate_cards">
    <section className="wf-finance-hero compact">
      <div><span>Commercial planning · No live changes</span><h1>Pay formula preview</h1>
        <p>Compare period-based guarantees and verified kilometre fuel before agreeing a scheme. This calculator does not create a rate card or change payroll.</p></div>
      <div className="wf-finance-actions"><PendingLink className="wf-command-secondary" href="/delivery-network/rate-cards">Back to rate cards</PendingLink><PendingLink className="wf-command-secondary" href="/delivery-network/pooled-settlements">Confirmed-base pooled settlement</PendingLink></div>
    </section>
    <PaySchemePreview today={workforceToday()} />
  </AppShell>;
}
