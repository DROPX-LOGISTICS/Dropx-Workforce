import { ConnectLoginFlow } from "@/components/connect-login-flow";

export const metadata = {
  title: {
    absolute: "DropX One"
  }
};

export default function DropXConnectPage() {
  return (
    <main className="connect-page dx-web-page">
      <section className="connect-shell" aria-label="DropX One">
        <aside className="dx-login-story" aria-hidden="true">
          <span>DROPX ONE</span>
          <h1>The everyday app for your work on the move.</h1>
          <p>Shifts, earnings, rate cards and support—clear, current and in one place.</p>
          <div><strong>One profile</strong><small>One simple workday</small></div>
        </aside>
        <ConnectLoginFlow />
      </section>
    </main>
  );
}
