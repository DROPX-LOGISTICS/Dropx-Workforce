import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { StatusPill } from "@/components/status-pill";
import { WorkforceCategoryForm, type WorkforceCategoryInitial } from "@/components/workforce-category-form";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createWorkforceCategory, updateWorkforceCategory } from "./actions";

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

export default async function WorkforceCategoriesPage({
  searchParams
}: {
  searchParams?: { add?: string; edit?: string; q?: string };
}) {
  const authorization = await requirePagePermission("designations", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.designations;
  const result = supabaseAdmin
    ? await supabaseAdmin
      .from("workforce_categories")
      .select("id, code, name, profile_field_rules, app_page_access, is_system, is_active")
      .eq("company_id", companyId)
      .order("sort_order")
      .order("name")
    : { data: null, error: { message: "Supabase service role key is not configured." } };
  const categories = (result.data ?? []) as WorkforceCategoryInitial[];
  const query = String(searchParams?.q ?? "").trim().toLowerCase();
  const filtered = categories.filter((category) => `${category.code} ${category.name}`.toLowerCase().includes(query));
  const editing = categories.find((category) => category.id === searchParams?.edit) ?? null;
  const flash = loadFlash();

  return (
    <AppShell active="Workforce Categories" pageCode="designations">
      <PageHead
        eyebrow="Master Data"
        title="Workforce Categories"
        subtitle="Configure onboarding fields once per workforce category, then assign categories to designations."
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
              <h2>Category list</h2>
              <p className="subtle">{filtered.length} of {categories.length} records</p>
            </div>
            <div className="master-toolbar">
              <form action="/master/workforce-categories" className="inline-search">
                <input className="field" defaultValue={searchParams?.q ?? ""} name="q" placeholder="Search category" />
                <button className="button secondary compact" type="submit">Search</button>
              </form>
              {permission.canAdd ? <PendingLink className="button compact" href="/master/workforce-categories?add=1" scroll={false}>Add category</PendingLink> : null}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Category</th><th>App pages</th><th>Type</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {filtered.map((category) => (
                  <tr key={category.id}>
                    <td><strong>{category.code}</strong></td>
                    <td>{category.name}</td>
                    <td>{[
                      ...(category.app_page_access ?? [])
                        .filter((page) => page === "dashboard" || page === "attendance")
                        .map((page) => page.replaceAll("_", " ")),
                      "settings",
                      "my profile"
                    ].join(", ")}</td>
                    <td>{category.is_system ? "System" : "Custom"}</td>
                    <td><StatusPill status={category.is_active ? "Active" : "Inactive"} /></td>
                    <td>{permission.canEdit ? <PendingLink className="button secondary compact" href={`/master/workforce-categories?edit=${category.id}`} scroll={false}>Edit</PendingLink> : "-"}</td>
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
              <div><h2>Add workforce category</h2><p className="subtle">Define the category and its onboarding fields.</p></div>
              <PendingLink className="icon-button" href="/master/workforce-categories" scroll={false} aria-label="Close">x</PendingLink>
            </div>
            <WorkforceCategoryForm action={createWorkforceCategory} submitLabel="Add category" />
          </section>
        </div>
      ) : null}

      {!result.error && editing && permission.canEdit ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide designation-modal">
            <div className="panel-head">
              <div><h2>Edit workforce category</h2><p className="subtle">These rules apply to every designation assigned to this category.</p></div>
              <PendingLink className="icon-button" href="/master/workforce-categories" scroll={false} aria-label="Close">x</PendingLink>
            </div>
            <WorkforceCategoryForm action={updateWorkforceCategory} initial={editing} submitLabel="Save changes" />
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
