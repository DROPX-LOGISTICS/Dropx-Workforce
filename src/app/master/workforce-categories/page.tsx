import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { WorkforceCategoryForm, type WorkforceCategoryInitial } from "@/components/workforce-category-form";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createWorkforceCategory, deleteWorkforceCategory, forceDeleteWorkersCategory, updateWorkforceCategory } from "./actions";

function loadFlash() {
  const raw = cookies().get("dropx_workforce_category_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return {
      error: typeof parsed.error === "string" ? parsed.error : null,
      notice: typeof parsed.notice === "string" ? parsed.notice : null
    };
  } catch {
    return { error: null, notice: null };
  }
}

export const dynamic = "force-dynamic";
const categoryPath = "/delivery-network/engagement-types";

function isMissingCategoryColumn(message?: string) {
  const text = String(message ?? "").toLowerCase();
  return (text.includes("statutory_enabled") || text.includes("direct_activate")) && (text.includes("column") || text.includes("schema cache"));
}

export default async function WorkforceCategoriesPage({
  searchParams
}: {
  searchParams?: { add?: string; edit?: string; q?: string };
}) {
  const authorization = await requirePagePermission("workforce_categories", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.designations;
  let result = supabaseAdmin
    ? await supabaseAdmin
      .from("workforce_categories")
      .select("id, code, name, profile_field_rules, app_page_access, statutory_enabled, direct_activate, is_system, is_active")
      .eq("company_id", companyId)
      .order("sort_order")
      .order("name")
    : { data: null, error: { message: "Supabase service role key is not configured." } };
  if (supabaseAdmin && isMissingCategoryColumn(result.error?.message)) {
    const fallback = await supabaseAdmin
      .from("workforce_categories")
      .select("id, code, name, profile_field_rules, app_page_access, is_system, is_active")
      .eq("company_id", companyId)
      .order("sort_order")
      .order("name");
    result = {
      ...fallback,
      data: (fallback.data ?? []).map((category) => ({
        ...category,
        statutory_enabled: category.code === "employees",
        direct_activate: false
      }))
    } as typeof result;
  }
  const categories = ((result.data ?? []) as WorkforceCategoryInitial[])
    .filter((category) => category.code !== "employees" && category.code !== "field_executives")
    .map((category) => category.code === "contractors" ? { ...category, name: "Workforce" } : category);
  const query = String(searchParams?.q ?? "").trim().toLowerCase();
  const filtered = categories.filter((category) => `${category.code} ${category.name}`.toLowerCase().includes(query));
  const editing = categories.find((category) => category.id === searchParams?.edit) ?? null;
  const flash = loadFlash();

  return (
    <AppShell active="Registration Policies" pageCode="workforce_categories">
      <PageHead
        eyebrow="Master Data"
        title="Registration Policies"
        subtitle="Configure onboarding rules used by Workforce designations. All resulting profiles stay in the canonical Workforce table; People/HR employee rules are excluded."
      />

      {result.error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{result.error.message} Run `scripts/workforce_categories_master_v1.sql` in Supabase SQL Editor.</p>
          </div>
        </section>
      ) : null}

      {!result.error && (flash.error || flash.notice) ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{flash.error ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p>
          </div>
        </section>
      ) : null}

      {!result.error ? (
        <section className="panel">
          <div className="panel-head toolbar">
            <div>
              <h2>Registration policy list</h2>
              <p className="subtle">{filtered.length} of {categories.length} records</p>
            </div>
            <div className="master-toolbar">
              <form action={categoryPath} className="inline-search">
                <input className="field" defaultValue={searchParams?.q ?? ""} name="q" placeholder="Search registration policy" />
                <button className="button secondary compact" type="submit">Search</button>
              </form>
              {permission.canAdd ? <PendingLink className="button compact" href={`${categoryPath}?add=1`} scroll={false}>Add registration policy</PendingLink> : null}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Registration policy</th><th>Activation</th><th>Type</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {filtered.map((category) => (
                  <tr key={category.id}>
                    <td><strong>{category.code === "contractors" ? "workforce" : category.code}</strong></td>
                    <td>{category.name}</td>
                    <td>{category.direct_activate ? "Direct" : "App onboarding"}</td>
                    <td>{category.is_system ? "System" : "Custom"}</td>
                    <td><StatusPill status={category.is_active ? "Active" : "Inactive"} /></td>
                    <td>{permission.canEdit ? <PendingLink className="button secondary compact" href={`${categoryPath}?edit=${category.id}`} scroll={false}>Edit</PendingLink> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!result.error && searchParams?.add === "1" && permission.canAdd ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide designation-modal">
            <div className="panel-head">
              <div><h2>Add registration policy</h2><p className="subtle">Define reusable onboarding fields for Workforce designations.</p></div>
              <PendingLink className="icon-button" href={categoryPath} scroll={false} aria-label="Close">x</PendingLink>
            </div>
            <WorkforceCategoryForm action={createWorkforceCategory} submitLabel="Add registration policy" />
          </section>
        </div>
      ) : null}

      {!result.error && editing && permission.canEdit ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide designation-modal">
            <div className="panel-head">
              <div><h2>Edit registration policy</h2><p className="subtle">These rules apply to every Workforce designation assigned to this policy.</p></div>
              <PendingLink className="icon-button" href={categoryPath} scroll={false} aria-label="Close">x</PendingLink>
            </div>
            <WorkforceCategoryForm action={updateWorkforceCategory} initial={editing} submitLabel="Save changes" />
            {!editing.is_system ? (
              <form action={deleteWorkforceCategory} className="danger-form">
                <input name="id" type="hidden" value={editing.id} />
                <SubmitButton
                  className="button danger"
                  confirmDescription="This is available only when no designation or Workforce record uses the registration policy."
                  confirmMessage={`Delete ${editing.name}? The registration policy will be removed from onboarding and designation settings.`}
                  confirmSubmitText="Delete registration policy"
                  pendingText="Deleting"
                >
                  Delete registration policy
                </SubmitButton>
              </form>
            ) : null}
            {editing.code === "workers" && (authorization.isMasterOwner || authorization.roleCode === "OWNER") ? (
              <form action={forceDeleteWorkersCategory} className="danger-form">
                <input name="id" type="hidden" value={editing.id} />
                <SubmitButton
                  className="button danger"
                  confirmDescription="Workers will be removed from all designation policy lists. Historical Workforce records will be retained."
                  confirmMessage="Force delete Workers registration policy?"
                  confirmSubmitText="Force delete"
                  pendingText="Deleting"
                >
                  Force delete registration policy
                </SubmitButton>
              </form>
            ) : null}
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
