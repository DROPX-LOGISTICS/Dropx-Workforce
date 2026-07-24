import type { ReactNode } from "react";
import { headers } from "next/headers";
import { signOut } from "@/app/login/actions";
import { AppShellFrame } from "@/components/app-shell-frame";
import { DocumentTitle } from "@/components/document-title";
import { InboxNotificationListener } from "@/components/inbox-notification-listener";
import { PaymentNotificationBell } from "@/components/payment-notification-bell";
import { PaymentNotificationProvider } from "@/components/payment-notification-provider";
import { SidebarNav } from "@/components/sidebar-nav";
import { UserMenu } from "@/components/user-menu";
import { redirect } from "next/navigation";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { navItems } from "@/lib/app-navigation";
import { loadPaymentNotificationSnapshot } from "@/lib/payment-notification-counts";
import { opsNavItems } from "@/lib/ops-pulse/navigation";

export async function AppShell({ children, active, pageCode }: { children: ReactNode; active: string; pageCode?: string }) {
  const authorization = await getAuthorization();
  if (!authorization) redirect("/login");
  const host = headers().get("host")?.split(":")[0].toLowerCase() ?? "";
  const isOpsHost = host === "ops.dropxlogistics.com" || host.startsWith("ops-");
  const opsAppUrl = process.env.OPS_APP_URL?.trim();
  const shellNavItems = isOpsHost
    ? opsNavItems
    : navItems.map((item) => item.code === "ops_pulse" && opsAppUrl ? { ...item, href: opsAppUrl } : item);

  const activeItem = shellNavItems.find((item) => item.label === active || item.children?.some((child) => child.label === active));
  const currentPageCode = pageCode ?? activeItem?.code;
  if (currentPageCode && !hasPermission(authorization, currentPageCode, "access")) redirect("/unauthorized");
  const visibleNavItems = shellNavItems
    .map((item) => item.children?.length ? {
      ...item,
      children: item.children.filter((child) => !child.code || hasPermission(authorization, child.code, "access"))
    } : item)
    .filter((item) => item.children?.length ? item.children.length > 0 : hasPermission(authorization, item.code, "access"));
  const inboxNotificationsEnabled = hasPermission(authorization, "inbox", "access");
  const paymentNotifications = await loadPaymentNotificationSnapshot(authorization);
  const userMenuProps = {
    action: signOut,
    email: authorization.email,
    name: authorization.fullName ?? authorization.email ?? "DropX user",
    role: authorization.roleName
  };
  const topActions = (
    <>
      <PaymentNotificationBell />
      <UserMenu {...userMenuProps} />
    </>
  );

  return (
    <PaymentNotificationProvider initialData={paymentNotifications}>
    <AppShellFrame
      desktopActions={topActions}
      mobileActions={topActions}
      sidebar={(
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-logo" src="/dropx-logo.png" alt="DropX" />
            {isOpsHost ? <span className="count-badge">OPS PULSE</span> : null}
          </div>

          <SidebarNav active={active} items={visibleNavItems} />

          <div className="sidebar-footer">
            <strong>{authorization.fullName ?? authorization.email ?? "DropX user"}</strong>
            <br />
            {authorization.roleName ?? "Dashboard user"}
          </div>
        </aside>
      )}
    >
      <DocumentTitle pageName={active} />
      <InboxNotificationListener enabled={inboxNotificationsEnabled} />
      {children}
    </AppShellFrame>
    </PaymentNotificationProvider>
  );
}
