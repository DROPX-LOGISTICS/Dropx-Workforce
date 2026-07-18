import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type TrashStorageRow = {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase service role key is not configured." }, { status: 500 });

  const dueBefore = new Date().toISOString();
  const business = await deleteDueTrashRows("business_document_records", dueBefore);
  const fleet = await deleteDueTrashRows("fleet_vehicle_documents", dueBefore);

  return NextResponse.json({
    due_before: dueBefore,
    business,
    fleet,
    deleted: business.deleted + fleet.deleted,
    files_removed: business.filesRemoved + fleet.filesRemoved
  });
}

async function deleteDueTrashRows(table: "business_document_records" | "fleet_vehicle_documents", dueBefore: string) {
  if (!supabaseAdmin) return { deleted: 0, filesRemoved: 0 };
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("id, storage_bucket, storage_path")
    .eq("is_active", false)
    .not("delete_after", "is", null)
    .lte("delete_after", dueBefore);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as TrashStorageRow[];
  const filesByBucket = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = String(row.storage_bucket ?? "").trim();
    const path = String(row.storage_path ?? "").trim();
    if (!bucket || !path) continue;
    filesByBucket.set(bucket, [...(filesByBucket.get(bucket) ?? []), path]);
  }

  let filesRemoved = 0;
  for (const [bucket, paths] of filesByBucket.entries()) {
    const removeResult = await supabaseAdmin.storage.from(bucket).remove(paths);
    if (removeResult.error) throw new Error(removeResult.error.message);
    filesRemoved += paths.length;
  }

  const ids = rows.map((row) => row.id);
  if (ids.length) {
    const { error: deleteError } = await supabaseAdmin
      .from(table)
      .delete()
      .in("id", ids);
    if (deleteError) throw new Error(deleteError.message);
  }

  return { deleted: ids.length, filesRemoved };
}
