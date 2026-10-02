import { ArrowRight, LayoutDashboard } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { requirePagePermission } from "@/lib/authorization";
import styles from "./today.module.css";

export const dynamic = "force-dynamic";

export default async function WorkforceDashboard() {
  await requirePagePermission("delivery_associates", "access");
  return (
    <AppShell active="Workforce Dashboard" pageCode="delivery_associates">
      <section className={styles.emptyDashboard}>
        <span className={styles.icon}><LayoutDashboard size={22} /></span>
        <p className={styles.eyebrow}>Workforce · Today</p>
        <h1>Today will be assembled last</h1>
        <p>Its priorities, exceptions and counts will come from the completed onboarding, associates, referral and payout workflows.</p>
        <PendingLink href="/delivery-network/onboarding" className={styles.action}>Build from onboarding <ArrowRight size={15} /></PendingLink>
      </section>
    </AppShell>
  );
}
