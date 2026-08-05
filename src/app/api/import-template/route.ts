import { buildImportTemplate, isImportTemplateKind } from "@/lib/import-template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind") ?? "";
  if (!isImportTemplateKind(kind)) {
    return Response.json({ error: "Select a valid upload template." }, { status: 400 });
  }

  const template = buildImportTemplate(kind);
  return new Response(new Uint8Array(template.bytes), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Content-Disposition": `attachment; filename="${template.fileName}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
