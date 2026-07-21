import { supabaseAdmin } from "@/lib/supabase-admin";

export type WorkerIdCategory = "employee" | "field_executive";

type GenerateWorkerIdInput = {
  category: WorkerIdCategory;
  companyId: string;
  fallback: () => string;
  locationId?: string | null;
  designationId?: string | null;
  designationName?: string | null;
};

function isMissingGenerationSetup(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return message.includes("generate_dropx_worker_id") ||
    message.includes("dropx_id_generation_settings") ||
    message.includes("schema cache") ||
    (message.includes("function") && message.includes("not found"));
}

export async function generateConfiguredWorkerId({
  category,
  companyId,
  designationId,
  designationName,
  fallback,
  locationId
}: GenerateWorkerIdInput) {
  if (!supabaseAdmin) return fallback();

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

  const result = await supabaseAdmin.rpc("generate_dropx_worker_id", {
    p_category: category,
    p_company_id: companyId,
    p_designation_id: resolvedDesignationId,
    p_location_id: locationId || null,
    p_model_id: modelId
  });

  if (result.error) {
    if (isMissingGenerationSetup(result.error)) return fallback();
    throw new Error(result.error.message);
  }

  const generatedId = String(result.data ?? "").trim();
  return generatedId || fallback();
}
