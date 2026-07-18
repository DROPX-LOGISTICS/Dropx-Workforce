import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MasterDataLists } from "@/components/master-data-lists";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { createProvider, updateProvider } from "../../settings/actions";

type ProviderRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

async function loadProviders(companyId: string) {
  if (!supabaseAdmin) {
    return {
      providers: [] as ProviderRow[],
      error: "Supabase service role key is not configured."
    };
  }

  const { data, error } = await supabaseAdmin
    .from("providers")
    .select("id, code, name, is_active")
    .eq("company_id", companyId)
    .order("code");

  return {
    providers: (data ?? []) as ProviderRow[],
    error: error?.message ?? null
  };
}

export const dynamic = "force-dynamic";

type ProvidersPageProps = {
  searchParams?: {
    add?: string;
    edit?: string;
  };
};

export default async function ProvidersPage({ searchParams }: ProvidersPageProps) {
  const authorization = await requirePagePermission("master_providers", "access");
  const companyId = requireCompanyId(authorization);
  const pagePermission = authorization.permissions.master_providers;
  const { providers, error } = await loadProviders(companyId);
  const addType = pagePermission.canAdd ? searchParams?.add : null;
  const [editType, editId] = (searchParams?.edit ?? "").split(":");
  const editProvider = pagePermission.canEdit && editType === "provider" ? providers.find((row) => row.id === editId) : null;

  return (
    <AppShell active="Providers" pageCode="master_providers">
      <PageHead
        eyebrow="Setup"
        title="Providers"
        subtitle="Maintain client and report source masters used by locations, uploads, and payouts."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />

      {error ? (
        <section className="panel">
          <div className="panel-body">
            <strong>Database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {error} Run the master-data SQL migration and add `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
            </p>
          </div>
        </section>
      ) : null}

      {pagePermission.canView || pagePermission.canEdit ? (
        <MasterDataLists
          canAdd={pagePermission.canAdd}
          canEdit={pagePermission.canEdit}
          locations={[]}
          models={[]}
          providers={providers}
          sections={["providers"]}
        />
      ) : null}

      {addType === "provider" ? (
        <div className="modal-backdrop">
          <section className="modal-panel" aria-label="Add provider">
            <div className="panel-head">
              <div><h2>Add provider</h2><p className="subtle">Create a client or report source.</p></div>
              <Link className="icon-button" href="/master/providers" scroll={false} aria-label="Close add provider">x</Link>
            </div>
            <form action={createProvider} className="form-grid">
              <label>Provider code<input className="field" name="code" placeholder="Enter provider code" required /></label>
              <label>Provider name<input className="field" name="name" placeholder="Enter provider name" required /></label>
              <label>Status<select className="select" name="is_active" defaultValue="active"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <div className="form-actions modal-actions">
                <Link className="button secondary" href="/master/providers" scroll={false}>Cancel</Link>
                <SubmitButton>Add provider</SubmitButton>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {editProvider ? (
        <div className="modal-backdrop">
          <section className="modal-panel" aria-label="Edit provider">
            <div className="panel-head">
              <div>
                <h2>Edit provider</h2>
                <p className="subtle">Internal ID stays hidden and unchanged.</p>
              </div>
              <Link className="icon-button" href="/master/providers" scroll={false} aria-label="Close edit provider">x</Link>
            </div>
            <form action={updateProvider} className="form-grid">
              <input type="hidden" name="id" value={editProvider.id} />
              <label>Provider code<input className="field" name="code" defaultValue={editProvider.code} required /></label>
              <label>Provider name<input className="field" name="name" defaultValue={editProvider.name} required /></label>
              <label>Status
                <select className="select" name="is_active" defaultValue={editProvider.is_active ? "active" : "inactive"}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <div className="form-actions">
                <SubmitButton>Save changes</SubmitButton>
                <Link className="button secondary" href="/master/providers" scroll={false}>Cancel</Link>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
