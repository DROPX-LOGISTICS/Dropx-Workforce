import { Fingerprint, Route, ShieldCheck, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { DocumentTitle } from "@/components/document-title";
import { OpsLoginPanel } from "@/components/ops-login-panel";
import { SubmitButton } from "@/components/submit-button";
import { firstAllowedHref } from "@/lib/app-navigation";
import { getAuthorization, hasPermission, isCompanyOwner } from "@/lib/authorization";
import { opsAccessPageCodes } from "@/lib/access-surface";
import { safeOpsNextPath } from "@/lib/ops-pulse/auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { signInWithGoogle } from "./actions";

type LoginPageProps = {
  searchParams?: { error?: string; next?: string; reason?: string };
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const host = headers().get("x-forwarded-host")?.split(":")[0].toLowerCase() ??
    headers().get("host")?.split(":")[0].toLowerCase() ??
    "";
  const isOpsHost = host === "ops.dropxlogistics.com";
  const isWorkforceHost = host === "workforce.dropxlogistics.com" || host.startsWith("workforce-");
  const supabase = createServerSupabaseClient(undefined, isOpsHost ? true : undefined);
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (data.user) {
    if (host === "admin-panel.dropxlogistics.com") redirect("/");
    const authorization = await getAuthorization();
    if (isOpsHost) {
      const hasOpsAccess = Boolean(authorization && (
        isCompanyOwner(authorization) ||
        opsAccessPageCodes.some((code) => hasPermission(authorization, code, "access"))
      ));
      redirect(hasOpsAccess ? safeOpsNextPath(searchParams?.next) : "/unauthorized?reason=access");
    }
    if (isWorkforceHost) redirect("/delivery-network");
    redirect(authorization ? firstAllowedHref(authorization) ?? "/unauthorized" : "/dashboard");
  }

  const message = searchParams?.error ?? searchParams?.reason;

  if (isOpsHost) {
    return (
      <>
        <DocumentTitle pageName="OpsPulse Login" />
        <OpsLoginPanel initialMessage={message} nextPath={safeOpsNextPath(searchParams?.next)} />
      </>
    );
  }

  if (isWorkforceHost) {
    return (
      <main className="workforce-login-page">
        <DocumentTitle pageName="Workforce Login" productName="Workforce · DropX" />
        <section className="workforce-login-story">
          <div className="workforce-login-brand"><img src="/dropx-logo.png" alt="DropX" /><span /><div><strong>Workforce</strong><small>Rider operations</small></div></div>
          <div className="workforce-login-copy">
            <span>Built for the people on the route</span>
            <h1>From registration<br />to <em>ready to ride.</em></h1>
            <p>One focused workspace for associate onboarding, identity readiness, rate cards and lifecycle decisions.</p>
          </div>
          <div className="workforce-login-route" aria-hidden="true">
            <span><UsersRound size={17} /></span><i /><span><Fingerprint size={17} /></span><i /><span><ShieldCheck size={17} /></span>
          </div>
        </section>
        <section className="workforce-login-access">
          <div className="workforce-login-card">
            <div className="workforce-login-card-icon"><Route size={22} /></div>
            <span className="workforce-login-kicker">Secure Workforce access</span>
            <h2>Welcome back</h2>
            <p>Continue with your approved DropX Google account.</p>
            {message ? <div className="login-error">{message}</div> : null}
            <form className="google-signin-form" action={signInWithGoogle}>
              <input name="next" type="hidden" value="/delivery-network" />
              <SubmitButton className="google-asset-button" pendingText="Opening Google">
                <img className="google-signin-asset" src="/google-signin-light.svg" alt="Sign in with Google" />
              </SubmitButton>
            </form>
            <small className="workforce-login-footnote">Access is controlled by Workforce roles and location scope.</small>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <DocumentTitle pageName="Login" />
      <section className="login-panel">
        <img className="login-logo" src="/dropx-logo.png" alt="DropX" />
        <div className="login-copy">
          <h1>Sign in to DropX Dashboard</h1>
          <p>Sign in with your Google account</p>
        </div>

        {message ? <div className="login-error">{message}</div> : null}
        <form className="google-signin-form" action={signInWithGoogle}>
          <input name="next" type="hidden" value={searchParams?.next ?? ""} />
          <SubmitButton className="google-asset-button" pendingText="Opening Google">
            <img
              className="google-signin-asset"
              src="/google-signin-light.svg"
              alt="Sign in with Google"
            />
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
