"use client";

import {
  BadgeCheck, BriefcaseBusiness, CalendarDays, Download, Fingerprint, Mail,
  MapPin, Phone, ShieldCheck, UserRound, WalletCards
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

export type AppAccount = {
  id: string;
  companyId: string;
  profileType: string;
  companyName: string;
  name: string | null;
  email: string | null;
  reference: string | null;
  role: string | null;
  status?: string | null;
  biometricId?: string | null;
  profilePhotoUrl?: string | null;
};

type Profile = {
  readOnly: Record<string, string>;
  editable: Record<string, string>;
  statutoryApplicability: string[];
  fieldRules?: { enabled?: string[]; required?: string[] };
  uploads: Record<string, boolean>;
  uploadUrls: Record<string, string>;
  profilePhotoUrl?: string;
  status: string;
};

type Verification = {
  kind: string;
  inputKey: string;
  verified: boolean;
  manualReview?: boolean;
  blockSubmit?: boolean;
  name?: string;
  accountName?: string;
  ownerName?: string;
  fuelType?: string;
  message?: string;
  expiryDate?: string;
  registrationExpiryDate?: string;
  insuranceExpiryDate?: string;
  pollutionExpiryDate?: string;
};

const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const states = ["AN","AP","AR","AS","BR","CG","CH","DD","DL","DN","GA","GJ","HP","HR","JH","JK","KA","KL","LA","LD","MH","ML","MN","MP","MZ","NL","OD","PB","PY","RJ","SK","TN","TR","TS","UK","UP","WB"];
const relations = ["Parent", "Spouse", "Child", "Other Relative", "Friend", "Other"];
const defaultEmployee = ["gender","date_of_birth","aadhaar_number","pan_number","father_name","blood_group","address","state_code","pincode","landmark","bank_account_no","ifsc","pf_uan","pf_account_no","esi_no","emergency_contact_number","emergency_contact_name","emergency_contact_relation","aadhaar_front","aadhaar_back","pan_upload","profile_photo"];
const defaultExecutive = [...defaultEmployee.filter((key) => !["pf_uan","pf_account_no","esi_no"].includes(key)),"eshram_uan","is_handicapped","driving_license_no","driving_license_exp_date","vehicle_reg_no","vehicle_reg_exp_date","vehicle_insurance_exp_date","vehicle_pollution_exp_date","dl_front","dl_back"];
const fieldValueKeys: Record<string, string> = {
  date_of_birth: "dateOfBirth",
  aadhaar_number: "aadhaarNumber",
  pan_number: "panNumber",
  eshram_uan: "eshramUan",
  father_name: "fatherName",
  blood_group: "bloodGroup",
  is_handicapped: "isHandicapped",
  state_code: "stateCode",
  bank_account_no: "bankAccountNo",
  pf_uan: "pfUan",
  pf_account_no: "pfAccountNo",
  esi_no: "esiNo",
  emergency_contact_number: "emergencyContactNumber",
  emergency_contact_name: "emergencyContactName",
  emergency_contact_relation: "emergencyContactRelation",
  driving_license_no: "drivingLicenseNo",
  driving_license_exp_date: "drivingLicenseExpiry",
  vehicle_reg_no: "vehicleRegistrationNo",
  vehicle_reg_exp_date: "registrationExpiry",
  vehicle_insurance_exp_date: "insuranceExpiry",
  vehicle_pollution_exp_date: "pollutionExpiry"
};

function Spinner({ label = "Loading profile..." }: { label?: string }) {
  return <div className="dx-loader"><span /><small>{label}</small></div>;
}

function title(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayDate(value = "") {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value;
}

function isoDate(value = "") {
  const local = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return local ? `${local[3]}-${local[2]}-${local[1]}` : value;
}

function formatDateTyping(value: string, appendSeparator = true) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}${appendSeparator && digits.length === 4 ? "/" : ""}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function statusReadOnly(value?: string | null) {
  return String(value ?? "pending").trim().toLowerCase() !== "pending";
}

function expired(value?: string) {
  const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const end = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 23, 59, 59);
  return end.getTime() < Date.now();
}

function VerifyField({ label, name, value, onChange, onVerify, running, verified, disabled }: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onVerify?: () => void;
  running?: boolean;
  verified?: boolean;
  disabled?: boolean;
}) {
  return <label className="dx-field">
    <span>{label}</span>
    <div className="dx-input-action">
      <input disabled={disabled} name={name} onChange={(event) => onChange(event.target.value)} value={value} />
      {onVerify && !verified ? <button disabled={disabled || running} onClick={onVerify} type="button">{running ? <i className="mini-spin" /> : "Verify"}</button> : null}
      {verified ? <BadgeCheck className="dx-verified-icon" /> : null}
    </div>
  </label>;
}

function ManualDateField({ label, name, value, required, readOnly, warning, onChange }: {
  label: string;
  name: string;
  value: string;
  required?: boolean;
  readOnly?: boolean;
  warning?: string;
  onChange: (value: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return <label className="dx-field dx-date-field">
    <span>{label}{required ? " *" : ""}</span>
    <div className="dx-date-input">
      <input
        inputMode="numeric"
        maxLength={10}
        name={name}
        onChange={(event) => {
          const raw = event.target.value;
          const deleting = raw.length < displayDate(value).length;
          const digits = raw.replace(/\D/g, "");
          if (!deleting && digits.length === 2) {
            onChange(`${digits}/`);
            return;
          }
          onChange(formatDateTyping(raw, !deleting));
        }}
        placeholder="dd/mm/yyyy"
        readOnly={readOnly}
        required={required}
        value={displayDate(value)}
      />
      {!readOnly ? <button aria-label={`Choose ${label}`} onClick={() => picker.current?.showPicker()} type="button"><CalendarDays /></button> : null}
      <input
        aria-hidden="true"
        className="dx-native-date"
        onChange={(event) => onChange(displayDate(event.target.value))}
        ref={picker}
        tabIndex={-1}
        type="date"
        value={isoDate(value)}
      />
    </div>
    {warning ? <small className="dx-expiry-warning">{warning}</small> : null}
  </label>;
}

function ReadTile({ label, value, verified, url, full }: { label: string; value?: string; verified?: boolean; url?: string; full?: boolean }) {
  const Icon = label.match(/mail/i) ? Mail : label.match(/mobile|contact/i) ? Phone : label.match(/date/i) ? CalendarDays : label.match(/location|state|pin|landmark/i) ? MapPin : label.match(/designation/i) ? BriefcaseBusiness : label.match(/bank|ifsc/i) ? WalletCards : label.match(/biometric/i) ? Fingerprint : UserRound;
  return <a className={`dx-profile-tile ${full ? "full" : ""} ${url ? "clickable" : ""}`} href={url || undefined} rel="noreferrer" target={url ? "_blank" : undefined}>
    <i><Icon /></i><div><span>{label}{verified ? <em><BadgeCheck />Verified</em> : null}</span><strong>{value || "-"}</strong></div>{url ? <Download className="download" /> : null}
  </a>;
}

export function ConnectProfileApp({ account, onPhoto }: { account: AppAccount; onPhoto?: (url: string) => void }) {
  const executive = account.profileType === "field_executive";
  const endpoint = executive ? "/api/connect/field-executive-profile" : "/api/connect/profile";
  const query = executive ? `executiveId=${account.id}` : `employeeId=${account.id}`;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [verifications, setVerifications] = useState<Record<string, Verification>>({});
  const [running, setRunning] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${endpoint}?${query}`).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload.profile as Profile;
      }),
      fetch(`/api/connect/verification?accountId=${account.id}&profileType=${account.profileType}`).then((response) => response.json())
    ]).then(([next, checks]) => {
      setProfile(next);
      setValues(next.editable ?? {});
      setVerifications(Object.fromEntries((checks.verifications ?? []).map((item: Verification) => [item.kind, item])));
      if (next.profilePhotoUrl) onPhoto?.(next.profilePhotoUrl);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load profile."));
  }, [account.id, account.profileType, endpoint, query]);

  const enabled = useMemo(() => {
    const configured = profile?.fieldRules?.enabled;
    return new Set(Array.isArray(configured) ? configured : executive ? defaultExecutive : defaultEmployee);
  }, [executive, profile]);
  const required = useMemo(() => new Set(profile?.fieldRules?.required ?? []), [profile]);
  const completed = statusReadOnly(profile?.status);

  const set = (key: string, value: string, clear: string[] = []) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (clear.length) {
      setVerifications((current) => Object.fromEntries(Object.entries(current).filter(([kind]) => !clear.includes(kind))));
    }
  };

  const verificationKey = (kind: string) => {
    if (kind === "pan") return values.panNumber?.toUpperCase() || "";
    if (kind === "pan_aadhaar") return `${values.panNumber?.toUpperCase() || ""}|${values.aadhaarNumber || ""}`;
    if (kind === "bank") return `${values.bankAccountNo?.toUpperCase() || ""}|${values.ifsc?.toUpperCase() || ""}`;
    if (kind === "pf_uan") return values.pfUan?.toUpperCase() || "";
    if (kind === "dl") return `${values.drivingLicenseNo?.toUpperCase() || ""}|${displayDate(values.dateOfBirth)}`;
    return values.vehicleRegistrationNo?.toUpperCase() || "";
  };

  const currentCheck = (kind: string) => {
    const check = verifications[kind];
    return check?.inputKey === verificationKey(kind) ? check : undefined;
  };
  const verified = (kind: string) => currentCheck(kind)?.verified === true;
  const attempted = (kind: string) => Boolean(currentCheck(kind));

  async function requestVerification(kind: string) {
    const body = {
      kind,
      accountId: account.id,
      profileType: account.profileType,
      fullName: profile?.readOnly.fullName,
      panNumber: values.panNumber,
      aadhaarNumber: values.aadhaarNumber,
      bankAccountNo: values.bankAccountNo,
      ifsc: values.ifsc,
      pfUan: values.pfUan,
      drivingLicenseNo: values.drivingLicenseNo,
      dateOfBirth: values.dateOfBirth,
      vehicleRegNo: values.vehicleRegistrationNo
    };
    const response = await fetch("/api/connect/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json() as Verification & { error?: string };
    if (!response.ok) throw new Error(result.error || "Verification failed.");
    setVerifications((current) => ({ ...current, [kind]: result }));
    if (kind === "dl" && result.expiryDate) {
      setValues((current) => ({ ...current, drivingLicenseExpiry: result.expiryDate! }));
    }
    if (kind === "vehicle") {
      setValues((current) => ({
        ...current,
        registrationExpiry: result.registrationExpiryDate || current.registrationExpiry,
        insuranceExpiry: result.insuranceExpiryDate || current.insuranceExpiry,
        pollutionExpiry: result.pollutionExpiryDate || current.pollutionExpiry
      }));
    }
    return result;
  }

  async function verify(kind: string) {
    setRunning(kind);
    setError("");
    try {
      if (kind === "pan") {
        setVerifications((current) => {
          const next = { ...current };
          delete next.pan_aadhaar;
          return next;
        });
      }
      const result = await requestVerification(kind);
      if (kind === "pan" && result.verified && enabled.has("aadhaar_number")) {
        setRunning("pan_aadhaar");
        await requestVerification("pan_aadhaar");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Verification failed.");
    } finally {
      setRunning("");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const mandatory = [
      ...(enabled.has("pan_number") ? ["pan"] : []),
      ...(enabled.has("pan_number") && enabled.has("aadhaar_number") && verified("pan") ? ["pan_aadhaar"] : []),
      ...(enabled.has("bank_account_no") && enabled.has("ifsc") ? ["bank"] : []),
      ...(!executive && enabled.has("pf_uan") && profile?.statutoryApplicability?.includes("pf") ? ["pf_uan"] : []),
      ...(executive && enabled.has("driving_license_no") ? ["dl"] : []),
      ...(executive && enabled.has("vehicle_reg_no") ? ["vehicle"] : [])
    ];
    if (mandatory.some((kind) => !attempted(kind))) {
      setError("Complete every applicable verification before saving.");
      return;
    }
    if (currentCheck("dl")?.blockSubmit) {
      setError("Driving licence is expired. Registration cannot be submitted.");
      return;
    }

    setSaving(true);
    try {
      const data = new FormData(event.currentTarget);
      data.set(executive ? "executive_id" : "employee_id", account.id);
      const currentChecks = Object.values(verifications).filter((item) => currentCheck(item.kind) === item);
      const reviewKinds = new Set(["pan", "pan_aadhaar", "dl", "pf_uan"]);
      const manualReview = currentChecks.some((item) => reviewKinds.has(item.kind) && (!item.verified || item.manualReview));
      data.set("manual_review_required", String(manualReview));
      currentChecks.forEach((item) => data.append("profile_verification_results", JSON.stringify(item)));
      const response = await fetch(endpoint, { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save profile.");
      setProfile(payload.profile);
      setNotice("Profile saved.");
      if (payload.profile.profilePhotoUrl) onPhoto?.(payload.profile.profilePhotoUrl);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save profile.");
    } finally {
      setSaving(false);
    }
  }

  if (!profile && !error) return <Spinner />;
  if (!profile) return <div className="dx-alert error">{error}</div>;

  if (completed) {
    const read = profile.readOnly;
    const sections = [
      { name: executive ? "Profile details" : "Employee details", values: {
        "Full name": read.fullName,
        [executive ? "DropX ID" : "ID"]: read[executive ? "reference" : "employeeId"],
        "Biometric ID": read.biometricId,
        Email: read.email,
        Location: read.location,
        Designation: read.designation,
        "Date of join": read.dateOfJoin,
        "Mobile number": read.mobile,
        ...(executive ? { Status: profile.status === "under_review" ? "Under review" : "Active" } : {})
      }},
      { name: "Personal details", values: {
        ...(enabled.has("gender") ? { Gender: values.gender } : {}),
        ...(enabled.has("date_of_birth") ? { "Date of birth": values.dateOfBirth } : {}),
        ...(enabled.has("aadhaar_number") ? { "Aadhaar number": values.aadhaarNumber } : {}),
        ...(enabled.has("pan_number") ? { PAN: values.panNumber } : {}),
        ...(enabled.has("eshram_uan") ? { "eShram UAN": values.eshramUan } : {}),
        ...(enabled.has("father_name") ? { "Father name": values.fatherName } : {}),
        ...(enabled.has("blood_group") ? { "Blood group": values.bloodGroup } : {}),
        ...(enabled.has("is_handicapped") ? { Handicapped: values.isHandicapped === "true" ? "Yes" : "No" } : {})
      }},
      { name: "Address", values: {
        ...(enabled.has("address") ? { Address: values.address } : {}),
        ...(enabled.has("state_code") ? { "State code": values.stateCode } : {}),
        ...(enabled.has("pincode") ? { Pincode: values.pincode } : {}),
        ...(enabled.has("landmark") ? { Landmark: values.landmark } : {})
      }},
      { name: "Bank details", values: {
        ...(enabled.has("bank_account_no") ? { "Bank account no": values.bankAccountNo } : {}),
        ...(enabled.has("ifsc") ? { IFSC: values.ifsc } : {})
      }},
      ...(!executive && profile.statutoryApplicability?.length ? [{ name: "Statutory details", values: {
        ...(profile.statutoryApplicability.includes("pf") && enabled.has("pf_uan") ? { "PF UAN": values.pfUan } : {}),
        ...(profile.statutoryApplicability.includes("pf") && enabled.has("pf_account_no") ? { "PF Account No": values.pfAccountNo } : {}),
        ...(profile.statutoryApplicability.includes("esi") && enabled.has("esi_no") ? { "ESI No": values.esiNo } : {})
      }}] : []),
      ...(executive && (enabled.has("driving_license_no") || enabled.has("vehicle_reg_no")) ? [{ name: "Driving and vehicle", values: {
        ...(enabled.has("driving_license_no") ? { "Driving license no": values.drivingLicenseNo } : {}),
        ...(enabled.has("driving_license_exp_date") ? { "DL expiry date": values.drivingLicenseExpiry } : {}),
        ...(enabled.has("vehicle_reg_no") ? { "Vehicle reg no": values.vehicleRegistrationNo } : {}),
        ...(enabled.has("vehicle_reg_exp_date") ? { "Reg expiry date": values.registrationExpiry } : {}),
        ...(enabled.has("vehicle_insurance_exp_date") ? { "Vehicle Insurance expiry": values.insuranceExpiry } : {}),
        ...(enabled.has("vehicle_pollution_exp_date") ? { "Pollution expiry date": values.pollutionExpiry } : {})
      }}] : []),
      { name: "Emergency contact", values: {
        ...(enabled.has("emergency_contact_number") ? { "Emergency contact number": values.emergencyContactNumber } : {}),
        ...(enabled.has("emergency_contact_name") ? { "Contact person name": values.emergencyContactName } : {}),
        ...(enabled.has("emergency_contact_relation") ? { Relation: values.emergencyContactRelation } : {})
      }},
      { name: "Uploads", values: Object.fromEntries(Object.entries(profile.uploads).filter(([key]) => {
        const field = ({ aadhaarFront: "aadhaar_front", aadhaarBack: "aadhaar_back", pan: "pan_upload", dlFront: "dl_front", dlBack: "dl_back", photo: "profile_photo" } as Record<string, string>)[key];
        return !field || enabled.has(field);
      }).map(([key, value]) => [title(key), value ? "Uploaded" : "-"])) }
    ].filter((section) => Object.keys(section.values).length);
    const verifyLabels: Record<string, string> = { "Aadhaar number": "pan_aadhaar", PAN: "pan", "Bank account no": "bank", "PF UAN": "pf_uan", "Driving license no": "dl", "Vehicle reg no": "vehicle" };
    return <div className="dx-profile-view">
      {notice ? <div className="dx-alert success">{notice}</div> : null}
      <div className="dx-profile-hero"><small>DROPX LOGISTICS</small><h1>Profile details</h1><i><UserRound /></i></div>
      {sections.map((section, sectionIndex) => <section className={sectionIndex === 0 ? "primary" : ""} key={section.name}>
        {sectionIndex ? <h2>{section.name}</h2> : null}
        <div>{Object.entries(section.values).map(([label, value]) => <ReadTile
          full={["Full name","Address"].includes(label)}
          key={label}
          label={label}
          value={String(value || "")}
          verified={Boolean(verifyLabels[label] && verified(verifyLabels[label]))}
          url={section.name === "Uploads" ? profile.uploadUrls[label.replace(/\s(.)/g, (_, character) => character.toUpperCase()).replace(/^./, (character) => character.toLowerCase())] : undefined}
        />)}</div>
      </section>)}
    </div>;
  }

  const input = (field: string, label: string, options?: { choices?: Array<string | { value: string; label: string }>; readOnly?: boolean }) => {
    if (!enabled.has(field)) return null;
    const valueKey = fieldValueKeys[field] ?? field.replace(/_([a-z])/g, (_, character) => character.toUpperCase());
    const value = values[valueKey] ?? "";
    return <label className="dx-field" key={field}><span>{label}{required.has(field) ? " *" : ""}</span>
      {options?.choices ? <select name={field} onChange={(event) => set(valueKey, event.target.value)} required={required.has(field)} value={value}>
        <option value="">Select</option>
        {options.choices.map((choice) => {
          const option = typeof choice === "string" ? { value: choice, label: choice } : choice;
          return <option key={option.value} value={option.value}>{option.label}</option>;
        })}
      </select> : <input name={field} onChange={(event) => set(valueKey, event.target.value)} readOnly={options?.readOnly} required={required.has(field)} value={value} />}
    </label>;
  };

  const dateField = (field: string, label: string, options?: { readOnly?: boolean; warning?: string }) => {
    if (!enabled.has(field)) return null;
    const valueKey = fieldValueKeys[field] ?? field;
    return <ManualDateField
      key={field}
      label={label}
      name={field}
      onChange={(value) => set(valueKey, value, field === "date_of_birth" ? ["dl"] : [])}
      readOnly={options?.readOnly}
      required={required.has(field)}
      value={values[valueKey] ?? ""}
      warning={options?.warning}
    />;
  };

  const upload = (name: string, label: string, slot: string) => enabled.has(name) ? <label className="dx-upload">
    <span>{label}{required.has(name) ? " *" : ""}</span>
    <input accept="image/*,.pdf" name={name} required={required.has(name) && !profile.uploads[slot]} type="file" />
    <em>{profile.uploads[slot] ? "Uploaded" : "Choose file"}</em>
  </label> : null;

  const dlCheck = currentCheck("dl");
  const vehicleCheck = currentCheck("vehicle");
  const drivingEnabled = ["driving_license_no","driving_license_exp_date","vehicle_reg_no","vehicle_reg_exp_date","vehicle_insurance_exp_date","vehicle_pollution_exp_date"].some((field) => enabled.has(field));

  return <form className="dx-profile-form" onSubmit={save}>
    <p className="dx-company">{account.companyName}</p>
    <ProfileSection title={executive ? "Profile details" : "Employee details"}>
      {Object.entries(profile.readOnly).map(([label, value]) => <div className="dx-readonly" key={label}><span>{title(label)}</span><strong>{value || "-"}</strong></div>)}
    </ProfileSection>
    <ProfileSection title="Personal details">
      {input("gender","Gender",{ choices: ["Male","Female","Other"] })}
      {dateField("date_of_birth","Date of birth")}
      {enabled.has("aadhaar_number") ? <label className="dx-field"><span>Aadhaar number{required.has("aadhaar_number") ? " *" : ""}</span><input name="aadhaar_number" onChange={(event) => set("aadhaarNumber", event.target.value.replace(/\D/g, ""), ["pan_aadhaar"])} required={required.has("aadhaar_number")} value={values.aadhaarNumber || ""} /></label> : null}
      {enabled.has("pan_number") ? <>
        <VerifyField label={`PAN${required.has("pan_number") ? " *" : ""}`} name="pan_number" onChange={(value) => set("panNumber", value.toUpperCase(), ["pan","pan_aadhaar"])} onVerify={() => verify("pan")} running={running === "pan" || running === "pan_aadhaar"} value={values.panNumber || ""} verified={verified("pan") && (!enabled.has("aadhaar_number") || verified("pan_aadhaar"))} />
        <VerificationText checks={[currentCheck("pan"), currentCheck("pan_aadhaar")]} />
      </> : null}
      {input("eshram_uan","eShram UAN")}
      {input("father_name","Father name")}
      {input("blood_group","Blood group",{ choices: bloodGroups })}
      {input("is_handicapped","Handicapped",{ choices: [{ value: "false", label: "No" }, { value: "true", label: "Yes" }] })}
    </ProfileSection>
    <ProfileSection title="Address">
      {input("address","Address")}{input("state_code","State code",{ choices: states })}{input("pincode","Pincode")}{input("landmark","Landmark")}
    </ProfileSection>
    <ProfileSection title="Bank details">
      {enabled.has("bank_account_no") ? <label className="dx-field"><span>Bank account no{required.has("bank_account_no") ? " *" : ""}</span><input name="bank_account_no" onChange={(event) => set("bankAccountNo", event.target.value.replace(/[^a-zA-Z0-9]/g, ""), ["bank"])} required={required.has("bank_account_no")} value={values.bankAccountNo || ""} /></label> : null}
      {enabled.has("ifsc") ? <>
        <VerifyField label={`IFSC${required.has("ifsc") ? " *" : ""}`} name="ifsc" onChange={(value) => set("ifsc", value.toUpperCase(), ["bank"])} onVerify={() => verify("bank")} running={running === "bank"} value={values.ifsc || ""} verified={verified("bank")} />
        <VerificationText checks={[currentCheck("bank")]} />
      </> : null}
    </ProfileSection>
    {!executive ? <ProfileSection title="Statutory details">
      {profile.statutoryApplicability?.includes("pf") && enabled.has("pf_uan") ? <>
        <VerifyField label={`PF UAN${required.has("pf_uan") ? " *" : ""}`} name="pf_uan" onChange={(value) => set("pfUan", value.replace(/\D/g, ""), ["pf_uan"])} onVerify={() => verify("pf_uan")} running={running === "pf_uan"} value={values.pfUan || ""} verified={verified("pf_uan")} />
        <VerificationText checks={[currentCheck("pf_uan")]} />
      </> : null}
      {profile.statutoryApplicability?.includes("pf") ? input("pf_account_no","PF Account No") : null}
      {profile.statutoryApplicability?.includes("esi") ? input("esi_no","ESI No") : null}
    </ProfileSection> : null}
    {executive && drivingEnabled ? <ProfileSection title="Driving and vehicle">
      {enabled.has("driving_license_no") ? <>
        <VerifyField label={`Driving license no${required.has("driving_license_no") ? " *" : ""}`} name="driving_license_no" onChange={(value) => set("drivingLicenseNo", value.toUpperCase(), ["dl"])} onVerify={() => verify("dl")} running={running === "dl"} value={values.drivingLicenseNo || ""} verified={verified("dl")} />
        <VerificationText checks={[dlCheck]} />
      </> : null}
      {dateField("driving_license_exp_date","DL expiry date",{ readOnly: Boolean(dlCheck?.expiryDate), warning: expired(values.drivingLicenseExpiry) ? "Driving licence has expired." : "" })}
      {enabled.has("vehicle_reg_no") ? <>
        <VerifyField label={`Vehicle reg no${required.has("vehicle_reg_no") ? " *" : ""}`} name="vehicle_reg_no" onChange={(value) => set("vehicleRegistrationNo", value.toUpperCase(), ["vehicle"])} onVerify={() => verify("vehicle")} running={running === "vehicle"} value={values.vehicleRegistrationNo || ""} verified={verified("vehicle")} />
        <VerificationText checks={[vehicleCheck]} />
      </> : null}
      {dateField("vehicle_reg_exp_date","Reg expiry date",{ readOnly: Boolean(vehicleCheck?.registrationExpiryDate), warning: expired(values.registrationExpiry) ? "Vehicle registration has expired." : "" })}
      {dateField("vehicle_insurance_exp_date","Vehicle Insurance expiry",{ readOnly: Boolean(vehicleCheck?.insuranceExpiryDate), warning: expired(values.insuranceExpiry) ? "Vehicle insurance has expired." : "" })}
      {!vehicleCheck?.fuelType?.toLowerCase().includes("electric") ? dateField("vehicle_pollution_exp_date","Pollution expiry date",{ readOnly: Boolean(vehicleCheck?.pollutionExpiryDate), warning: expired(values.pollutionExpiry) ? "Pollution certificate has expired." : "" }) : null}
    </ProfileSection> : null}
    <ProfileSection title="Emergency contact">
      {input("emergency_contact_number","Emergency contact number")}{input("emergency_contact_name","Contact person name")}{input("emergency_contact_relation","Relation",{ choices: relations })}
    </ProfileSection>
    <ProfileSection title="Uploads">
      {upload("aadhaar_front","Aadhaar front","aadhaarFront")}{upload("aadhaar_back","Aadhaar back","aadhaarBack")}{upload("pan_upload","PAN upload","pan")}{upload("dl_front","DL front","dlFront")}{upload("dl_back","DL back","dlBack")}{upload("profile_photo","Photo upload","photo")}
    </ProfileSection>
    {error ? <div className="dx-alert error">{error}</div> : null}
    {notice ? <div className="dx-alert success">{notice}</div> : null}
    <button className="dx-save" disabled={saving} type="submit">{saving ? "Saving..." : "Save profile"}</button>
  </form>;
}

function ProfileSection({ title: heading, children }: { title: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(items) && !items.length) return null;
  return <section className="dx-form-section"><h2>{heading}</h2><div>{items}</div></section>;
}

function VerificationText({ checks }: { checks: Array<Verification | undefined> }) {
  return <>{checks.filter(Boolean).map((check) => {
    const holder = check!.name || check!.accountName || check!.ownerName;
    const status = check!.message || (check!.verified ? "Verified" : "Verification failed");
    const message = holder
      ? `${holder}${check!.fuelType ? ` | Fuel type: ${check!.fuelType}` : ""}${check!.verified ? "" : ` | ${status}`}`
      : status;
    return <p className={`dx-verification ${check!.verified ? "ok" : "fail"}`} key={check!.kind}><ShieldCheck />{message}</p>;
  })}</>;
}
