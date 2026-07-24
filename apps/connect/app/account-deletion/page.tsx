import type { Metadata } from "next";
import Image from "next/image";
import { Mail, ShieldCheck, Trash2 } from "lucide-react";

export const metadata: Metadata = {
  title: {
    absolute: "Account and data deletion | DropX One"
  },
  description:
    "Request deletion of a DropX One account and associated personal data."
};

const deletionEmail =
  "mailto:nisar@dropxlogistics.com?subject=DropX%20One%20account%20deletion%20request&body=Full%20name%3A%0ADropX%20ID%3A%0ARegistered%20mobile%20number%3A%0AAccount%20category%3A%0A%0AI%20request%20deletion%20of%20my%20DropX%20One%20account%20and%20associated%20personal%20data.";

export default function AccountDeletionPage() {
  return (
    <main className="deletion-page">
      <header className="deletion-header">
        <Image
          alt="DropX"
          className="deletion-logo"
          height={62}
          priority
          src="/dropx-logo.png"
          width={176}
        />
        <span>DropX One</span>
      </header>

      <article className="deletion-content">
        <div className="deletion-title">
          <div className="deletion-title-icon" aria-hidden="true">
            <Trash2 size={24} strokeWidth={1.8} />
          </div>
          <div>
            <p className="deletion-eyebrow">Privacy request</p>
            <h1>Delete your account and data</h1>
            <p>
              This page is for employees, field executives, independent
              contractors, and other users of DropX One.
            </p>
          </div>
        </div>

        <section className="deletion-section">
          <h2>How to request deletion</h2>
          <ol className="deletion-steps">
            <li>
              Select <strong>Request account deletion</strong> below.
            </li>
            <li>
              Include your full name, DropX ID, registered mobile number, and
              account category in the email.
            </li>
            <li>
              Send the request from your registered email address when
              possible. DropX may contact you to verify ownership.
            </li>
          </ol>

          <a className="deletion-button" href={deletionEmail}>
            <Mail size={18} aria-hidden="true" />
            Request account deletion
          </a>
          <p className="deletion-contact">
            Requests are handled by{" "}
            <a href="mailto:nisar@dropxlogistics.com">
              nisar@dropxlogistics.com
            </a>
            .
          </p>
        </section>

        <section className="deletion-grid">
          <div className="deletion-info">
            <Trash2 size={20} aria-hidden="true" />
            <div>
              <h2>Data deleted</h2>
              <p>
                Your app account, profile details, identity and vehicle
                documents, profile photo, contact details, and saved
                verification results will be deleted or anonymized after
                verification of the request.
              </p>
            </div>
          </div>

          <div className="deletion-info">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <h2>Data that may be retained</h2>
              <p>
                Payroll, statutory, attendance, payment, tax, audit, fraud
                prevention, or employment records may be retained only for the
                period required by applicable law or a legitimate legal claim.
                They are deleted or anonymized when that period ends.
              </p>
            </div>
          </div>
        </section>

        <section className="deletion-section deletion-timeline">
          <h2>Processing time</h2>
          <p>
            We acknowledge verified requests and complete deletion within 30
            days, unless a longer retention period is legally required. You
            will receive confirmation when processing is complete.
          </p>
        </section>
      </article>

      <footer className="deletion-footer">
        DropX Logistics · DropX One · Account and data deletion
      </footer>
    </main>
  );
}
