export const designationCategoryOptions = [
  { value: "employees", label: "Employees" },
  { value: "field_executives", label: "Field executives" },
  { value: "delivery_executives", label: "Delivery executives" },
  { value: "vendors", label: "Vendors" },
  { value: "contractors", label: "Contractors" },
  { value: "workers", label: "Workers" }
] as const;

export type DesignationCategory = typeof designationCategoryOptions[number]["value"];

const validCategories = new Set<string>(designationCategoryOptions.map((option) => option.value));

export function normalizeDesignationCategories(value: unknown, fallback: DesignationCategory[] = ["employees"]) {
  const values = Array.isArray(value) ? value : [];
  const normalized = Array.from(new Set(values.map((item) => String(item ?? "").trim()).filter((item) => validCategories.has(item)))) as DesignationCategory[];
  return normalized.length ? normalized : fallback;
}

export function designationCategoryLabel(value: string) {
  return designationCategoryOptions.find((option) => option.value === value)?.label ?? value;
}
