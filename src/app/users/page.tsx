import { AppShell } from "@/components/app-shell";
import { AddUserForm } from "@/components/add-user-form";
import { DismissibleModal, DismissModalButton } from "@/components/dismissible-modal";
import { ManageUserForm } from "@/components/manage-user-form";
import { PageHead } from "@/components/page-head";
import { PermissionMatrix } from "@/components/permission-matrix";
import { SearchableSelect } from "@/components/searchable-select";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { UsersListPanel } from "@/components/users-list-panel";
import { accessSurfaceLabel, currentAccessSurface, pageBelongsToSurface } from "@/lib/access-surface";
import { accessPages, ensureAccessPages } from "@/lib/access-pages";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { configureWorkforceDesignationRole, configureWorkforceLocationRole, createUserRole, deleteUser, deleteUserRole, updateUserRole } from "./actions";

type AppPageRow = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

type UserRoleRow = {
  id: string;
  code: string;
  name: string;
  product_code: string | null;
  location_access_mode: "all_locations" | "role_based";
  parent_role_id: string | null;
  is_system: boolean;
  is_active: boolean;
};

type RolePermissionRow = {
  role_id: string;
  page_id: string;
  can_view: boolean;
  can_add: boolean;
  can_edit: boolean;
};

type UserRow = {
  id: string;
  employee_id: string | null;
  full_name: string | null;
  email: string | null;
  mobile_country_code?: string | null;
  mobile: string | null;
  role_id: string | null;
  role: string;
  reports_to_user_id: string | null;
  location_scope_ids: string[] | null;
  invite_method: string | null;
  is_active: boolean;
  confirmed_at?: string | null;
  email_confirmed_at?: string | null;
  invited_at?: string | null;
  last_sign_in_at?: string | null;
  identity_verified?: boolean;
};

type LocationRow = {
  id: string;
  station_code: string;
  station_name: string | null;
  city: string | null;
  state: string | null;
  station_email: string | null;
  station_manager_email: string | null;
  hide_from_location_list?: boolean | null;
  is_active: boolean;
  providers?: { name: string } | null;
  location_models?: { code: string; name: string } | null;
};

type RawLocationRow = Omit<LocationRow, "providers" | "location_models"> & {
  providers?: { name: string } | { name: string }[] | null;
  location_models?: { code: string; name: string } | { code: string; name: string }[] | null;
};

type PeopleDesignationRow = {
  id: string;
  code: string;
  name: string;
};

type WorkforceDesignationAccessRow = PeopleDesignationRow & {
  enabled: boolean;
  defaultRoleId: string | null;
};

type PeoplePersonRow = {
  id: string;
  worker_type: "employee" | "contractor";
  worker_code: string | null;
  full_name: string | null;
  email: string | null;
  mobile_country_code: string | null;
  mobile: string | null;
  designation_id: string | null;
};

type UsersPageProps = {
  searchParams?: {
    addUser?: string;
    addRole?: string;
    editUser?: string;
    editRole?: string;
    userPage?: string;
    userRole?: string;
    userSearch?: string;
    userType?: string;
    userError?: string;
    userNotice?: string;
    section?: string;
  };
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isMissingCompanyColumn(error: unknown) {
  if (!error) return false;
  const message =
    typeof error === "object" && "message" in error
      ? String((error as { message?: string }).message ?? "")
      : String(error);
  const normalized = message.toLowerCase();

  return (
    normalized.includes("company_id") &&
    (normalized.includes("does not exist") || normalized.includes("schema cache"))
  );
}

function isMissingColumnError(error: unknown) {
  if (!error) return false;
  const message =
    typeof error === "object" && "message" in error
      ? String((error as { message?: string }).message ?? "")
      : String(error);
  const normalized = message.toLowerCase();

  return normalized.includes("column") &&
    (normalized.includes("does not exist") || normalized.includes("schema cache"));
}

function permissionText(role: UserRoleRow, permissions: RolePermissionRow[]) {
  const rolePermissions = permissions.filter((permission) => permission.role_id === role.id);
  const viewCount = rolePermissions.filter((permission) => permission.can_view).length;
  const addCount = rolePermissions.filter((permission) => permission.can_add).length;
  const editCount = rolePermissions.filter((permission) => permission.can_edit).length;

  return `${viewCount} view / ${addCount} add / ${editCount} edit`;
}

function descendantRoleIds(roles: UserRoleRow[], rootId: string) {
  const descendants = new Set<string>();
  let added = true;

  while (added) {
    added = false;
    roles.forEach((role) => {
      if (role.parent_role_id === rootId || (role.parent_role_id && descendants.has(role.parent_role_id))) {
        if (!descendants.has(role.id)) {
          descendants.add(role.id);
          added = true;
        }
      }
    });
  }

  return descendants;
}

function descendantUserIds(users: UserRow[], rootId: string) {
  const descendants = new Set<string>();
  let added = true;

  while (added) {
    added = false;
    users.forEach((user) => {
      if (user.reports_to_user_id === rootId || (user.reports_to_user_id && descendants.has(user.reports_to_user_id))) {
        if (!descendants.has(user.id)) {
          descendants.add(user.id);
          added = true;
        }
      }
    });
  }

  return descendants;
}

function userStatus(user: UserRow) {
  if (!user.is_active) return "Inactive";
  const hasAcceptedInvite = Boolean(
    user.confirmed_at ||
    user.email_confirmed_at ||
    user.last_sign_in_at ||
    user.identity_verified
  );
  if (user.invited_at && !hasAcceptedInvite) return "Invitation Pending";
  return "Active";
}

function usersReturnHref(searchParams: UsersPageProps["searchParams"]) {
  const params = new URLSearchParams();
  params.set("section", "users");
  const page = Number(searchParams?.userPage ?? "1");
  if (Number.isFinite(page) && page > 1) {
    params.set("userPage", String(Math.floor(page)));
  }
  if (searchParams?.userRole) params.set("userRole", searchParams.userRole);
  if (searchParams?.userSearch) params.set("userSearch", searchParams.userSearch);
  if (searchParams?.userType) params.set("userType", searchParams.userType);

  const query = params.toString();
  return `/users${query ? `?${query}` : ""}`;
}

function sectionHref(section: "roles" | "users", params?: Record<string, string>) {
  const search = new URLSearchParams({ section });
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  return `/users?${search.toString()}`;
}

async function loadPeopleAccessDirectory(companyId: string) {
  if (!supabaseAdmin) {
    return {
      designations: [] as PeopleDesignationRow[],
      people: [] as PeoplePersonRow[],
      error: "Supabase service role key is not configured."
    };
  }

  const categoriesResult = await supabaseAdmin
    .from("designation_categories")
    .select("id")
    .eq("company_id", companyId)
    .eq("people_module", "people_hr")
    .eq("is_active", true);
  if (categoriesResult.error) {
    return { designations: [] as PeopleDesignationRow[], people: [] as PeoplePersonRow[], error: categoriesResult.error.message };
  }

  const categoryIds = (categoriesResult.data ?? []).map((category) => category.id);
  if (!categoryIds.length) return { designations: [] as PeopleDesignationRow[], people: [] as PeoplePersonRow[], error: null };

  const policiesResult = await supabaseAdmin
    .from("designation_product_access_policies")
    .select("designation_id")
    .eq("company_id", companyId)
    .eq("product_code", "workforce")
    .eq("is_enabled", true);
  if (policiesResult.error) {
    return { designations: [] as PeopleDesignationRow[], people: [] as PeoplePersonRow[], error: policiesResult.error.message };
  }
  const enabledDesignationIds = [...new Set((policiesResult.data ?? []).map((policy) => policy.designation_id))];
  if (!enabledDesignationIds.length) return { designations: [] as PeopleDesignationRow[], people: [] as PeoplePersonRow[], error: null };

  const designationsResult = await supabaseAdmin
    .from("designations")
    .select("id, code, name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .in("designation_category_id", categoryIds)
    .in("id", enabledDesignationIds)
    .order("name");
  if (designationsResult.error) {
    return { designations: [] as PeopleDesignationRow[], people: [] as PeoplePersonRow[], error: designationsResult.error.message };
  }

  const designations = (designationsResult.data ?? []) as PeopleDesignationRow[];
  if (!designations.length) return { designations, people: [] as PeoplePersonRow[], error: null };

  const people: PeoplePersonRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const peopleResult = await supabaseAdmin
      .from("employees")
      .select("id, employee_code, full_name, email, mobile_country_code, mobile, designation_id")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .in("designation_id", designations.map((designation) => designation.id))
      .order("full_name")
      .range(offset, offset + pageSize - 1);
    if (peopleResult.error) return { designations, people: [] as PeoplePersonRow[], error: peopleResult.error.message };
    const rows = peopleResult.data ?? [];
    people.push(...rows.map((row) => ({
      id: row.id,
      worker_type: "employee" as const,
      worker_code: row.employee_code,
      full_name: row.full_name,
      email: row.email,
      mobile_country_code: row.mobile_country_code,
      mobile: row.mobile,
      designation_id: row.designation_id
    })));
    if (rows.length < pageSize) break;
  }

  const today = new Date().toISOString().slice(0, 10);
  const assignmentResult = await supabaseAdmin
    .from("hr_work_assignments")
    .select("engagement_id, designation_id")
    .eq("company_id", companyId)
    .eq("is_primary", true)
    .in("designation_id", designations.map((designation) => designation.id))
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`);
  if (assignmentResult.error) return { designations, people, error: assignmentResult.error.message };

  const designationByEngagement = new Map((assignmentResult.data ?? []).map((assignment) => [assignment.engagement_id, assignment.designation_id]));
  const engagementIds = [...designationByEngagement.keys()];
  if (engagementIds.length) {
    const engagementResult = await supabaseAdmin
      .from("hr_engagements")
      .select("id, contractor_id")
      .eq("company_id", companyId)
      .eq("worker_type", "contractor")
      .eq("status", "active")
      .in("id", engagementIds);
    if (engagementResult.error) return { designations, people, error: engagementResult.error.message };
    const designationByContractor = new Map(
      (engagementResult.data ?? [])
        .filter((engagement) => engagement.contractor_id)
        .map((engagement) => [engagement.contractor_id as string, designationByEngagement.get(engagement.id) ?? null])
    );
    const contractorIds = [...designationByContractor.keys()];
    for (let offset = 0; contractorIds.length && offset < contractorIds.length; offset += pageSize) {
      const contractorResult = await supabaseAdmin
        .from("contractors")
        .select("id, dropx_id, full_name, email, mobile_country_code, mobile")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .in("id", contractorIds.slice(offset, offset + pageSize));
      if (contractorResult.error) return { designations, people, error: contractorResult.error.message };
      people.push(...(contractorResult.data ?? []).map((row) => ({
        id: row.id,
        worker_type: "contractor" as const,
        worker_code: row.dropx_id,
        full_name: row.full_name,
        email: row.email,
        mobile_country_code: row.mobile_country_code,
        mobile: row.mobile,
        designation_id: designationByContractor.get(row.id) ?? null
      })));
    }
  }

  return { designations, people: people.sort((left, right) => (left.full_name ?? "").localeCompare(right.full_name ?? "")), error: null };
}

async function loadWorkforceDesignationAccess(companyId: string) {
  if (!supabaseAdmin) return { rows: [] as WorkforceDesignationAccessRow[], error: "Supabase service role key is not configured." };
  const [designations, policies] = await Promise.all([
    supabaseAdmin.from("designations")
      .select("id,code,name,designation_category:designation_categories!designations_designation_category_id_fkey!inner(people_module,is_active)")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .eq("designation_category.people_module", "people_hr")
      .eq("designation_category.is_active", true)
      .order("name"),
    supabaseAdmin.from("designation_product_access_policies")
      .select("designation_id,is_enabled,default_role_id")
      .eq("company_id", companyId)
      .eq("product_code", "workforce")
  ]);
  if (designations.error || policies.error) return { rows: [], error: designations.error?.message ?? policies.error?.message ?? "Designation access could not be loaded." };
  const policyByDesignation = new Map((policies.data ?? []).map((policy) => [policy.designation_id, policy]));
  return {
    rows: (designations.data ?? []).map((designation) => {
      const policy = policyByDesignation.get(designation.id);
      return {
        id: designation.id,
        code: designation.code,
        name: designation.name,
        enabled: Boolean(policy?.is_enabled),
        defaultRoleId: policy?.default_role_id ?? null
      };
    }),
    error: null as string | null
  };
}

async function loadAccessData(
  companyId: string,
  surface: ReturnType<typeof currentAccessSurface>,
  options: { includeUsers: boolean; includeRoleEditorData: boolean }
) {
  if (!supabaseAdmin) {
    return {
      pages: accessPages
        .filter((page) => pageBelongsToSurface(page.code, surface))
        .map((page) => ({ ...page, id: page.code, is_active: true })) as AppPageRow[],
      roles: [] as UserRoleRow[],
      permissions: [] as RolePermissionRow[],
      users: [] as UserRow[],
      locations: [] as LocationRow[],
      error: "Supabase service role key is not configured."
    };
  }

  await ensureAccessPages(supabaseAdmin, companyId);
  const client = supabaseAdmin;

  const pagesPromise = (async () => {
    let result = await client
      .from("app_pages")
      .select("id, code, name, sort_order, is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("sort_order");
    if (isMissingCompanyColumn(result.error)) {
      result = await client
        .from("app_pages")
        .select("id, code, name, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order");
    }
    if (!result.error && !(result.data ?? []).length) {
      result = await client
        .from("app_pages")
        .select("id, code, name, sort_order, is_active")
        .in("code", accessPages.map((page) => page.code))
        .is("company_id", null)
        .eq("is_active", true)
        .order("sort_order");
    }
    return result;
  })();

  const rolesPromise = (async () => {
    let result = await client
      .from("user_roles")
      .select("id, code, name, product_code, location_access_mode, parent_role_id, is_system, is_active")
      .eq("company_id", companyId)
      .order("code");
    if (isMissingCompanyColumn(result.error)) {
      result = await client
        .from("user_roles")
        .select("id, code, name, product_code, location_access_mode, parent_role_id, is_system, is_active")
        .order("code");
    }
    if (!result.error && !(result.data ?? []).length) {
      result = await client
        .from("user_roles")
        .select("id, code, name, product_code, location_access_mode, parent_role_id, is_system, is_active")
        .eq("is_active", true)
        .order("code");
    }
    return result;
  })();

  const permissionsPromise = (async () => {
    let result = await client
      .from("role_page_permissions")
      .select("role_id, page_id, can_view, can_add, can_edit")
      .eq("company_id", companyId);
    if (isMissingCompanyColumn(result.error)) {
      result = await client
        .from("role_page_permissions")
        .select("role_id, page_id, can_view, can_add, can_edit");
    }
    return result;
  })();

  const usersPromise = (async (): Promise<{ data: UserRow[] | null; error: { message?: string } | null }> => {
    if (!options.includeUsers) return { data: [], error: null };
    let result = await client
      .from("profiles")
      .select("id, employee_id, full_name, email, mobile_country_code, mobile, role_id, role, reports_to_user_id, location_scope_ids, invite_method, is_active")
      .eq("company_id", companyId)
      .order("full_name") as unknown as { data: UserRow[] | null; error: { message?: string } | null };
    if (isMissingColumnError(result.error)) {
      result = await client
        .from("profiles")
        .select("id, employee_id, full_name, email, mobile, role_id, role, reports_to_user_id, location_scope_ids, invite_method, is_active")
        .eq("company_id", companyId)
        .order("full_name") as unknown as { data: UserRow[] | null; error: { message?: string } | null };
    }
    if (isMissingCompanyColumn(result.error)) {
      result = await client
        .from("profiles")
        .select("id, employee_id, full_name, email, mobile, role_id, role, reports_to_user_id, location_scope_ids, invite_method, is_active")
        .order("full_name") as unknown as { data: UserRow[] | null; error: { message?: string } | null };
    }
    return result;
  })();

  const membershipsPromise = surface === "workforce" && options.includeUsers
    ? client
      .from("company_product_memberships")
      .select("user_id, role_id, reports_to_user_id, location_scope_ids, is_active")
      .eq("company_id", companyId)
      .eq("product_code", "workforce")
    : Promise.resolve({ data: [], error: null });

  const locationsPromise = (async (): Promise<{ data: RawLocationRow[] | null; error: { message?: string } | null }> => {
    if (!options.includeUsers && !options.includeRoleEditorData) return { data: [], error: null };
    const locationSelect = `
        id,
        station_code,
        station_name,
        city,
        state,
        station_email,
        station_manager_email,
        hide_from_location_list,
        is_active,
        providers (name),
        location_models (code, name)
      `;
    const legacyLocationSelect = `
        id,
        station_code,
        station_name,
        city,
        state,
        station_email,
        station_manager_email,
        is_active,
        providers (name),
        location_models (code, name)
      `;
    let result = await client
      .from("stations")
      .select(locationSelect)
      .eq("is_active", true)
      .eq("company_id", companyId)
      .order("station_code") as unknown as { data: RawLocationRow[] | null; error: { message?: string } | null };
    if (isMissingColumnError(result.error)) {
      result = await client
        .from("stations")
        .select(legacyLocationSelect)
        .eq("is_active", true)
        .eq("company_id", companyId)
        .order("station_code") as unknown as { data: RawLocationRow[] | null; error: { message?: string } | null };
    }
    if (isMissingCompanyColumn(result.error)) {
      result = await client
        .from("stations")
        .select(legacyLocationSelect)
        .eq("is_active", true)
        .order("station_code") as unknown as { data: RawLocationRow[] | null; error: { message?: string } | null };
    }
    return result;
  })();

  const [pagesResult, rolesResult, permissionsResult, usersResult, membershipsResult, locationsResult] = await Promise.all([
    pagesPromise,
    rolesPromise,
    permissionsPromise,
    usersPromise,
    membershipsPromise,
    locationsPromise
  ]);

  const rawLocations = (locationsResult.data ?? []) as unknown as RawLocationRow[];
  const profileUsers = (usersResult.data ?? []) as UserRow[];
  const memberships = membershipsResult.error ? [] : membershipsResult.data ?? [];
  const membershipByUserId = new Map(memberships.map((membership) => [membership.user_id, membership]));
  const users = surface === "workforce"
    ? profileUsers.filter((user) => membershipByUserId.has(user.id)).map((user) => {
      const membership = membershipByUserId.get(user.id)!;
      return {
        ...user,
        role_id: membership.role_id,
        reports_to_user_id: membership.reports_to_user_id,
        location_scope_ids: membership.location_scope_ids,
        is_active: membership.is_active
      };
    })
    : profileUsers;

  return {
    pages: ((pagesResult.data ?? []) as AppPageRow[])
      .filter((page) => page.code !== "company_master" && pageBelongsToSurface(page.code, surface)),
    roles: (rolesResult.data ?? []) as UserRoleRow[],
    permissions: ((permissionsResult.data ?? []) as RolePermissionRow[])
      .filter((permission) => ((rolesResult.data ?? []) as UserRoleRow[]).some((role) => role.id === permission.role_id)),
    users,
    locations: rawLocations.map((location) => ({
      ...location,
      hide_from_location_list: Boolean(location.hide_from_location_list),
      providers: firstRelation(location.providers),
      location_models: firstRelation(location.location_models)
    })) as LocationRow[],
    error: pagesResult.error?.message || rolesResult.error?.message || permissionsResult.error?.message || usersResult.error?.message || locationsResult.error?.message || null
  };
}

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const authorization = await requirePagePermission("users", "access");
  const companyId = requireCompanyId(authorization);
  const accessSurface = currentAccessSurface();
  const isWorkforceSurface = accessSurface === "workforce";
  const pagePermission = authorization.permissions.users;
  const activeSection = searchParams?.section === "roles" || searchParams?.addRole || searchParams?.editRole ? "roles" : "users";
  const showUsersSection = activeSection === "users";
  const showRolesSection = activeSection === "roles";
  const needsUserData = showUsersSection || Boolean(searchParams?.addUser || searchParams?.editUser || searchParams?.editRole);
  const needsRoleEditorData = Boolean(searchParams?.addRole || searchParams?.editRole);
  const { pages, roles, permissions, users, locations, error } = await loadAccessData(companyId, accessSurface, {
    includeUsers: needsUserData,
    includeRoleEditorData: needsRoleEditorData
  });
  const workforceDesignationAccess = isWorkforceSurface
    ? await loadWorkforceDesignationAccess(companyId)
    : { rows: [] as WorkforceDesignationAccessRow[], error: null as string | null };
  const showAddUser = pagePermission.canAdd && searchParams?.addUser === "1";
  const showAddRole = false;
  const peopleDirectory = showAddUser
    ? await loadPeopleAccessDirectory(companyId)
    : { designations: [] as PeopleDesignationRow[], people: [] as PeoplePersonRow[], error: null };
  const surfacePageIds = new Set(pages.map((page) => page.id));
  const surfacePermissions = permissions.filter((permission) => surfacePageIds.has(permission.page_id));
  const workforceRoleIds = new Set([
    ...workforceDesignationAccess.rows.map((designation) => designation.defaultRoleId).filter((id): id is string => Boolean(id)),
    ...users.map((user) => user.role_id).filter((id): id is string => Boolean(id))
  ]);
  const workforceLocationRole = roles.find((role) => role.code === "WORKFORCE_LOCATION" && role.is_active) ?? null;
  if (workforceLocationRole) workforceRoleIds.add(workforceLocationRole.id);
  const visibleRoles = isWorkforceSurface
    ? roles.filter((role) => !role.is_system && role.code !== "OWNER" && workforceRoleIds.has(role.id))
    : roles;
  const visibleRoleIds = new Set(visibleRoles.map((role) => role.id));
  const visibleUsers = isWorkforceSurface
    ? users.filter((user) => Boolean(user.role_id && visibleRoleIds.has(user.role_id)))
    : users;
  const editUser = pagePermission.canEdit
    ? visibleUsers.find((user) => user.id === searchParams?.editUser) ?? null
    : null;
  const editRole = pagePermission.canEdit ? visibleRoles.find((role) => role.id === searchParams?.editRole) ?? null : null;
  const editDesignation = editRole
    ? workforceDesignationAccess.rows.find((designation) => designation.enabled && designation.defaultRoleId === editRole.id) ?? null
    : null;
  const editLocationRole = Boolean(editRole && workforceLocationRole && editRole.id === workforceLocationRole.id);
  const roleModalError = showAddRole || editRole ? searchParams?.userError ?? null : null;
  const pageUserError = roleModalError ? null : searchParams?.userError ?? null;
  const userReturnHref = usersReturnHref(searchParams);
  const visibleLocations = authorization.hasAllLocationAccess
    ? locations
    : locations.filter((location) => authorization.locationScopeIds.includes(location.id) && !location.hide_from_location_list);
  const locationScopeOptions = visibleLocations.map((location) => ({
    id: location.id,
    code: location.station_code,
    name: location.station_name || location.station_code,
    city: location.city,
    state: location.state,
    provider: location.providers?.name ?? null,
    model: location.location_models?.name || location.location_models?.code || null
  }));
  const addUserRoles = visibleRoles.map((role) => ({
    id: role.id,
    code: role.code,
    locationAccessMode: role.location_access_mode,
    name: role.name,
    parentRoleId: role.parent_role_id
  }));
  const addUserProfiles = visibleUsers.map((user) => ({
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    isActive: user.is_active,
    roleId: user.role_id,
    locationScopeIds: user.location_scope_ids ?? []
  }));
  const reportingRoleOptions = visibleRoles.map((role) => ({
    value: role.id,
    label: role.name,
    helper: role.code
  }));
  const editRoleReportingOptions = visibleRoles.filter((role) => role.id !== editRole?.id).map((role) => ({
    value: role.id,
    label: role.name,
    helper: role.code
  }));
  const editRolePermissions = editRole
    ? permissions.filter((permission) => permission.role_id === editRole.id)
    : [];
  const assignedRoleUsers = editRole ? visibleUsers.filter((user) => user.role_id === editRole.id).length : 0;
  const childRoles = editRole ? visibleRoles.filter((role) => role.parent_role_id === editRole.id).length : 0;
  const roleHasDependencies = assignedRoleUsers + childRoles > 0;
  const excludedReplacementRoles = editRole ? descendantRoleIds(visibleRoles, editRole.id) : new Set<string>();
  if (editRole) excludedReplacementRoles.add(editRole.id);
  const replacementRoleOptions = visibleRoles
    .filter((role) => role.is_active && !excludedReplacementRoles.has(role.id))
    .map((role) => ({ value: role.id, label: role.name, helper: role.code }));
  const directReportees = editUser ? visibleUsers.filter((user) => user.reports_to_user_id === editUser.id).length : 0;
  const linkedLocationEmailCount = editUser?.email
    ? locations.filter((location) => location.station_email?.toLowerCase() === editUser.email?.toLowerCase()).length
    : 0;
  const editUserIsLocationManaged = ["Location Email", "Location Master"].includes(editUser?.invite_method ?? "") && linkedLocationEmailCount > 0;
  const managedLocations = editUser?.email
    ? locations.filter((location) => location.station_manager_email?.toLowerCase() === editUser.email?.toLowerCase()).length
    : 0;
  const userHasDependencies = directReportees + managedLocations > 0;
  const excludedReplacementUsers = editUser ? descendantUserIds(visibleUsers, editUser.id) : new Set<string>();
  if (editUser) excludedReplacementUsers.add(editUser.id);
  const replacementUserOptions = visibleUsers
    .filter((user) => user.is_active && !excludedReplacementUsers.has(user.id))
    .map((user) => ({
      value: user.id,
      label: user.full_name || user.email || "Unnamed user",
      helper: user.employee_id || user.email || undefined
    }));

  const activeLabel = isWorkforceSurface
    ? showRolesSection ? "User Roles" : "Users & Access"
    : "Users & Access";

  return (
    <AppShell active={activeLabel}>
      <PageHead
        eyebrow={`${accessSurfaceLabel(accessSurface)} admin setup`}
        title={showRolesSection ? "Designation access and permissions" : isWorkforceSurface ? "Workforce users and access" : "Users and station access"}
        subtitle={showRolesSection
          ? `Configure Workforce menus for People designations without creating duplicate company roles.`
          : isWorkforceSurface
            ? "Create and manage Workforce-only users, roles, reporting lines, and location scope without Dashboard access."
            : `Create users and manage access for the ${accessSurfaceLabel(accessSurface).toLowerCase()} frontend.`}
      />

      {error || workforceDesignationAccess.error ? (
        <section className="panel">
          <div className="panel-body">
            <strong>Role database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {error ?? workforceDesignationAccess.error} Run the current database migrations, then refresh this page.
            </p>
          </div>
        </section>
      ) : null}

      {pageUserError || searchParams?.userNotice ? (
        <section className={`panel message-panel ${pageUserError ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{pageUserError ? "Action failed" : "Action completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {pageUserError ?? searchParams?.userNotice}
            </p>
          </div>
        </section>
      ) : null}

      {showUsersSection && (pagePermission.canView || pagePermission.canEdit) ? (
      <UsersListPanel
        canAdd={pagePermission.canAdd}
        canEdit={pagePermission.canEdit}
        initialPage={Number(searchParams?.userPage ?? "1")}
        initialQuery={searchParams?.userSearch ?? ""}
        initialRoleId={searchParams?.userRole ?? "all"}
        initialUserType={searchParams?.userType ?? "user"}
        locations={visibleLocations.map((location) => ({
          id: location.id,
          code: location.station_code,
          name: location.station_name || location.station_code,
          city: location.city,
          email: location.station_email,
          model: location.location_models?.name || location.location_models?.code || null,
          provider: location.providers?.name ?? null,
          station_manager_email: location.station_manager_email,
          state: location.state
        }))}
        roles={visibleRoles.map((role) => ({
          id: role.id,
          code: role.code,
          locationAccessMode: role.location_access_mode,
          name: role.name,
          parentRoleId: role.parent_role_id
        }))}
        users={visibleUsers}
      />
      ) : null}

      {showRolesSection && (pagePermission.canView || pagePermission.canEdit) ? (
      <section className="panel">
        <div className="panel-head toolbar"><div><h2>Workforce designation access</h2><p className="subtle">Only People designations enabled for Workforce appear here. Workforce controls their menus and actions.</p></div><a className="button secondary" href="https://people.dropxlogistics.com/settings/designations">People Designation Master</a></div>
        <div className="table-wrap"><table style={{ minWidth: 760 }}><thead><tr><th>Designation</th><th>Portal status</th><th>Menu permissions</th><th>Action</th></tr></thead><tbody>
          {workforceDesignationAccess.rows.filter((designation) => designation.enabled).map((designation) => {
            const role = designation.defaultRoleId ? roles.find((item) => item.id === designation.defaultRoleId) ?? null : null;
            return <tr key={designation.id}><td><strong>{designation.name}</strong><div className="subtle">{designation.code}</div></td><td><StatusPill status={role ? "Configured" : "Setup required"} /></td><td>{role ? permissionText(role, surfacePermissions) : "—"}</td><td>{!pagePermission.canEdit ? "—" : role ? <a className="button secondary" href={`/users?section=roles&editRole=${role.id}`}>Configure menus</a> : <form action={configureWorkforceDesignationRole}><input name="designation_id" type="hidden" value={designation.id} /><SubmitButton className="button secondary" pendingText="Preparing…">Set up menus</SubmitButton></form>}</td></tr>;
          })}
          {!workforceDesignationAccess.rows.some((designation) => designation.enabled) ? <tr><td className="empty-cell" colSpan={4}>No People designation is enabled for Workforce. Enable one in People Designation Master.</td></tr> : null}
        </tbody></table></div>
        <div className="panel-head" style={{ borderTop: "1px solid var(--border)" }}><div><h3>Location Account</h3><p className="subtle">Dashboard grants Workforce to station mailboxes. Configure only which Workforce menus those mailboxes can use.</p></div></div>
        <div className="table-wrap"><table style={{ minWidth: 760 }}><thead><tr><th>Account type</th><th>Portal status</th><th>Menu permissions</th><th>Action</th></tr></thead><tbody><tr><td><strong>Location Account</strong><div className="subtle">Dashboard-managed station mailbox</div></td><td><StatusPill status={workforceLocationRole ? "Configured" : "Setup required"} /></td><td>{workforceLocationRole ? permissionText(workforceLocationRole, surfacePermissions) : "Portal owner setup required"}</td><td>{!pagePermission.canEdit ? "—" : workforceLocationRole ? <a className="button secondary" href={`/users?section=roles&editRole=${workforceLocationRole.id}`}>Configure menus</a> : <form action={configureWorkforceLocationRole}><SubmitButton className="button secondary" pendingText="Preparing…">Set up menus</SubmitButton></form>}</td></tr></tbody></table></div>
      </section>
      ) : null}

      {showAddUser ? (
        <DismissibleModal closeHref={sectionHref("users")}>
          <section className="modal-panel wide" aria-label="Add user">
            <div className="panel-head">
              <div>
                <h2>Add user</h2>
                <p className="subtle">Create the login user, assign a role, and set location access.</p>
              </div>
              <DismissModalButton className="icon-button" aria-label="Close add user">x</DismissModalButton>
            </div>
            <div className="panel-body">
              {peopleDirectory.error ? <div className="modal-inline-message error" role="alert">People directory unavailable: {peopleDirectory.error}</div> : null}
              <AddUserForm
                designations={peopleDirectory.designations}
                people={peopleDirectory.people.map((person) => ({
                  id: person.id,
                  workerType: person.worker_type,
                  designationId: person.designation_id ?? "",
                  employeeId: person.worker_code,
                  fullName: person.full_name,
                  email: person.email,
                  mobileCountryCode: person.mobile_country_code,
                  mobile: person.mobile
                }))}
                roles={addUserRoles}
                users={addUserProfiles}
                locations={locationScopeOptions}
              />
            </div>
          </section>
        </DismissibleModal>
      ) : null}

      {showAddRole ? (
        <DismissibleModal closeHref={sectionHref("roles")}>
          <section className="modal-panel wide" aria-label="Add user role">
            <div className="panel-head">
              <div>
                <h2>Add user role</h2>
                <p className="subtle">Set the role code, role name, and page-level permissions.</p>
              </div>
              <DismissModalButton className="icon-button" aria-label="Close add user role">x</DismissModalButton>
            </div>
            {roleModalError ? (
              <div className="modal-inline-message error" role="alert">
                <strong>Role not saved</strong>
                <span>{roleModalError}</span>
              </div>
            ) : null}
            <form action={createUserRole}>
              <input name="surface" type="hidden" value={accessSurface} />
              <div className="form-grid">
                <label>Role code<input className="field" name="code" placeholder="Enter role code" required /></label>
                <label>Role name<input className="field" name="name" placeholder="Enter role name" required /></label>
                <label>Reporting role
                  <SearchableSelect name="parent_role_id" options={reportingRoleOptions} placeholder="Search reporting role" required />
                </label>
                <label>Location access
                  <select className="select" name="location_access_mode" defaultValue="" required>
                    <option value="" disabled>Select location access</option>
                    <option value="role_based">Role based location access</option>
                    <option value="all_locations">All location access</option>
                  </select>
                </label>
              </div>
              <PermissionMatrix pages={pages} surface={accessSurface} />
              {error ? (
                <p className="form-note">
                  Save is locked until the user-role database tables are created in Supabase.
                </p>
              ) : null}
              <div className="form-actions modal-actions">
                <SubmitButton disabled={Boolean(error)} disabledText="DB setup needed">Save role</SubmitButton>
                <DismissModalButton className="button secondary">Cancel</DismissModalButton>
              </div>
            </form>
          </section>
        </DismissibleModal>
      ) : null}

      {editRole ? (
        <DismissibleModal closeHref={sectionHref("roles")}>
          <section className="modal-panel wide" aria-label={editDesignation ? `Configure ${editDesignation.name} menus` : editLocationRole ? "Configure Location Account menus" : "Manage user role"}>
            <div className="panel-head">
              <div>
                <h2>{editDesignation ? `${editDesignation.name} menu access` : editLocationRole ? "Location Account menu access" : "Manage user role"}</h2>
                <p className="subtle">{editDesignation ? `${editDesignation.name} comes from People. Configure only Workforce menus and actions.` : editLocationRole ? "Dashboard assigns station mailboxes; configure only Workforce menus and actions." : "Edit role hierarchy, location access, permissions, and active status."}</p>
              </div>
              <DismissModalButton className="icon-button" aria-label="Close manage user role">x</DismissModalButton>
            </div>
            {roleModalError ? (
              <div className="modal-inline-message error" role="alert">
                <strong>Role not saved</strong>
                <span>{roleModalError}</span>
              </div>
            ) : null}
            {editRole.code === "OWNER" ? (
              <div className="panel-body">
                <strong>System role locked</strong>
                <p className="subtle" style={{ marginTop: 6 }}>
                  OWNER is protected and cannot be edited or deleted.
                </p>
                <div className="form-actions" style={{ marginTop: 14 }}>
                  <DismissModalButton className="button secondary">Close</DismissModalButton>
                </div>
              </div>
            ) : (
              <>
                <form action={updateUserRole}>
                  <input type="hidden" name="id" value={editRole.id} />
                  <input name="surface" type="hidden" value={accessSurface} />
                  {editDesignation || editLocationRole ? <>
                    <input name="name" type="hidden" value={editRole.name} />
                    <input name="parent_role_id" type="hidden" value="" />
                    <input name="location_access_mode" type="hidden" value={editRole.location_access_mode} />
                    <input name="is_active" type="hidden" value="active" />
                    <div className="panel-body" style={{ paddingBottom: 0 }}><strong>{editDesignation?.name ?? "Location Account"}</strong><div className="subtle">{editDesignation ? `People designation · ${editDesignation.code} · location scope comes from the person’s People profile` : "Station mailbox · eligibility and station scope are managed in Dashboard"}</div></div>
                  </> : <div className="form-grid">
                    <label>Role code<input className="field" defaultValue={editRole.code} disabled /></label>
                    <label>Role name<input className="field" name="name" defaultValue={editRole.name} disabled={editRole.code === "LOCATION"} required /></label>
                    {editRole.code === "LOCATION" || editRole.product_code ? (
                      <><input name="parent_role_id" type="hidden" value="" /><label>Reporting role<input className="field" value={editRole.product_code ? "Controlled by People reporting manager" : "No reporting role"} disabled /></label></>
                    ) : (
                      <label>Reporting role
                        <SearchableSelect name="parent_role_id" options={editRoleReportingOptions} defaultValue={editRole.parent_role_id ?? editRoleReportingOptions[0]?.value ?? ""} placeholder="Search reporting role" required />
                      </label>
                    )}
                    <label>Location access
                      <select className="select" name="location_access_mode" defaultValue={editRole.location_access_mode} disabled={editRole.code === "LOCATION"}>
                        <option value="role_based">Role based location access</option>
                        <option value="all_locations">All location access</option>
                      </select>
                    </label>
                    <label>Status
                      <select className="select" name="is_active" defaultValue={editRole.is_active ? "active" : "inactive"} disabled={editRole.code === "LOCATION"}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </label>
                  </div>}
                  <PermissionMatrix pages={pages} initialPermissions={editRolePermissions} surface={accessSurface} />
                  <div className="form-actions modal-actions">
                    <SubmitButton>{editDesignation || editLocationRole ? "Save menu access" : "Save role"}</SubmitButton>
                    <DismissModalButton className="button secondary">Cancel</DismissModalButton>
                  </div>
                </form>
                {editRole.code !== "LOCATION" && !editRole.product_code ? (
                  <form action={deleteUserRole} className="danger-form">
                    <input type="hidden" name="id" value={editRole.id} />
                    <SubmitButton
                      className="button warning"
                      confirmMessage={roleHasDependencies
                        ? "Delete this role and transfer all existing data to the selected replacement role?"
                        : "Delete this role? This action cannot be undone."}
                      confirmationSelect={roleHasDependencies ? {
                        name: "replacement_role_id",
                        label: "Transfer existing data to",
                        options: replacementRoleOptions,
                        placeholder: "Select replacement role",
                        helper: `${assignedRoleUsers} assigned users, ${childRoles} reporting roles`
                      } : undefined}
                      pendingText="Deleting"
                    >Delete role</SubmitButton>
                  </form>
                ) : null}
              </>
            )}
          </section>
        </DismissibleModal>
      ) : null}

      {editUser ? (
        <DismissibleModal closeHref={userReturnHref}>
          <section className="modal-panel" aria-label="Manage user">
            <div className="panel-head">
              <div>
                <h2>Manage user</h2>
                <p className="subtle">Update the user role or deactivate/delete the profile.</p>
              </div>
              <DismissModalButton className="icon-button" aria-label="Close manage user">x</DismissModalButton>
            </div>
            <ManageUserForm
              locations={locationScopeOptions}
              returnHref={userReturnHref}
              roles={addUserRoles}
              user={{
                id: editUser.id,
                employeeId: editUser.employee_id,
                fullName: editUser.full_name,
                email: editUser.email,
                mobileCountryCode: editUser.mobile_country_code ?? "91",
                mobile: editUser.mobile,
                roleId: editUser.role_id,
                reportsToUserId: editUser.reports_to_user_id,
                locationScopeIds: editUser.location_scope_ids ?? [],
                isActive: editUser.is_active,
                invitationPending: userStatus(editUser) === "Invitation Pending",
                isLocationManaged: editUserIsLocationManaged
              }}
              users={addUserProfiles}
            />
            {!isWorkforceSurface && !editUserIsLocationManaged ? <form action={deleteUser} className="danger-form">
              <input type="hidden" name="id" value={editUser.id} />
              <SubmitButton
                className="button warning"
                confirmMessage={userHasDependencies
                  ? "Delete this user and transfer all existing data to the selected replacement user?"
                  : "Delete this user? This action cannot be undone."}
                confirmationSelect={userHasDependencies ? {
                  name: "replacement_user_id",
                  label: "Transfer existing data to",
                  options: replacementUserOptions,
                  placeholder: "Select replacement user",
                  helper: `${directReportees} reportees, ${managedLocations} managed locations`
                } : undefined}
                pendingText="Deleting"
              >Delete user</SubmitButton>
            </form> : null}
          </section>
        </DismissibleModal>
      ) : null}
    </AppShell>
  );
}
