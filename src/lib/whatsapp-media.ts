import type { WhatsAppTemplateHeaderMediaType } from "@/lib/whatsapp-template";

export function acceptsForHeaderMedia(type: WhatsAppTemplateHeaderMediaType | null) {
  if (type === "image") return "image/*";
  if (type === "video") return "video/*";
  if (type === "document") return ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return undefined;
}

export async function uploadWhatsAppMedia({
  file,
  graphApiVersion,
  phoneNumberId,
  accessToken
}: {
  file: File;
  graphApiVersion: string;
  phoneNumberId: string;
  accessToken: string;
}) {
  const uploadForm = new FormData();
  uploadForm.set("messaging_product", "whatsapp");
  uploadForm.set("file", file);
  const uploadResponse = await fetch(`https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: uploadForm
  });
  const uploadPayload = await uploadResponse.json() as { id?: string; error?: { message?: string } };
  if (!uploadResponse.ok || !uploadPayload.id) throw new Error(uploadPayload.error?.message || "Meta rejected the media upload.");
  return uploadPayload.id;
}

export function templateHeaderMediaComponent(type: WhatsAppTemplateHeaderMediaType, mediaId: string, filename?: string) {
  const mediaPayload: Record<string, string> = { id: mediaId };
  if (type === "document" && filename) mediaPayload.filename = filename;
  return {
    type: "header",
    parameters: [
      {
        type,
        [type]: mediaPayload
      }
    ]
  };
}
