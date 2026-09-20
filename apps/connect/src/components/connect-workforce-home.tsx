"use client";

import { BadgeIndianRupee, CalendarDays, ChevronRight, CircleHelp, PackageCheck, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppAccount } from "./connect-profile-app";

type WorkLine = {
  work_date?: string;
  shipment_count?: number;
  activity_count?: number;
  net_amount?: number;
};

type Payload = { records?: WorkLine[]; error?: string };

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);
}

function monthStart() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
}

function workQuote(role: string) {
  const day = Math.floor(Date.now() / 86_400_000);
  const normalized = role.toLowerCase();
  const quotes = normalized.includes("sort")
    ? ["Every sorted parcel keeps the network moving.", "Your accuracy powers every successful handover.", "Great operations start with the details you get right."]
    : normalized.includes("clean")
      ? ["A well-kept station helps every team do their best work.", "Your work makes a better shift for everyone.", "Care in the details keeps operations moving safely."]
      : normalized.includes("driver") || normalized.includes("dcd") || normalized.includes("odcd") || normalized.includes("delivery")
        ? ["Every safe delivery builds trust, one doorstep at a time.", "A steady route and a safe ride make a great day.", "The miles you cover connect people to what matters."]
        : ["Your work keeps the station moving forward.", "A good shift is built one task at a time.", "The work you do today powers tomorrow's deliveries."];
  return quotes[day % quotes.length];
}

export function ConnectWorkforceHome({
  account,
  onConnect,
  onPayments,
  onPerformance,
  onWork
}: {
  account: AppAccount;
  onConnect: () => void;
  onPayments: () => void;
  onPerformance: () => void;
  onWork: () => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setPayload(null);
    setError("");
    const query = new URLSearchParams({ accountId: account.id, profileType: account.profileType, view: "performance" });
    fetch(`/api/connect/workforce-self-service?${query}`, { cache: "no-store" })
      .then(async (response) => {
        const next = await response.json() as Payload;
        if (!response.ok) throw new Error(next.error || "Unable to load current-month earnings.");
        setPayload(next);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load current-month earnings."));
  }, [account.id, account.profileType]);

  const summary = useMemo(() => {
    const rows = (payload?.records ?? []).filter((row) => String(row.work_date ?? "") >= monthStart());
    return rows.reduce((total, row) => ({
      amount: total.amount + Number(row.net_amount ?? 0),
      shipments: total.shipments + Number(row.shipment_count ?? 0),
      activities: total.activities + Number(row.activity_count ?? 0)
    }), { amount: 0, shipments: 0, activities: 0 });
  }, [payload]);
  const firstName = (account.name || account.reference || "there").trim().split(/\s+/)[0];
  const pages = new Set(account.pageAccess ?? ["dashboard", "payments", "advances"]);
  const paymentEnabled = pages.has("payments") || pages.has("advances") || pages.has("rate_card");
  const workEnabled = pages.has("attendance") || pages.has("roster") || pages.has("leave");
  const quote = workQuote(account.role || "");

  return <section className="dx-workforce-home">
    <header className="dx-workforce-home-hero">
      <small>DROPX WORKFORCE</small>
      <h1>Hi, {firstName}</h1>
      <p>{account.role || "Delivery associate"} · {account.companyName}</p>
      <strong className="dx-workforce-quote">“{quote}”</strong>
    </header>

    {paymentEnabled ? <button className="dx-live-earnings-card" onClick={onPayments} type="button">
      <span><small>LIVE EARNINGS · THIS MONTH</small><strong>{payload ? money(summary.amount) : "—"}</strong><em>{payload ? `${summary.shipments.toLocaleString("en-IN")} deliveries · ${summary.activities.toLocaleString("en-IN")} activities` : "Calculating from mapped delivery data…"}</em></span>
      <i><BadgeIndianRupee /></i><ChevronRight />
    </button> : null}

    {error ? <div className="dx-workforce-home-note">Live earnings will appear once delivery data is available.</div> : null}

    <section className="dx-workforce-home-section">
      <header><h2>My work</h2><span>This month</span></header>
      <div className="dx-workforce-home-stats">
        <article><i><PackageCheck /></i><span><small>Deliveries</small><strong>{payload ? summary.shipments.toLocaleString("en-IN") : "—"}</strong></span></article>
        <article><i><TrendingUp /></i><span><small>Activities</small><strong>{payload ? summary.activities.toLocaleString("en-IN") : "—"}</strong></span></article>
      </div>
    </section>

    <section className="dx-workforce-home-section dx-workforce-home-actions">
      <header><h2>Quick access</h2></header>
      {paymentEnabled ? <button onClick={onPayments} type="button"><i><BadgeIndianRupee /></i><span><strong>Payments</strong><small>Live earnings, statements, advances and rate card</small></span><ChevronRight /></button> : null}
      {workEnabled ? <button onClick={onWork} type="button"><i><CalendarDays /></i><span><strong>Work</strong><small>Roster, attendance and time off</small></span><ChevronRight /></button> : null}
      {pages.has("performance") ? <button onClick={onPerformance} type="button"><i><TrendingUp /></i><span><strong>Performance</strong><small>Daily delivery output and pay calculation</small></span><ChevronRight /></button> : null}
      {pages.has("connect") ? <button onClick={onConnect} type="button"><i><CircleHelp /></i><span><strong>Connect</strong><small>Get help with payment, ID or roster</small></span><ChevronRight /></button> : null}
    </section>
  </section>;
}
