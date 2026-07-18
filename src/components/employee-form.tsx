"use client";

import { useMemo, useState } from "react";
import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";
import { SubmitButton } from "@/components/submit-button";
import { countryCodeOptions } from "@/lib/country-codes";

type EmployeeFormProps = {
  action: (formData: FormData) => void;
  designationOptions: SearchableSelectOption[];
  locationOptions: SearchableSelectOption[];
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

function StatutoryMultiSelect() {
  const [selected, setSelected] = useState<string[]>(["not_applicable"]);
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

export function EmployeeForm({ action, designationOptions, locationOptions }: EmployeeFormProps) {
  const [autoGenerateEmployeeCode, setAutoGenerateEmployeeCode] = useState(true);

  return (
    <form action={action} className="form-grid three employee-form">
      <label>
        Employee ID
        <input
          className="field"
          disabled={autoGenerateEmployeeCode}
          name="employee_code"
          placeholder={autoGenerateEmployeeCode ? "Auto generated" : "Enter employee ID"}
          required={!autoGenerateEmployeeCode}
        />
      </label>
      <label className="check-row employee-code-auto-check">
        <input
          checked={autoGenerateEmployeeCode}
          name="auto_generate_employee_code"
          onChange={(event) => setAutoGenerateEmployeeCode(event.target.checked)}
          type="checkbox"
          value="yes"
        />
        <span>Auto generate employee ID</span>
      </label>
      <label>
        Full name
        <input className="field" name="full_name" placeholder="Enter full name" required />
      </label>
      <label>
        Biometric enrolment ID
        <input className="field" inputMode="numeric" name="biometric_id" pattern="[0-9]{1,20}" placeholder="Auto generated if blank" />
      </label>
      <label className="field-executive-mobile-group">
        Mobile number
        <div className="field-executive-mobile-row">
          <div className="field-executive-country-code">
            <SearchableSelect name="mobile_country_code" options={countryCodeSelectOptions} defaultValue="91" placeholder="+91" required />
          </div>
          <input className="field" inputMode="tel" maxLength={15} name="mobile" pattern="[0-9]{6,15}" placeholder="Enter mobile number" required />
        </div>
      </label>
      <label>
        Email
        <input className="field" name="email" placeholder="Enter email" type="email" />
      </label>
      <label>
        Date of join
        <input className="field" name="date_of_join" required type="date" />
      </label>
      <label>
        Location
        <SearchableSelect name="location_id" options={locationOptions} placeholder="Select location" required />
      </label>
      <label>
        Designation
        <SearchableSelect name="designation_id" options={designationOptions} placeholder="Select designation" required />
      </label>
      <label className="span-2">
        Statutory applicability
        <StatutoryMultiSelect />
      </label>
      <div className="form-actions align-right field-executive-submit-slot">
        <SubmitButton
          confirmCancelText="No"
          confirmDescription="Please confirm before creating this Employee."
          confirmMessage="Do you want to submit this Employee registration?"
          confirmSubmitText="Yes"
          confirmTitle="Confirm submission"
          disabled={!locationOptions.length || !designationOptions.length}
          disabledText={!locationOptions.length ? "Add location first" : "Add designation first"}
        >
          Submit
        </SubmitButton>
      </div>
    </form>
  );
}
