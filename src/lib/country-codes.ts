export const countryCodeOptions = [
  { code: "91", label: "India (+91)" },
  { code: "971", label: "UAE (+971)" },
  { code: "966", label: "Saudi Arabia (+966)" },
  { code: "974", label: "Qatar (+974)" },
  { code: "965", label: "Kuwait (+965)" },
  { code: "968", label: "Oman (+968)" },
  { code: "973", label: "Bahrain (+973)" },
  { code: "1", label: "US / Canada (+1)" },
  { code: "44", label: "United Kingdom (+44)" },
  { code: "61", label: "Australia (+61)" },
  { code: "65", label: "Singapore (+65)" },
  { code: "60", label: "Malaysia (+60)" }
];

export function cleanCountryCode(value: unknown) {
  return String(value ?? "91").replace(/\D/g, "") || "91";
}
