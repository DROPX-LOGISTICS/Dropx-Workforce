"use client";

import {
  BadgeIndianRupee,
  ArrowLeft,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronRight,
  Fingerprint,
  Gauge,
  HandCoins,
  Menu,
  Settings,
  UserRound
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { appPageOptions } from "@/components/app-page-access-select";
import type { ProfileFieldChannelRules, ProfileFieldRule } from "@/lib/profile-field-rules";

type PreviewView = "menu" | "registration" | "page";

function PageIcon({ page }: { page: string }) {
  if (page === "payments") return <BadgeIndianRupee />;
  if (page === "advances") return <HandCoins />;
  if (page === "attendance") return <Fingerprint />;
  if (page === "roster") return <CalendarDays />;
  if (page === "performance") return <BarChart3 />;
  return <Gauge />;
}

function AppPagePreview({ accountName, accountStatus, page, scopeLabel }: { accountName: string; accountStatus: string; page: string; scopeLabel: string }) {
  const label = appPageOptions.find((option) => option.value === page)?.label ?? (page === "profile" ? "My Profile" : "Settings");
  return <section className="dropx-one-page-preview">
    <header><PageIcon page={page} /><div><small>DROPX ONE · WORKFORCE</small><strong>{label}</strong></div></header>
    {page === "dashboard" ? <>
      <article className="hero"><small>WELCOME BACK</small><strong>{accountName}</strong><span>{scopeLabel}</span></article>
      <div className="tiles"><article><small>Account</small><strong>{accountStatus}</strong></article><article><small>Workspace</small><strong>Workforce</strong></article></div>
    </> : null}
    {page === "payments" ? <article className="feature"><BadgeIndianRupee /><div><strong>Payments</strong><span>Payment summaries and released earnings are visible here when available for this account.</span></div></article> : null}
    {page === "advances" ? <article className="feature"><HandCoins /><div><strong>Advances</strong><span>Eligible advance requests and their status are shown here.</span></div></article> : null}
    {page === "attendance" ? <article className="feature"><Fingerprint /><div><strong>Attendance</strong><span>Today’s attendance and verified punch information appear here.</span></div></article> : null}
    {page === "roster" ? <article className="feature"><CalendarDays /><div><strong>Associate Rostering</strong><span>Current shift assignment is sourced from the Workforce roster.</span></div></article> : null}
    {page === "performance" ? <article className="feature"><BarChart3 /><div><strong>Performance</strong><span>Designation-relevant performance cards appear here when data is available.</span></div></article> : null}
    {page === "profile" ? <div className="profile-actions"><article><UserRound /><div><strong>Profile details</strong><span>View registered identity and documents</span></div><ChevronRight /></article><article><BadgeIndianRupee /><div><strong>Workforce self-guide</strong><span>Understand enabled menus and account actions</span></div><ChevronRight /></article><article><CalendarDays /><div><strong>Resignation &amp; exit</strong><span>Reason, message and 14-day default last working day</span></div><ChevronRight /></article></div> : null}
    {page === "settings" ? <div className="profile-actions"><article><Bell /><div><strong>Notifications</strong><span>Manage DropX One alerts</span></div><ChevronRight /></article><article><Settings /><div><strong>Account settings</strong><span>Personal app preferences</span></div><ChevronRight /></article></div> : null}
    <p>This is a read-only experience preview. No request or transaction can be submitted here.</p>
  </section>;
}

export function DropxOneDesignationPreview({
  accountName,
  accountStatus,
  designationName,
  fields,
  pageAccess,
  rules,
  scopeLabel
}: {
  accountName?: string;
  accountStatus?: string;
  designationName: string;
  fields: ProfileFieldRule[];
  pageAccess: string[];
  rules: ProfileFieldChannelRules;
  scopeLabel: string;
}) {
  const [view, setView] = useState<PreviewView>("menu");
  const [activePage, setActivePage] = useState("dashboard");
  const visibleFields = fields.filter((field) => rules.dropx_one.enabled.includes(field.key));
  const required = new Set(rules.dropx_one.required);
  const configuredPages = appPageOptions.filter((page) => pageAccess.includes(page.value));

  return (
    <aside className="dropx-one-preview-wrap" aria-label={`DropX One preview for ${designationName || "new designation"}`}>
      <div className="dropx-one-preview-copy">
        <span className="eyebrow">Live mobile preview</span>
        <h4>DropX One · Workforce</h4>
        <p>The preview uses the same app shell as DropX One. Its menu and registration fields are controlled independently for this Workforce designation.</p>
        <dl>
          {accountName ? <div><dt>User</dt><dd>{accountName}</dd></div> : null}
          <div><dt>Designation</dt><dd>{designationName || "New designation"}</dd></div>
          <div><dt>Engagement</dt><dd>{scopeLabel}</dd></div>
          <div><dt>App menu</dt><dd>{configuredPages.length + 2} pages</dd></div>
        </dl>
        <div className="dropx-one-preview-switch" aria-label="Preview screen">
          <button className={view === "menu" ? "active" : ""} onClick={() => setView("menu")} type="button">App menu</button>
          <button className={view === "registration" ? "active" : ""} onClick={() => setView("registration")} type="button">Registration</button>
        </div>
      </div>
      <div className="dropx-one-phone">
        <div className="dropx-one-phone-screen">
          <header className="dropx-one-app-bar">
            <button aria-label="Menu preview" onClick={() => setView("menu")} type="button">{view === "page" ? <ArrowLeft /> : <Menu />}</button>
            <Image alt="DropX" height={34} src="/dropx-logo.png" width={94} />
            <span>ONE</span>
            <button aria-label="Notifications preview" type="button"><Bell /></button>
            <i aria-hidden="true">D</i>
          </header>
          {view === "menu" ? (
            <section className="dropx-one-app-drawer">
              <header>
                <div><small>WORKFORCE ACCOUNT</small><strong>{accountName || designationName || "New designation"}</strong>{accountName ? <small>{designationName}</small> : null}</div>
                <span>{accountStatus || "Active"}</span>
              </header>
              <nav aria-label="Configured Workforce app menu">
                {configuredPages.map((page, index) => (
                  <button className={index === 0 ? "active" : ""} key={page.value} onClick={() => { setActivePage(page.value); setView("page"); }} type="button">
                    <PageIcon page={page.value} />
                    <span>{page.label}</span>
                    <ChevronRight />
                  </button>
                ))}
                <button onClick={() => { setActivePage("profile"); setView("page"); }} type="button">
                  <UserRound />
                  <span>My Profile <small>Profile, guide &amp; resignation</small></span>
                  <ChevronRight />
                </button>
                <button onClick={() => { setActivePage("settings"); setView("page"); }} type="button">
                  <Settings />
                  <span>Settings</span>
                  <ChevronRight />
                </button>
              </nav>
              {!configuredPages.length ? <p>No optional Workforce pages enabled. Profile (including guide and resignation) and Settings remain available.</p> : null}
            </section>
          ) : view === "registration" ? (
            <section className="dropx-one-registration-preview">
              <header>
                <small>WORKFORCE REGISTRATION</small>
                <strong>{designationName || "New designation"}</strong>
                <span>{visibleFields.length} visible · {visibleFields.filter((field) => required.has(field.key)).length} required</span>
              </header>
              <div className="dropx-one-preview-fields">
                {visibleFields.length ? visibleFields.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}{required.has(field.key) ? <b> *</b> : null}</span>
                    <i>{field.kind === "file" ? "Choose file" : field.kind === "select" ? "Select" : "Enter value"}</i>
                  </label>
                )) : <p>No registration fields enabled.</p>}
              </div>
            </section>
          ) : <AppPagePreview accountName={accountName || designationName || "Workforce user"} accountStatus={accountStatus || "Active"} page={activePage} scopeLabel={scopeLabel} />}
        </div>
      </div>
    </aside>
  );
}
