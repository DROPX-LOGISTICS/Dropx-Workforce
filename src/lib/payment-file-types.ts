export type PaymentFileGroup = "image" | "video" | "document";

export const PAYMENT_FILE_GROUPS: Array<{ value: PaymentFileGroup; label: string }> = [
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "document", label: "Doc" },
];

export const DEFAULT_PAYMENT_FILE_GROUPS: PaymentFileGroup[] = ["image", "video", "document"];

const EXTENSIONS: Record<PaymentFileGroup, string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"],
  video: ["mp4", "mov", "m4v", "avi", "webm", "mkv"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf"],
};

export function normalizePaymentFileGroups(value?: string[] | string | null): PaymentFileGroup[] {
  const allowed = new Set(PAYMENT_FILE_GROUPS.map((group) => group.value));
  let values: string[] = [];
  if (Array.isArray(value)) {
    return value.filter((item): item is PaymentFileGroup => allowed.has(item as PaymentFileGroup));
  } else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter((item): item is PaymentFileGroup => allowed.has(item as PaymentFileGroup));
      }
    } catch {
      values = value.split(",").map((item) => item.trim());
    }
  }
  const normalized = values.filter((item): item is PaymentFileGroup => allowed.has(item as PaymentFileGroup));
  return normalized.length ? normalized : [...DEFAULT_PAYMENT_FILE_GROUPS];
}

export function serializePaymentFileGroups(value?: string[] | string | null) {
  return JSON.stringify(normalizePaymentFileGroups(value));
}

export function paymentFileAccept(value?: string[] | string | null) {
  return normalizePaymentFileGroups(value)
    .flatMap((group) => [
      ...(group === "image" || group === "video" ? [`${group}/*`] : []),
      ...EXTENSIONS[group].map((extension) => `.${extension}`),
    ])
    .join(",");
}

export function paymentFileGroupLabels(value?: string[] | string | null) {
  const selected = new Set(normalizePaymentFileGroups(value));
  return PAYMENT_FILE_GROUPS.filter((group) => selected.has(group.value)).map((group) => group.label);
}

export function validatePaymentFile(file: File, value?: string[] | string | null): string | null {
  const groups = normalizePaymentFileGroups(value);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = file.type.toLowerCase();
  const detected = PAYMENT_FILE_GROUPS.find(({ value: group }) =>
    (mimeType ? mimeType.startsWith(`${group}/`) : false) || EXTENSIONS[group].includes(extension),
  )?.value;

  if (!detected || !groups.includes(detected)) {
    return `Only ${paymentFileGroupLabels(groups).join(", ")} files are allowed.`;
  }
  return null;
}
