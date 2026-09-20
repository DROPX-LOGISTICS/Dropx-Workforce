export type ConnectWorkspaceAccount = {
  profileType?: string | null;
  workspace?: "people" | "workforce" | null;
};

// Workspace is the authoritative product boundary. The fallback supports
// records created before the explicit workspace field existed.
export function isWorkforceWorkspace(account?: ConnectWorkspaceAccount | null) {
  if (!account) return false;
  if (account.workspace) return account.workspace === "workforce";
  return account.profileType !== "employee" && account.profileType !== "user";
}

export function isPeopleWorkspace(account?: ConnectWorkspaceAccount | null) {
  return Boolean(account) && !isWorkforceWorkspace(account);
}
