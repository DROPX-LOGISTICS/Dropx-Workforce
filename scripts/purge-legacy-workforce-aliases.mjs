function rowsFromResponse(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "result", "rows"]) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === "object") {
      for (const nestedKey of ["data", "result", "rows"]) {
        if (Array.isArray(payload[key][nestedKey])) return payload[key][nestedKey];
      }
    }
  }
  return [];
}

async function managementQuery(query, readOnly) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const projectId = process.env.SUPABASE_PROJECT_ID?.trim();
  if (!accessToken || !projectId) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_ID are required.");
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectId)}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: readOnly })
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase cleanup query failed (${response.status}): ${body.slice(0, 800)}`);
  return body ? JSON.parse(body) : [];
}

async function preview() {
  const payload = await managementQuery("select public.preview_legacy_workforce_alias_cleanup() as result;", true);
  const result = rowsFromResponse(payload)[0]?.result ?? {};
  console.log(`Legacy Workforce cleanup preview: ${JSON.stringify(result)}`);
  return result;
}

const mode = process.argv[2] ?? "--preview";
if (mode === "--preview") {
  await preview();
  process.exit(0);
}
if (mode !== "--apply") throw new Error("Use --preview or --apply.");
if (process.env.LEGACY_WORKFORCE_CLEANUP_CONFIRMATION !== "PURGE_VERIFIED_ALIASES") {
  throw new Error("LEGACY_WORKFORCE_CLEANUP_CONFIRMATION must equal PURGE_VERIFIED_ALIASES.");
}

const before = await preview();
if (Number(before.unmatched_rows ?? 0) !== 0) {
  throw new Error(`Cleanup refused: ${before.unmatched_rows} legacy row(s) have no canonical Workforce identity.`);
}
const permissionPayload = await managementQuery("select public.reconcile_product_role_permission_boundaries() as result;", false);
console.log(`Product permission boundaries reconciled: ${JSON.stringify(rowsFromResponse(permissionPayload)[0]?.result ?? {})}`);
const payload = await managementQuery("select public.purge_verified_legacy_workforce_aliases() as result;", false);
const result = rowsFromResponse(payload)[0]?.result ?? {};
console.log(`Legacy Workforce cleanup applied: ${JSON.stringify(result)}`);
const after = await preview();
if (Number(after.legacy_workforce_rows ?? 0) !== 0) {
  throw new Error(`Cleanup verification failed: ${after.legacy_workforce_rows} legacy Workforce row(s) remain.`);
}
