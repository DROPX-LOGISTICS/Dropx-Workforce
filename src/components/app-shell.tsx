import type { ReactNode } from "react";
import { Icon } from "./icons";
import { PendingLink } from "./pending-link";
import { signOut } from "@/app/login/actions";
import { AppShellFrame } from "@/components/app-shell-frame";
import { DocumentTitle } from "@/components/document-title";
import { InboxNotificationListener } from "@/components/inbox-notification-listener";
import { PaymentNotificationBell } from "@/components/payment-notification-bell";
import { PaymentNavBadge, PaymentNotificationProvider } from "@/components/payment-notification-provider";
import { UserMenu } from "@/components/user-menu";
import { redirect } from "next/navigation";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { navItems } from "@/lib/app-navigation";
import { loadPaymentNotificationSnapshot } from "@/lib/payment-notification-counts";

export async function AppShell({ children, active, pageCode }: { children: ReactNode; active: string; pageCode?: string }) {
  const authorization = await getAuthorization();
  if (!authorization) redirect("/login");

  const activeItem = navItems.find((item) => item.label === active || item.children?.some((child) => child.label === active));
  const currentPageCode = pageCode ?? activeItem?.code;
  if (currentPageCode && !hasPermission(authorization, currentPageCode, "access")) redirect("/unauthorized");
  const visibleNavItems = navItems.filter((item) => {
    if (item.children?.length) {
      return item.children.some((child) => child.code && hasPermission(authorization, child.code, "access"));
    }

    return hasPermission(authorization, item.code, "access");
  });
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
          </div>

          <nav className="nav" aria-label="Primary">
            {visibleNavItems.map((item) => item.children ? (
              <div className="nav-group" key={item.label}>
                <button
                  type="button"
                  className={`nav-item ${active === item.label || item.children.some((child) => child.label === active) ? "active" : ""}`}
                >
                  <Icon>{item.icon}</Icon>
                  <span className="nav-label">{item.label}</span>
                  <PaymentNavBadge code={item.code} />
                  <span className="nav-caret" aria-hidden="true">&gt;</span>
                </button>
                <div className="nav-submenu">
                  {item.children
                    .filter((child) => !child.code || hasPermission(authorization, child.code, "access"))
                    .map((child) => child.href ? (
                      <PendingLink className="nav-subitem" disableWhenCurrent href={child.href} key={child.label}>
                        <span className="nav-label">{child.label}</span>
                        <PaymentNavBadge code={child.code} />
                      </PendingLink>
                    ) : (
                      <span className="nav-subitem disabled" key={child.label}>{child.label}</span>
                    ))}
                </div>
              </div>
            ) : item.href ? (
              <PendingLink
                className={`nav-item ${active === item.label ? "active" : ""}`}
                disableWhenCurrent
                href={item.href}
                key={item.label}
              >
                <Icon>{item.icon}</Icon>
                <span className="nav-label">{item.label}</span>
                <PaymentNavBadge code={item.code} />
              </PendingLink>
            ) : (
              <span className="nav-item disabled" key={item.label}>
                <Icon>{item.icon}</Icon>
                <span className="nav-label">{item.label}</span>
                <PaymentNavBadge code={item.code} />
              </span>
            ))}
          </nav>

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
