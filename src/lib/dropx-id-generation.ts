import { supabaseAdmin } from "@/lib/supabase-admin";

export type WorkerIdCategory = string;
type IdSettingType = "dropx_id" | "biometric_id";

type GenerateWorkerIdInput = {
  category: WorkerIdCategory;
  companyId: string;
  fallback: () => string | Promise<string>;
  locationId?: string | null;
  designationId?: string | null;
  designationName?: string | null;
};

function isMissingGenerationSetup(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return message.includes("generate_dropx_worker_id") ||
    message.includes("generate_biometric_worker_id") ||
    message.includes("generate_configured_worker_id") ||
    message.includes("dropx_id_generation_settings") ||
    message.includes("schema cache") ||
    (message.includes("function") && message.includes("not found"));
}

async function resolveDesignationId(companyId: string, designationId?: string | null, designationName?: string | null) {
  if (designationId) return designationId;
  if (!designationName || !supabaseAdmin) return null;
  const byNameResult = await supabaseAdmin
    .from("designations")
    .select("id")
    .eq("company_id", companyId)
    .eq("name", designationName)
    .maybeSingle();
  if (!byNameResult.error && byNameResult.data?.id) return String(byNameResult.data.id);
  const byCodeResult = await supabaseAdmin
    .from("designations")
    .select("id")
    .eq("company_id", companyId)
    .eq("code", designationName)
    .maybeSingle();
  if (!byCodeResult.error && byCodeResult.data?.id) return String(byCodeResult.data.id);
  return null;
}

export async function assertWorkerDesignationMappedToIdSeries(
  input: Pick<GenerateWorkerIdInput, "companyId" | "designationId" | "designationName">
) {
  if (!supabaseAdmin) return;
  const settingsResult = await (supabaseAdmin.from("dropx_id_generation_settings") as any)
    .select("setting_type, configs")
    .eq("company_id", input.companyId)
    .eq("scope_type", "multi_designation")
    .eq("is_active", true);
  if (settingsResult.error) {
    if (isMissingGenerationSetup(settingsResult.error)) return;
    throw new Error(settingsResult.error.message);
  }
  const settings = (settingsResult.data ?? []) as Array<{ setting_type: IdSettingType; configs: Record<string, { designation_ids?: unknown }> | null }>;
  if (!settings.length) return;
  const resolvedDesignationId = await resolveDesignationId(input.companyId, input.designationId, input.designationName);
  if (!resolvedDesignationId) {
    throw new Error("Cannot add this person because the selected designation could not be matched to an ID generation series.");
  }
  const unmapped = settings.filter((setting) => !Object.values(setting.configs ?? {}).some((config) =>
    Array.isArray(config.designation_ids) && config.designation_ids.includes(resolvedDesignationId)
  ));
  if (unmapped.length) {
    const labels = unmapped.map((setting) => setting.setting_type === "dropx_id" ? "DropX ID" : "Biometric ID").join(" and ");
    throw new Error(`Cannot add this person. Map the selected designation to a ${labels} series in ID Generation settings first.`);
  }
}

async function generateConfiguredId({
  category,
  companyId,
  designationId,
  designationName,
  fallback,
  locationId,
  settingType
}: GenerateWorkerIdInput & { settingType: IdSettingType }) {
  if (!supabaseAdmin) return await fallback();

  let modelId: string | null = null;
  if (locationId) {
    const locationResult = await supabaseAdmin
      .from("stations")
      .select("location_model_id")
      .eq("company_id", companyId)
      .eq("id", locationId)
      .maybeSingle();
    if (!locationResult.error) {
      modelId = String(locationResult.data?.location_model_id ?? "") || null;
    }
  }

  const resolvedDesignationId = await resolveDesignationId(companyId, designationId, designationName);

  const result = await supabaseAdmin.rpc(settingType === "dropx_id" ? "generate_dropx_worker_id" : "generate_biometric_worker_id", {
    p_category: category,
    p_company_id: companyId,
    p_designation_id: resolvedDesignationId,
    p_location_id: locationId || null,
    p_model_id: modelId
  });

  if (result.error) {
    if (isMissingGenerationSetup(result.error)) return await fallback();
    throw new Error(result.error.message);
  }

  const generatedId = String(result.data ?? "").trim();
  return generatedId || await fallback();
}

export async function generateConfiguredWorkerId(input: GenerateWorkerIdInput) {
  await assertWorkerDesignationMappedToIdSeries(input);
  return generateConfiguredId({ ...input, settingType: "dropx_id" });
}

export async function generateConfiguredBiometricId(input: GenerateWorkerIdInput) {
  await assertWorkerDesignationMappedToIdSeries(input);
  return generateConfiguredId({ ...input, settingType: "biometric_id" });
}
