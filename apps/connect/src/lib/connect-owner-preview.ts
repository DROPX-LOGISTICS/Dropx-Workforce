import "server-only";

import { createHash } from "crypto";
import { cookies } from "next/headers";
import { connectSessionCookieName, isMissingColumnError, type ConnectAccount } from "./connect-auth";
import { normalizeMobile } from "./connect-otp";
import { supabaseAdmin } from "./supabase-admin";

export const connectPreviewCookieName = "dropx_connect_preview_account";

type SessionIdentity = { countryCode: string; mobile: string };

export async function connectSessionIdentity(): Promise<SessionIdentity | null> {
  if (!supabaseAdmin) return null;
  const token = cookies().get(connectSessionCookieName)?.value;
  if (!token) return null;
  const result = await supabaseAdmin.from("connect_login_sessions").select("country_code,mobile_number,expires_at,revoked_at").eq("session_hash", createHash("sha256").update(token).digest("hex")).maybeSingle();
  const row = result.data;
  if (result.error || !row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  return { countryCode: row.country_code, mobile: row.mobile_number };
}

export async function connectOwnerCompany(identity: SessionIdentity): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const countryCode = String(identity.countryCode).replace(/\D/g, "") || "91";
  const normalized = normalizeMobile(identity.mobile, countryCode);
  const local = normalized.startsWith(countryCode) ? normalized.slice(countryCode.length) : normalized;
  let profiles = await supabaseAdmin.from("profiles").select("id,company_id,role_id,is_master_owner,is_active").eq("is_active", true).or(`mobile.eq.${normalized},mobile.eq.${local}`);
  if (profiles.error && isMissingColumnError(profiles.error)) return null;
  if (profiles.error) throw new Error(profiles.error.message);
  const roleIds = [...new Set((profiles.data ?? []).map((row) => row.role_id).filter(Boolean))];
  const roles = roleIds.length ? await supabaseAdmin.from("user_roles").select("id,code").in("id", roleIds) : { data: [], error: null };
  if (roles.error) throw new Error(roles.error.message);
  const roleById = new Map((roles.data ?? []).map((row) => [row.id, String(row.code ?? "").toUpperCase()]));
  return (profiles.data ?? []).find((row) => row.is_master_owner || roleById.get(row.role_id) === "OWNER")?.company_id ?? null;
}

function first<T>(value: T | T[] | null | undefined): T | null { return Array.isArray(value) ? value[0] ?? null : value ?? null; }

export async function listConnectPreviewAccounts(companyId: string): Promise<ConnectAccount[]> {
  if (!supabaseAdmin) throw new Error("Database configuration is missing.");
  const [company, employees, workforce] = await Promise.all([
    supabaseAdmin.from("companies").select("name").eq("id", companyId).maybeSingle(),
    supabaseAdmin.from("employees").select("id,company_id,full_name,email,employee_code,biometric_id,profile_photo_path,profile_completion_status,designations(name)").eq("company_id", companyId).eq("is_active", true).is("deleted_at", null).order("full_name"),
    supabaseAdmin.from("workforce").select("id,company_id,full_name,email,dropx_id,biometric_id,profile_photo_path,onboarding_status,designation").eq("company_id", companyId).is("deleted_at", null).neq("migration_state", "reclassified").order("full_name")
  ]);
  const error = company.error ?? employees.error ?? workforce.error;
  if (error) throw new Error(error.message);
  const companyName = company.data?.name ?? "DropX";
  return [
    ...(employees.data ?? []).map((row): ConnectAccount => ({ id: row.id, companyId, profileType: "employee", name: row.full_name, email: row.email, reference: row.employee_code, role: first(row.designations)?.name ?? "Employee", status: row.profile_completion_status === "active" ? "Active" : "Active", biometricId: row.biometric_id, profilePhotoUrl: "", pageAccess: ["dashboard", "attendance", "leave", "settings"], isDefault: false, companyName, label: `${row.full_name} - ${row.employee_code ?? "Employee"}` })),
    ...(workforce.data ?? [])
      .filter((row) => !["rejected", "cancelled"].includes(String(row.onboarding_status ?? "pending").toLowerCase()))
      .map((row): ConnectAccount => ({ id: row.id, companyId, profileType: "workforce", name: row.full_name, email: row.email, reference: row.dropx_id, role: row.designation ?? "Workforce associate", status: row.onboarding_status === "active" ? "Active" : "Registration in progress", biometricId: row.biometric_id, profilePhotoUrl: "", pageAccess: ["dashboard", "payments", "advances"], isDefault: false, companyName, label: `${row.full_name} - ${row.dropx_id ?? "Workforce"}` }))
  ];
}

export async function activeConnectPreview() {
  const identity = await connectSessionIdentity();
  if (!identity) return { canPreviewUsers: false, account: null as ConnectAccount | null };
  const companyId = await connectOwnerCompany(identity);
  if (!companyId) return { canPreviewUsers: false, account: null as ConnectAccount | null };
  const value = cookies().get(connectPreviewCookieName)?.value ?? "";
  const [profileType, accountId, selectedCompanyId] = value.split(":");
  if (!value || selectedCompanyId !== companyId) return { canPreviewUsers: true, account: null as ConnectAccount | null };
  const accounts = await listConnectPreviewAccounts(companyId);
  const account = accounts.find((row) => row.profileType === profileType && row.id === accountId) ?? null;
  return { canPreviewUsers: true, account: account ? { ...account, isDefault: true } : null };
}
