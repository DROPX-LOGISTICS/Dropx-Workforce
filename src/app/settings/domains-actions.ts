"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function redirectWithFlash(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_domains_settings_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect("/settings/domains");
}

function normalizeDomain(value: FormDataEntryValue | null) {
  let domain = String(value ?? "").trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^@/, "");
  domain = domain.split("/")[0].split(":")[0].trim();
  return domain;
}

function isValidDomain(domain: string) {
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain);
}

function getEmailDomain(email: string | null | undefined) {
  return String(email ?? "").trim().toLowerCase().split("@").pop() ?? "";
}

async function loadActiveDomains(companyId: string) {
  if (!supabaseAdmin) return [] as string[];
  const { data, error } = await supabaseAdmin
    .from("company_allowed_domains")
    .select("domain")
    .eq("company_id", companyId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => String(row.domain ?? "").trim().toLowerCase())
    .filter(Boolean);
}

async function hasActiveOwnerInDomains(companyId: string, domains: string[]) {
  if (!supabaseAdmin) return false;
  const allowedDomains = new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean));
  if (!allowedDomains.size) return true;

  const { data: ownerRoles, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("id")
    .eq("company_id", companyId)
    .eq("code", "OWNER")
    .eq("is_active", true);
  if (roleError) throw new Error(roleError.message);

  const ownerRoleIds = (ownerRoles ?? []).map((role) => role.id).filter(Boolean);
  if (!ownerRoleIds.length) return false;

  const { data: owners, error: ownerError } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .in("role_id", ownerRoleIds);
  if (ownerError) throw new Error(ownerError.message);

  return (owners ?? []).some((owner) => allowedDomains.has(getEmailDomain(owner.email)));
}

async function assertOwnerCanLoginWithDomains(companyId: string, domains: string[]) {
  const hasOwner = await hasActiveOwnerInDomains(companyId, domains);
  if (!hasOwner) {
    throw new Error("At least one active Owner user must have an email under an active allowed domain before enabling domain restriction.");
  }
}

export async function addAllowedDomain(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "add");
  const companyId = requireCompanyId(authorization);

  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const domain = normalizeDomain(formData.get("domain"));
    if (!domain) throw new Error("Enter a domain.");
    if (!isValidDomain(domain)) throw new Error("Enter a valid email domain, for example dropxlogistics.com.");

    const nextDomains = Array.from(new Set([...(await loadActiveDomains(companyId)), domain]));
    await assertOwnerCanLoginWithDomains(companyId, nextDomains);

    const { error } = await supabaseAdmin
      .from("company_allowed_domains")
      .upsert({
        company_id: companyId,
        domain,
        is_active: true,
        updated_by: authorization.userId
      }, { onConflict: "company_id,domain" });

    if (error) throw new Error(error.message);

    revalidatePath("/settings");
    revalidatePath("/settings/domains");
  } catch (error) {
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to save domain." });
  }

  redirectWithFlash({ notice: "Domain saved." });
}

export async function setAllowedDomainStatus(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);

  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const id = String(formData.get("id") ?? "").trim();
    const isActive = String(formData.get("is_active") ?? "") === "true";
    if (!id) throw new Error("Domain record is missing.");

    const { data: selectedDomain, error: selectedDomainError } = await supabaseAdmin
      .from("company_allowed_domains")
      .select("domain")
      .eq("company_id", companyId)
      .eq("id", id)
      .single();
    if (selectedDomainError) throw new Error(selectedDomainError.message);

    const activeDomains = await loadActiveDomains(companyId);
    const domain = String(selectedDomain.domain ?? "").trim().toLowerCase();
    const nextDomains = isActive
      ? Array.from(new Set([...activeDomains, domain]))
      : activeDomains.filter((item) => item !== domain);
    if (nextDomains.length) await assertOwnerCanLoginWithDomains(companyId, nextDomains);

    const { error } = await supabaseAdmin
      .from("company_allowed_domains")
      .update({ is_active: isActive, updated_by: authorization.userId })
      .eq("company_id", companyId)
      .eq("id", id);

    if (error) throw new Error(error.message);

    revalidatePath("/settings");
    revalidatePath("/settings/domains");
  } catch (error) {
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to update domain." });
  }

  redirectWithFlash({ notice: "Domain updated." });
}
