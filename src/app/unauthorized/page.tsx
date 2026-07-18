import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { SubmitButton } from "@/components/submit-button";

export default function UnauthorizedPage() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <img className="login-logo" src="/dropx-logo.png" alt="DropX" />
        <div className="login-copy">
          <span className="eyebrow">Access restricted</span>
          <h1>Permission required</h1>
          <p>Your assigned role does not allow this page or action.</p>
        </div>
        <form action={signOut}>
          <SubmitButton className="button secondary" pendingText="Signing out">
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
