const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePaymentMethodInput(form: FormData, editing: boolean) {
  const id = editing ? String(form.get("id") ?? "").trim() : null;
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  const name = String(form.get("name") ?? "").trim();
  const fieldIds = [...new Set(form.getAll("field_ids").map((value) => String(value).trim()))];
  if (editing && (!id || !uuid.test(id))) throw new Error("Select a valid payment method.");
  if (!/^[A-Z0-9_]{1,80}$/.test(code)) throw new Error("Method ID must contain letters, numbers or underscores (up to 80 characters).");
  if (!name || name.length > 160) throw new Error("Enter a method name (up to 160 characters).");
  if (!fieldIds.length || fieldIds.length > 50 || fieldIds.some((field) => !uuid.test(field))) throw new Error("Select between 1 and 50 valid payment fields.");
  return { id, code, name, fieldIds };
}
