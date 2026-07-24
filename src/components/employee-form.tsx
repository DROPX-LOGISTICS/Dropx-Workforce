"use client";

import { useMemo, useState } from "react";
import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";
import { ProfileVerificationPanel } from "@/components/profile-verification-panel";
import { SubmitButton } from "@/components/submit-button";
import { countryCodeOptions } from "@/lib/country-codes";

type LocationSelectOption = SearchableSelectOption & {
  modelId?: string | null;
};

type DesignationSelectOption = SearchableSelectOption & {
  modelIds?: string[];
  dashboardRules?: { enabled: string[]; required: string[] };
};

type EmployeeFormProps = {
  action: (formData: FormData) => void;
  designationOptions: DesignationSelectOption[];
  employee?: {
    id: string;
    employee_code: string | null;
    biometric_id?: string | null;
    full_name: string;
    mobile_country_code: string | null;
    mobile: string;
    email: string | null;
    date_of_join: string;
    location_id?: string | null;
    designation_id?: string | null;
    gender?: string | null;
    date_of_birth?: string | null;
    father_name?: string | null;
    blood_group?: string | null;
    aadhaar_number?: string | null;
    pan_number?: string | null;
    address?: string | null;
    state_code?: string | null;
    pincode?: string | null;
    landmark?: string | null;
    emergency_contact_name?: string | null;
    emergency_contact_number?: string | null;
    emergency_contact_relation?: string | null;
    bank_account_no?: string | null;
    ifsc?: string | null;
    pf_uan?: string | null;
    pf_account_no?: string | null;
    statutory_applicability: string[] | null;
    is_active?: boolean;
  } | null;
  locationOptions: LocationSelectOption[];
  mode?: "create" | "edit";
};

const countryCodeSelectOptions = countryCodeOptions.map((country) => ({
  value: country.code,
  label: `+${country.code}`,
  helper: country.label.replace(/\s*\(\+\d+\)\s*$/, "")
}));

const statutoryOptions = [
  { value: "not_applicable", label: "Not Applicable" },
  { value: "pf", label: "PF" },
  { value: "esi", label: "ESI" }
];

const genderOptions = [
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
  { value: "Other", label: "Other" }
];

const stateOptions = [
  "AP", "AR", "AS", "BR", "CG", "GA", "GJ", "HR", "HP", "JH", "KA", "KL", "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "PB", "RJ", "SK", "TN", "TS", "TR", "UP", "UK", "WB", "AN", "CH", "DN", "DL", "JK", "LA", "LD", "PY"
].map((value) => ({ value, label: value }));

function StatutoryMultiSelect({ defaultValue }: { defaultValue?: string[] | null }) {
  const [selected, setSelected] = useState<string[]>(defaultValue?.length ? defaultValue : ["not_applicable"]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(value: string) {
    if (value === "not_applicable") {
      setSelected(["not_applicable"]);
      return;
    }
    const withoutNotApplicable = selected.filter((item) => item !== "not_applicable");
    const next = selectedSet.has(value)
      ? withoutNotApplicable.filter((item) => item !== value)
      : [...withoutNotApplicable, value];
    setSelected(next.length ? next : ["not_applicable"]);
  }

  return (
    <div className="tag-select">
      {selected.map((value) => <input key={value} name="statutory_applicability" type="hidden" value={value} />)}
      {statutoryOptions.map((option) => (
        <button
          aria-pressed={selectedSet.has(option.value)}
          className={`tag-select-option ${selectedSet.has(option.value) ? "selected" : ""}`}
          key={option.value}
          onClick={() => toggle(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmployeeForm({ action, designationOptions, employee, locationOptions, mode = "create" }: EmployeeFormProps) {
  const [selectedLocationId, setSelectedLocationId] = useState(employee?.location_id ?? "");
  const [selectedDesignationId, setSelectedDesignationId] = useState(employee?.designation_id ?? "");
  const isEdit = mode === "edit";
  const selectedLocation = locationOptions.find((option) => option.value === selectedLocationId);
  const selectedModelId = selectedLocation?.modelId ?? "";
  const filteredDesignationOptions = selectedLocationId
    ? designationOptions.filter((option) => {
      const modelIds = option.modelIds ?? [];
      return !modelIds.length || (selectedModelId ? modelIds.includes(selectedModelId) : false);
    })
    : [];
  const effectiveDesignationOptions = selectedDesignationId && !filteredDesignationOptions.some((option) => option.value === selectedDesignationId)
    ? [
      designationOptions.find((option) => option.value === selectedDesignationId) ?? { value: selectedDesignationId, label: "Current designation", helper: "Current", modelIds: [] },
      ...filteredDesignationOptions
    ]
    : filteredDesignationOptions;
  const designationDisabled = !selectedLocationId || !effectiveDesignationOptions.length;
  const selectedRules = designationOptions.find((option) => option.value === selectedDesignationId)?.dashboardRules;
  const fieldEnabled = (key: string) => !selectedRules || selectedRules.enabled.includes(key);
  const fieldRequired = (key: string) => Boolean(selectedRules?.required.includes(key));

  return (
    <form action={action} className={`form-grid three employee-form ${isEdit ? "employee-form-edit" : "employee-form-create"}`}>
      {employee ? <input name="id" type="hidden" value={employee.id} /> : null}
      <label>
        Full name
        <input className="field" defaultValue={employee?.full_name ?? ""} name="full_name" placeholder="Enter full name" required={!isEdit} />
      </label>
      <label className="field-executive-mobile-group">
        Mobile number
        <div className="field-executive-mobile-row">
          <div className="field-executive-country-code">
            <SearchableSelect name="mobile_country_code" options={countryCodeSelectOptions} defaultValue={employee?.mobile_country_code ?? "91"} placeholder="+91" required={!isEdit} />
          </div>
          <input className="field" defaultValue={employee?.mobile ?? ""} inputMode="tel" maxLength={15} name="mobile" pattern="[0-9]{6,15}" placeholder="Enter mobile number" required={!isEdit} />
        </div>
      </label>
      <label>
        Email
        <input className="field" defaultValue={employee?.email ?? ""} name="email" placeholder="Enter email" type="email" />
      </label>
      <label>
        Date of join
        <input className="field" defaultValue={employee?.date_of_join ?? ""} name="date_of_join" required={!isEdit} type="date" />
      </label>
      <label>
        Location
        <SearchableSelect
          name="location_id"
          onValueChange={(value) => {
            setSelectedLocationId(value);
            setSelectedDesignationId("");
          }}
          options={locationOptions}
          value={selectedLocationId}
          placeholder="Select location"
          required={!isEdit}
        />
      </label>
      <label>
        Designation
        <SearchableSelect
          disabled={designationDisabled}
          name="designation_id"
          onValueChange={setSelectedDesignationId}
          options={effectiveDesignationOptions}
          placeholder={selectedLocationId ? "Select designation" : "Select location first"}
          required={!isEdit && !designationDisabled}
          value={selectedDesignationId}
        />
      </label>
      <label className="span-2">
        Statutory applicability
        <StatutoryMultiSelect defaultValue={employee?.statutory_applicability} />
      </label>
      {isEdit ? (
        <>
          {fieldEnabled("gender") ? <label>Gender
            <SearchableSelect name="gender" options={genderOptions} defaultValue={employee?.gender ?? undefined} placeholder="Select gender" />
          </label> : null}
          {fieldEnabled("date_of_birth") ? <label>Date of birth<input className="field" defaultValue={employee?.date_of_birth ?? ""} name="date_of_birth" required={fieldRequired("date_of_birth")} type="date" /></label> : null}
          {fieldEnabled("blood_group") ? <label>Blood group<input className="field" defaultValue={employee?.blood_group ?? ""} name="blood_group" placeholder="Enter blood group" required={fieldRequired("blood_group")} /></label> : null}
          {fieldEnabled("father_name") ? <label>Father name<input className="field" defaultValue={employee?.father_name ?? ""} name="father_name" placeholder="Enter father name" required={fieldRequired("father_name")} /></label> : null}
          {fieldEnabled("aadhaar_number") ? <label>Aadhaar number<input className="field" defaultValue={employee?.aadhaar_number ?? ""} inputMode="numeric" maxLength={12} name="aadhaar_number" pattern="[0-9]{12}" placeholder="Enter Aadhaar number" required={fieldRequired("aadhaar_number")} /></label> : null}
          {fieldEnabled("pan_number") ? <label>PAN number<input className="field" defaultValue={employee?.pan_number ?? ""} name="pan_number" placeholder="Enter PAN number" required={fieldRequired("pan_number")} />{employee ? <ProfileVerificationPanel accountId={employee.id} kind="pan" pageCode="employees" profileType="employee" /> : null}</label> : null}
          {fieldEnabled("address") ? <label className="span-3">Address<input className="field" defaultValue={employee?.address ?? ""} name="address" placeholder="Enter complete address" required={fieldRequired("address")} /></label> : null}
          {fieldEnabled("state_code") ? <label>State
            <SearchableSelect name="state_code" options={stateOptions} defaultValue={employee?.state_code ?? undefined} placeholder="Select state" />
          </label> : null}
          {fieldEnabled("pincode") ? <label>Postal PIN<input className="field" defaultValue={employee?.pincode ?? ""} inputMode="numeric" maxLength={6} name="pincode" pattern="[0-9]{6}" placeholder="Enter PIN" required={fieldRequired("pincode")} /></label> : null}
          {fieldEnabled("landmark") ? <label>Landmark<input className="field" defaultValue={employee?.landmark ?? ""} name="landmark" placeholder="Enter landmark" required={fieldRequired("landmark")} /></label> : null}
          {fieldEnabled("bank_account_no") ? <label>Bank account number<input className="field" defaultValue={employee?.bank_account_no ?? ""} name="bank_account_no" pattern="[A-Za-z0-9]*" placeholder="Enter bank account number" required={fieldRequired("bank_account_no")} /></label> : null}
          {fieldEnabled("ifsc") ? <label>IFSC<input className="field" defaultValue={employee?.ifsc ?? ""} name="ifsc" placeholder="Enter IFSC" required={fieldRequired("ifsc")} />{employee ? <ProfileVerificationPanel accountId={employee.id} kind="bank" pageCode="employees" profileType="employee" /> : null}</label> : null}
          {fieldEnabled("pf_uan") ? <label>PF UAN<input className="field" defaultValue={employee?.pf_uan ?? ""} inputMode="numeric" name="pf_uan" placeholder="Enter PF UAN" required={fieldRequired("pf_uan")} />{employee ? <ProfileVerificationPanel accountId={employee.id} kind="pf_uan" pageCode="employees" profileType="employee" /> : null}</label> : null}
          {fieldEnabled("pf_account_no") ? <label>PF Account No<input className="field" defaultValue={employee?.pf_account_no ?? ""} name="pf_account_no" pattern="[A-Za-z0-9]*" placeholder="Enter PF Account No" required={fieldRequired("pf_account_no")} /></label> : null}
          {fieldEnabled("emergency_contact_number") ? <label>Emergency contact number<input className="field" defaultValue={employee?.emergency_contact_number ?? ""} inputMode="numeric" maxLength={10} name="emergency_contact_number" pattern="[0-9]{10}" placeholder="Enter emergency contact number" required={fieldRequired("emergency_contact_number")} /></label> : null}
          {fieldEnabled("emergency_contact_name") ? <label>Emergency contact name<input className="field" defaultValue={employee?.emergency_contact_name ?? ""} name="emergency_contact_name" placeholder="Enter contact person name" required={fieldRequired("emergency_contact_name")} /></label> : null}
          {fieldEnabled("emergency_contact_relation") ? <label>Emergency relation<input className="field" defaultValue={employee?.emergency_contact_relation ?? ""} name="emergency_contact_relation" placeholder="Enter relation" required={fieldRequired("emergency_contact_relation")} /></label> : null}
          {fieldEnabled("aadhaar_front") ? <label>Aadhaar front file<input className="field" name="aadhaar_front_file" type="file" /></label> : null}
          {fieldEnabled("aadhaar_back") ? <label>Aadhaar back file<input className="field" name="aadhaar_back_file" type="file" /></label> : null}
          {fieldEnabled("pan_upload") ? <label>PAN upload<input className="field" name="pan_upload_file" type="file" /></label> : null}
          {fieldEnabled("profile_photo") ? <label>Profile photo<input accept="image/*" className="field" name="profile_photo_file" type="file" /></label> : null}
        </>
      ) : null}
      {isEdit ? (
        <label>Status
          <select className="select" defaultValue={employee?.is_active === false ? "false" : "true"} name="is_active" required>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      ) : null}
      <div className="form-actions align-right field-executive-submit-slot">
        <SubmitButton
          confirmCancelText="No"
          confirmDescription={`Please confirm before ${isEdit ? "updating" : "creating"} this Employee.`}
          confirmMessage={`Do you want to ${isEdit ? "save" : "submit"} this Employee registration?`}
          confirmSubmitText="Yes"
          confirmTitle="Confirm submission"
          disabled={!locationOptions.length || designationDisabled}
          disabledText={!locationOptions.length ? "Add location first" : !selectedLocationId ? "Select location first" : "Add designation for this model first"}
        >
          {isEdit ? "Save changes" : "Submit"}
        </SubmitButton>
      </div>
    </form>
  );
}
