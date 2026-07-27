export const indiaStateOptions = [
  { value: "AP", label: "AP", helper: "Andhra Pradesh" },
  { value: "AR", label: "AR", helper: "Arunachal Pradesh" },
  { value: "AS", label: "AS", helper: "Assam" },
  { value: "BR", label: "BR", helper: "Bihar" },
  { value: "CG", label: "CG", helper: "Chhattisgarh" },
  { value: "GA", label: "GA", helper: "Goa" },
  { value: "GJ", label: "GJ", helper: "Gujarat" },
  { value: "HR", label: "HR", helper: "Haryana" },
  { value: "HP", label: "HP", helper: "Himachal Pradesh" },
  { value: "JH", label: "JH", helper: "Jharkhand" },
  { value: "KA", label: "KA", helper: "Karnataka" },
  { value: "KL", label: "KL", helper: "Kerala" },
  { value: "MP", label: "MP", helper: "Madhya Pradesh" },
  { value: "MH", label: "MH", helper: "Maharashtra" },
  { value: "MN", label: "MN", helper: "Manipur" },
  { value: "ML", label: "ML", helper: "Meghalaya" },
  { value: "MZ", label: "MZ", helper: "Mizoram" },
  { value: "NL", label: "NL", helper: "Nagaland" },
  { value: "OD", label: "OD", helper: "Odisha" },
  { value: "PB", label: "PB", helper: "Punjab" },
  { value: "RJ", label: "RJ", helper: "Rajasthan" },
  { value: "SK", label: "SK", helper: "Sikkim" },
  { value: "TN", label: "TN", helper: "Tamil Nadu" },
  { value: "TS", label: "TS", helper: "Telangana" },
  { value: "TR", label: "TR", helper: "Tripura" },
  { value: "UP", label: "UP", helper: "Uttar Pradesh" },
  { value: "UK", label: "UK", helper: "Uttarakhand" },
  { value: "WB", label: "WB", helper: "West Bengal" },
  { value: "AN", label: "AN", helper: "Andaman and Nicobar Islands" },
  { value: "CH", label: "CH", helper: "Chandigarh" },
  { value: "DN", label: "DN", helper: "Dadra and Nagar Haveli and Daman and Diu" },
  { value: "DL", label: "DL", helper: "Delhi" },
  { value: "JK", label: "JK", helper: "Jammu and Kashmir" },
  { value: "LA", label: "LA", helper: "Ladakh" },
  { value: "LD", label: "LD", helper: "Lakshadweep" },
  { value: "PY", label: "PY", helper: "Puducherry" }
] as const;

export function indiaStateCode(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return indiaStateOptions.find((state) => (
    state.value.toLowerCase() === normalized || state.helper.toLowerCase() === normalized
  ))?.value ?? "";
}
