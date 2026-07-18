import type { AuthorizationContext } from "@/lib/authorization";

type FilterableQuery<T> = {
  eq: (column: string, value: string) => T;
};

export function requireCompanyId(authorization: Pick<AuthorizationContext, "companyId">) {
  if (!authorization.companyId) {
    throw new Error("Company access is not configured for this user.");
  }
  return authorization.companyId;
}

export function scopeCompany<T extends FilterableQuery<T>>(query: T, companyId: string) {
  return query.eq("company_id", companyId);
}

export function withCompany<T extends Record<string, unknown>>(payload: T, companyId: string) {
  return { ...payload, company_id: companyId };
}
