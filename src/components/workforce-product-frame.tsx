"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  Fingerprint,
  LayoutDashboard,
  Menu,
  MessageSquareMore,
  Settings2,
  ShieldCheck,
  UsersRound,
  X
} from "lucide-react";
import { EventLogTracker } from "@/components/event-log-tracker";
import { PendingLink } from "@/components/pending-link";
import type { NavItem } from "@/lib/app-navigation";

type WorkforceProductFrameProps = {
  active: string;
  actions: ReactNode;
  children: ReactNode;
  items: NavItem[];
};

const navigationIcons: Record<string, typeof LayoutDashboard> = {
  delivery_associates: UsersRound,
  provider_mapping: Fingerprint,
  workforce_communications: MessageSquareMore,
  users: ShieldCheck,
  designations: Settings2
};

function WorkforceRiderMark() {
  return (
    <svg
      aria-hidden="true"
      className="wf-rider-mark"
      viewBox="0 0 32 32"
    >
      <circle cx="7.5" cy="23.5" fill="none" r="4" stroke="#344054" strokeWidth="2" />
      <circle cx="24.5" cy="23.5" fill="none" r="4" stroke="#344054" strokeWidth="2" />
      <path d="M7.5 23.5h7l4-7.7 3.5 7.7h2.5M13.3 15.8l-3 5.2h8" fill="none" stroke="#f15a24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="m18.5 15.8 5.2-1.2 2.2 3.2" fill="none" stroke="#344054" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="18.2" cy="7.2" fill="#f15a24" r="2.3" />
      <path d="m17.3 10.2-3.6 4 4.8 1.7 3.1-3.6" fill="none" stroke="#f15a24" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      <rect fill="#f7b321" height="4.7" rx="1" width="5.2" x="9.5" y="9.4" />
      <path d="M11.1 9.4V8.2h2v1.2" fill="none" stroke="#c74419" strokeLinecap="round" strokeWidth="1" />
      <path d="M3.5 29h25" fill="none" stroke="#f7b321" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function iconFor(item: NavItem) {
  if (item.label === "Workforce Dashboard") return LayoutDashboard;
  return navigationIcons[item.code] ?? LayoutDashboard;
}

export function WorkforceProductFrame({ active, actions, children, items }: WorkforceProductFrameProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  useEffect(() => {
    setMobileOpen(false);
    setExpandedGroup(null);
  }, [active, pathname]);

  useEffect(() => {
    document.body.classList.toggle("workforce-mobile-open", mobileOpen);
    return () => document.body.classList.remove("workforce-mobile-open");
  }, [mobileOpen]);

  return (
    <div className="workforce-product">
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
          {items.map((item) => {
            const NavigationIcon = iconFor(item);
            const directActive = item.label === active;
            const childActive = item.children?.some((child) => child.label === active) ?? false;
            const expanded = expandedGroup === item.label;

            if (item.href) {
              return (
                <PendingLink className={`wf-left-direct ${directActive ? "active" : ""}`.trim()} href={item.href} key={item.label}>
                  <NavigationIcon aria-hidden="true" size={16} />
                  <span>{item.label}</span>
                </PendingLink>
              );
            }

            return (
              <section className={childActive ? "active" : ""} key={item.label}>
                <button
                  aria-expanded={expanded}
                  className="wf-left-group-label"
                  onClick={() => setExpandedGroup((current) => current === item.label ? null : item.label)}
                  type="button"
                >
                  <NavigationIcon aria-hidden="true" size={15} />
                  <span>{item.label}</span>
                  <ChevronDown aria-hidden="true" className={`wf-left-group-chevron ${expanded ? "open" : ""}`.trim()} size={12} />
                </button>
                {expanded ? (
                  <div className="wf-left-children">
                    {item.children?.map((child) => child.href ? (
                      <PendingLink
                        className={active === child.label ? "active" : ""}
                        disableWhenCurrent
                        href={child.href}
                        key={child.label}
                      >
                        {child.label}
                      </PendingLink>
                    ) : null)}
                  </div>
                ) : null}
              </section>
            );
          })}
        </nav>

        <div className="wf-left-footer">
          <span><i /> System live</span>
          <small>Workforce workspace</small>
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
            <span>Workforce</span>
            <strong>{active}</strong>
          </div>
          <div className="wf-product-actions">{actions}</div>
        </header>

        <main className="wf-product-main">
          <div className="wf-product-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
