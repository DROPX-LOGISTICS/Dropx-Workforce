import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MasterDataLists } from "@/components/master-data-lists";
import { PageHead } from "@/components/page-head";
import { SearchableSelect } from "@/components/searchable-select";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { createLocationModel, updateLocationModel } from "../../settings/actions";

type ProviderRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type ModelRow = {
  id: string;
  provider_id: string | null;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  providers?: { code: string; name: string } | null;
};

type RawModelRow = Omit<ModelRow, "providers"> & {
  providers?: { code: string; name: string } | { code: string; name: string }[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function loadModels(companyId: string) {
  if (!supabaseAdmin) {
    return {
      models: [] as ModelRow[],
      providers: [] as ProviderRow[],
      error: "Supabase service role key is not configured."
    };
  }

  const [providersResult, modelsResult] = await Promise.all([
    supabaseAdmin
      .from("providers")
      .select("id, code, name, is_active")
      .eq("company_id", companyId)
      .order("code"),
    supabaseAdmin
      .from("location_models")
      .select(`
        id,
        provider_id,
        code,
        name,
        description,
        is_active,
        providers (code, name)
      `)
      .eq("company_id", companyId)
      .order("code")
  ]);

  const rawModels = (modelsResult.data ?? []) as unknown as RawModelRow[];

  return {
    providers: (providersResult.data ?? []) as ProviderRow[],
    models: rawModels.map((row) => ({
      ...row,
      providers: firstRelation(row.providers)
    })) as ModelRow[],
    error: providersResult.error?.message || modelsResult.error?.message || null
  };
}

export const dynamic = "force-dynamic";

type ModelsPageProps = {
  searchParams?: {
    add?: string;
    edit?: string;
  };
};

export default async function ModelsPage({ searchParams }: ModelsPageProps) {
  const authorization = await requirePagePermission("master_models", "access");
  const companyId = requireCompanyId(authorization);
  const pagePermission = authorization.permissions.master_models;
  const { providers, models, error } = await loadModels(companyId);
  const addType = pagePermission.canAdd ? searchParams?.add : null;
  const [editType, editId] = (searchParams?.edit ?? "").split(":");
  const editModel = pagePermission.canEdit && editType === "model" ? models.find((row) => row.id === editId) : null;
  const providerOptions = providers.map((provider) => ({
    value: provider.id,
    label: provider.name,
    helper: provider.code
  }));

  return (
    <AppShell active="Models" pageCode="master_models">
      <PageHead
        eyebrow="Setup"
        title="Models"
        subtitle="Maintain location operating models linked to providers."
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
          models={models}
          providers={providers}
          sections={["models"]}
        />
      ) : null}

      {addType === "model" ? (
        <div className="modal-backdrop">
          <section className="modal-panel" aria-label="Add model">
            <div className="panel-head">
              <div><h2>Add model</h2><p className="subtle">Create an operating model for a location.</p></div>
              <Link className="icon-button" href="/master/models" scroll={false} aria-label="Close add model">x</Link>
            </div>
            <form action={createLocationModel} className="form-grid">
              <label>Provider<SearchableSelect name="provider_id" options={providerOptions} placeholder="Search provider" required /></label>
              <label>Model code<input className="field" name="code" placeholder="Enter model code" required /></label>
              <label>Model name<input className="field" name="name" placeholder="Enter model name" required /></label>
              <label>Description<input className="field" name="description" placeholder="Enter description" /></label>
              <div className="form-actions modal-actions">
                <Link className="button secondary" href="/master/models" scroll={false}>Cancel</Link>
                <SubmitButton>Add model</SubmitButton>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {editModel ? (
        <div className="modal-backdrop">
          <section className="modal-panel" aria-label="Edit model">
            <div className="panel-head">
              <div>
                <h2>Edit model</h2>
                <p className="subtle">Linked records use this hidden model ID, not the editable code.</p>
              </div>
              <Link className="icon-button" href="/master/models" scroll={false} aria-label="Close edit model">x</Link>
            </div>
            <form action={updateLocationModel} className="form-grid">
              <input type="hidden" name="id" value={editModel.id} />
              <label>Provider
                <SearchableSelect name="provider_id" options={providerOptions} defaultValue={editModel.provider_id} placeholder="Search provider" required />
              </label>
              <label>Model code<input className="field" name="code" defaultValue={editModel.code} required /></label>
              <label>Model name<input className="field" name="name" defaultValue={editModel.name} required /></label>
              <label>Description<input className="field" name="description" defaultValue={editModel.description ?? ""} /></label>
              <label>Status
                <select className="select" name="is_active" defaultValue={editModel.is_active ? "active" : "inactive"}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <div className="form-actions">
                <SubmitButton>Save changes</SubmitButton>
                <Link className="button secondary" href="/master/models" scroll={false}>Cancel</Link>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
