import { workforceProfileFields } from "@/lib/profile-field-rules";

const labels = new Map(workforceProfileFields.map((field) => [field.key, field.label]));
const fileFields: Record<string, string> = {
  aadhaar_front: "aadhaar_front_file",
  aadhaar_back: "aadhaar_back_file",
  pan_upload: "pan_upload_file",
  dl_front: "dl_front_file",
  dl_back: "dl_back_file",
  profile_photo: "profile_photo_file"
};
const fieldNames: Record<string, string> = { pincode: "postal_pin", ifsc: "ifsc_code" };
const dateFields = new Set(["date_of_birth", "driving_license_exp_date", "vehicle_reg_exp_date", "vehicle_insurance_exp_date", "vehicle_pollution_exp_date"]);
const numericFields = new Set(["aadhaar_number", "eshram_uan", "pincode", "pf_uan", "emergency_contact_number"]);

export function DirectActivationProfileFields({ rules }: { rules: { enabled: string[]; required: string[] } }) {
  const required = new Set(rules.required);
  return <>
    {rules.enabled.map((key) => {
      const label = labels.get(key) ?? key.replaceAll("_", " ");
      const name = fieldNames[key] ?? key;
      if (fileFields[key]) return <label key={key}>{label}<input className="field" name={fileFields[key]} required={required.has(key)} type="file" /></label>;
      if (key === "gender") return <label key={key}>{label}<select className="field" name={name} required={required.has(key)}><option value="">Select gender</option><option>Male</option><option>Female</option><option>Other</option></select></label>;
      if (key === "is_handicapped") return <label key={key}>{label}<select className="field" name={name} required={required.has(key)}><option value="">Select</option><option value="false">No</option><option value="true">Yes</option></select></label>;
      return <label className={key === "address" ? "span-3" : undefined} key={key}>{label}<input className="field" inputMode={numericFields.has(key) ? "numeric" : undefined} name={name} placeholder={`Enter ${label.toLowerCase()}`} required={required.has(key)} type={dateFields.has(key) ? "date" : "text"} /></label>;
    })}
  </>;
}
