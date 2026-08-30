"use client";

import {
  BadgeIndianRupee,
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

type PreviewView = "menu" | "registration";

function PageIcon({ page }: { page: string }) {
  if (page === "payments") return <BadgeIndianRupee />;
  if (page === "advances") return <HandCoins />;
  if (page === "attendance") return <Fingerprint />;
  if (page === "roster") return <CalendarDays />;
  if (page === "performance") return <BarChart3 />;
  return <Gauge />;
}

export function DropxOneDesignationPreview({
  designationName,
  fields,
  pageAccess,
  rules,
  scopeLabel
}: {
  designationName: string;
  fields: ProfileFieldRule[];
  pageAccess: string[];
  rules: ProfileFieldChannelRules;
  scopeLabel: string;
}) {
  const [view, setView] = useState<PreviewView>("menu");
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
            <button aria-label="Menu preview" type="button"><Menu /></button>
            <Image alt="DropX" height={34} src="/dropx-logo.png" width={94} />
            <span>ONE</span>
            <button aria-label="Notifications preview" type="button"><Bell /></button>
            <i aria-hidden="true">D</i>
          </header>
          {view === "menu" ? (
            <section className="dropx-one-app-drawer">
              <header>
                <div><small>WORKFORCE ACCOUNT</small><strong>{designationName || "New designation"}</strong></div>
                <span>Active</span>
              </header>
              <nav aria-label="Configured Workforce app menu">
                {configuredPages.map((page, index) => (
                  <div className={index === 0 ? "active" : ""} key={page.value}>
                    <PageIcon page={page.value} />
                    <span>{page.label}</span>
                    <ChevronRight />
                  </div>
                ))}
                <div>
                  <UserRound />
                  <span>My Profile <small>Profile, guide &amp; resignation</small></span>
                  <ChevronRight />
                </div>
                <div>
                  <Settings />
                  <span>Settings</span>
                  <ChevronRight />
                </div>
              </nav>
              {!configuredPages.length ? <p>No optional Workforce pages enabled. Profile (including guide and resignation) and Settings remain available.</p> : null}
            </section>
          ) : (
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
          )}
        </div>
      </div>
    </aside>
  );
}
