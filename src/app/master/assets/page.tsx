import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { saveAssetCategory, saveAssetType } from "./actions";

export const dynamic = "force-dynamic";

export default async function AssetMastersPage() {
  const auth = await requirePagePermission("master_asset_types", "access");
  const companyId = requireCompanyId(auth);
  const [{ data: categories, error: categoryError }, { data: types, error: typeError }] = await Promise.all([
    supabaseAdmin!.from("asset_categories").select("id,code,name,description,parent_category_id,is_active").eq("company_id", companyId).order("name"),
    supabaseAdmin!.from("asset_types").select("id,code,name,description,category_id,asset_code_prefix,useful_life_months,requires_serial_number,is_active").eq("company_id", companyId).order("name")
  ]);
  if (categoryError || typeError) throw new Error(categoryError?.message ?? typeError?.message);
  const categoryById = new Map((categories ?? []).map((item) => [item.id, item.name]));

  return <AppShell active="Asset Categories" pageCode="master_asset_types">
    <PageHead eyebrow="Master Data" title="Asset categories & types" subtitle="Define the catalogue used for laptops, scanners, furniture, tools, cables and every other serialized company asset." />
    <section className="asset-master-grid">
      <article className="panel">
        <div className="panel-head"><div><h2>Categories</h2><p className="subtle">Group related assets and optionally create a parent-child structure.</p></div></div>
        {auth.permissions.master_asset_types.canAdd ? <form action={saveAssetCategory} className="panel-body form-grid two">
          <label>Category code<input className="field" name="code" placeholder="IT" required /></label>
          <label>Category name<input className="field" name="name" placeholder="Information Technology" required /></label>
          <label>Parent category<select className="select" name="parent_category_id"><option value="">None</option>{categories?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>Description<input className="field" name="description" placeholder="Optional description" /></label>
          <div className="form-actions"><SubmitButton pendingText="Adding">Add category</SubmitButton></div>
        </form> : null}
        <div className="table-wrap"><table><thead><tr><th>Code</th><th>Category</th><th>Parent</th><th>Status</th></tr></thead><tbody>
          {categories?.map((category) => <tr key={category.id}><td><strong>{category.code}</strong></td><td>{category.name}</td><td>{category.parent_category_id ? categoryById.get(category.parent_category_id) : "—"}</td><td><span className={`status-pill ${category.is_active ? "good" : "bad"}`}>{category.is_active ? "Active" : "Inactive"}</span></td></tr>)}
          {!categories?.length ? <tr><td className="empty-cell" colSpan={4}>No categories yet.</td></tr> : null}
        </tbody></table></div>
      </article>
      <article className="panel">
        <div className="panel-head"><div><h2>Asset types</h2><p className="subtle">Set the code prefix, useful life and serial-number requirement.</p></div></div>
        {auth.permissions.master_asset_types.canAdd ? <form action={saveAssetType} className="panel-body form-grid two">
          <label>Category<select className="select" name="category_id" required><option value="">Select category</option>{categories?.filter((category) => category.is_active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>Type code<input className="field" name="code" placeholder="LAPTOP" required /></label>
          <label>Type name<input className="field" name="name" placeholder="Laptop" required /></label>
          <label>Asset code prefix<input className="field" name="asset_code_prefix" defaultValue="DXA" maxLength={10} required /></label>
          <label>Useful life (months)<input className="field" min="1" max="600" name="useful_life_months" type="number" /></label>
          <label>Description<input className="field" name="description" /></label>
          <label className="check-row"><input name="requires_serial_number" type="checkbox" value="true" /><span>Serial number required</span></label>
          <div className="form-actions"><SubmitButton disabled={!categories?.length} pendingText="Adding">Add asset type</SubmitButton></div>
        </form> : null}
        <div className="table-wrap"><table><thead><tr><th>Type</th><th>Category</th><th>Prefix</th><th>Controls</th><th>Status</th></tr></thead><tbody>
          {types?.map((type) => <tr key={type.id}><td><strong>{type.name}</strong><br/><span className="subtle">{type.code}</span></td><td>{categoryById.get(type.category_id)}</td><td>{type.asset_code_prefix}</td><td>{type.requires_serial_number ? "Serial required" : "Serial optional"}{type.useful_life_months ? ` · ${type.useful_life_months} months` : ""}</td><td><span className={`status-pill ${type.is_active ? "good" : "bad"}`}>{type.is_active ? "Active" : "Inactive"}</span></td></tr>)}
          {!types?.length ? <tr><td className="empty-cell" colSpan={5}>No asset types yet.</td></tr> : null}
        </tbody></table></div>
      </article>
    </section>
  </AppShell>;
}
