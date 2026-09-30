"use client";

import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  ContactRound,
  Fingerprint,
  Gift,
  LayoutDashboard,
  Menu,
  ListTree,
  MessageSquareMore,
  ReceiptIndianRupee,
  Settings2,
  ShieldCheck,
  UsersRound,
  UserRoundPlus,
  X
} from "lucide-react";
import { EventLogTracker } from "@/components/event-log-tracker";
import { PendingLink } from "@/components/pending-link";
import type { NavItem } from "@/lib/app-navigation";
import {activeWorkspace, compactWorkspaces, workspaceDestination, workspaceLinkActive} from '@/lib/workforce-workspace-navigation';
import './workforce-workspace.css';

type WorkforceProductFrameProps = {
  active: string;
  actions: ReactNode;
  children: ReactNode;
  items: NavItem[];
};

const navigationIcons: Record<string, typeof LayoutDashboard> = {
  delivery_associates: UsersRound,
  provider_mapping: Fingerprint,
  workforce_earnings: ReceiptIndianRupee,
  workforce_communications: MessageSquareMore,
  users: ShieldCheck,
  payment_methods: ListTree,
  designations: Settings2
};

const administrationWorkspaces = new Set(["Settings"]);

function WorkforceRiderMark() {
  return (
    <svg
      aria-hidden="true"
      className="wf-rider-mark"
      viewBox="0 0 32 32"
    >
      <circle cx="7.5" cy="23.5" fill="none" r="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="24.5" cy="23.5" fill="none" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M7.5 23.5h7l4-7.7 3.5 7.7h2.5M13.3 15.8l-3 5.2h8" fill="none" stroke="#f15a24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="m18.5 15.8 5.2-1.2 2.2 3.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="18.2" cy="7.2" fill="#f15a24" r="2.3" />
      <path d="m17.3 10.2-3.6 4 4.8 1.7 3.1-3.6" fill="none" stroke="#f15a24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      <rect fill="#f7b321" height="4.7" rx="1" width="5.2" x="9.5" y="9.4" />
      <path d="M11.1 9.4V8.2h2v1.2" fill="none" stroke="#c74419" strokeLinecap="round" strokeWidth="1" />
      <path d="M3.5 29h25" fill="none" stroke="#f7b321" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function iconFor(item: NavItem) {
  if (item.label === "Today") return LayoutDashboard;
  if (item.label === "Onboarding") return UserRoundPlus;
  if (item.label === "Associates") return ContactRound;
  if (item.label === "Referrals") return Gift;
  return navigationIcons[item.code] ?? LayoutDashboard;
}

function SidebarWorkspace({
  item,
  selected,
  isCurrent,
}: {
  item: NavItem;
  selected: boolean;
  isCurrent: (href?: string) => boolean;
}) {
  const NavigationIcon = iconFor(item);
  const destination = workspaceDestination(item);
  const primary = item.children?.filter((child) => !child.secondary) ?? [];
  if (!destination) return null;

  return (
    <div className={`wf-sidebar-workspace ${selected ? "active" : ""}`.trim()}>
      <PendingLink
        aria-current={selected && !primary.some((child) => isCurrent(child.href)) ? "page" : undefined}
        className={`wf-left-direct ${selected ? "active" : ""}`.trim()}
        href={destination}
      >
        <NavigationIcon aria-hidden="true" size={16} />
        <span>{item.label}</span>
        {selected && primary.length ? <ChevronDown aria-hidden="true" className="wf-sidebar-caret" size={14} /> : null}
      </PendingLink>
      {selected && primary.length ? (
        <div className="wf-sidebar-children">
          {primary.map((child) => (
            <PendingLink
              aria-current={isCurrent(child.href) ? "page" : undefined}
              className={isCurrent(child.href) ? "active" : ""}
              href={child.href!}
              key={child.label}
            >
              {child.label}
            </PendingLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkforceProductFrame({ active, actions, children, items }: WorkforceProductFrameProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const workspaces = compactWorkspaces(items);
  const workspace = activeWorkspace(workspaces, pathname, active);
  const secondary = workspace?.children?.filter(item=>item.secondary) ?? [];
  const isCurrent = (href?: string) => workspaceLinkActive(href, pathname, searchParams.toString());
  const operationsWorkspaces = workspaces.filter((item) => !administrationWorkspaces.has(item.label));
  const administration = workspaces.filter((item) => administrationWorkspaces.has(item.label));

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle("workforce-mobile-open", mobileOpen);
    return () => document.body.classList.remove("workforce-mobile-open");
  }, [mobileOpen]);

  return (
    <div className="workforce-product workforce-people-inspired wf-compact wf-modern">
      <EventLogTracker />

      {mobileOpen ? (
        <button
          aria-label="Close Workforce menu"
          className="wf-left-backdrop"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      ) : null}

      <aside className={`wf-left-sidebar ${mobileOpen ? "open" : ""}`.trim()}>
        <div className="wf-left-brand-row">
          <PendingLink className="wf-left-brand" href="/delivery-network">
            <Image alt="DropX" height={28} priority src="/dropx-logo.png" width={76} />
            <span className="wf-left-brand-divider" aria-hidden="true" />
            <span className="wf-workforce-lockup">
              <WorkforceRiderMark />
              <strong>Workforce<small>Field network</small></strong>
            </span>
          </PendingLink>
          <button aria-label="Close Workforce menu" className="wf-left-close" onClick={() => setMobileOpen(false)} type="button">
            <X size={18} />
          </button>
        </div>

        <nav className="wf-left-navigation" aria-label="Workforce navigation">
          <span className="wf-sidebar-section-label">Field operations</span>
          {operationsWorkspaces.map((item) => (
            <SidebarWorkspace item={item} isCurrent={isCurrent} key={item.label} selected={item === workspace} />
          ))}
          {administration.length ? <span className="wf-sidebar-section-label administration">Administration</span> : null}
          {administration.map((item) => (
            <SidebarWorkspace item={item} isCurrent={isCurrent} key={item.label} selected={item === workspace} />
          ))}
        </nav>

        <div className="wf-left-footer">
          <span>DropX Workforce</span>
          <small>Role and station access applies</small>
        </div>
      </aside>

      <div className="wf-product-body">
        <header className="wf-slim-topbar">
          <button
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close Workforce menu" : "Open Workforce menu"}
            className="wf-slim-menu-button"
            onClick={() => setMobileOpen((current) => !current)}
            type="button"
          >
            {mobileOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="wf-slim-page-title">
            <span>Field operations</span>
            <strong>{active}</strong>
          </div>
          <div className="wf-product-actions">{actions}</div>
        </header>

        <main className="wf-product-main">
          <div className="wf-product-content">
            {secondary.length ? <nav className="wf-workspace-nav wf-workspace-tools" aria-label={`${workspace?.label} tools`}>
              <strong>{workspace?.label}</strong>
              <details key={`${pathname}:${searchParams.toString()}`}><summary>{secondary.find(child=>isCurrent(child.href))?.label ?? 'More tools'} <ChevronDown size={14}/></summary><div>{secondary.map(child=><PendingLink key={child.label} href={child.href!} aria-current={isCurrent(child.href)?'page':undefined}>{child.label}</PendingLink>)}</div></details>
            </nav>:null}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
