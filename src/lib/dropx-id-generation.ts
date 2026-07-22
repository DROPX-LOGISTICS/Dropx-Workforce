import { supabaseAdmin } from "@/lib/supabase-admin";

export type WorkerIdCategory = "employee" | "field_executive" | "vendor" | "contractor" | "worker";
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

  let resolvedDesignationId = designationId ?? null;
  if (!resolvedDesignationId && designationName) {
    const byNameResult = await supabaseAdmin
      .from("designations")
      .select("id")
      .eq("company_id", companyId)
      .eq("name", designationName)
      .maybeSingle();
    if (!byNameResult.error) {
      resolvedDesignationId = String(byNameResult.data?.id ?? "") || null;
    }
    if (!resolvedDesignationId) {
      const byCodeResult = await supabaseAdmin
        .from("designations")
        .select("id")
        .eq("company_id", companyId)
        .eq("code", designationName)
        .maybeSingle();
      if (!byCodeResult.error) {
        resolvedDesignationId = String(byCodeResult.data?.id ?? "") || null;
      }
    }
  }

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
  return generateConfiguredId({ ...input, settingType: "dropx_id" });
}

export async function generateConfiguredBiometricId(input: GenerateWorkerIdInput) {
  return generateConfiguredId({ ...input, settingType: "biometric_id" });
}
