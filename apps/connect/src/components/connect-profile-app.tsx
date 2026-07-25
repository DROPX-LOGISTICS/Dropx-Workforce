"use client";

import { BadgeCheck, BriefcaseBusiness, CalendarDays, Download, Fingerprint, Landmark, Mail, MapPin, Phone, ShieldCheck, UserRound, WalletCards } from "lucide-react";
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
const defaultExecutive = [...defaultEmployee.filter((x) => !["pf_uan","pf_account_no","esi_no"].includes(x)),"eshram_uan","is_handicapped","driving_license_no","driving_license_exp_date","vehicle_reg_no","vehicle_reg_exp_date","vehicle_insurance_exp_date","vehicle_pollution_exp_date","dl_front","dl_back"];

function Spinner({ label = "Loading profile..." }: { label?: string }) {
  return <div className="dx-loader"><span /><small>{label}</small></div>;
}
function title(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
function dateValue(value = "") {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value;
}
function dateInput(value = "") {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}
function statusActive(value?: string | null) {
  return ["active", "submitted", "under_review"].includes(String(value).toLowerCase());
}

function VerifyField({ label, name, value, onChange, onVerify, running, verified, disabled, type = "text" }: {
  label: string; name: string; value: string; onChange: (value: string) => void; onVerify?: () => void;
  running?: boolean; verified?: boolean; disabled?: boolean; type?: string;
}) {
  return <label className="dx-field">
    <span>{label}</span>
    <div className="dx-input-action">
      <input disabled={disabled} name={name} onChange={(e) => onChange(e.target.value)} type={type} value={value} />
      {onVerify && !verified ? <button disabled={disabled || running} onClick={onVerify} type="button">{running ? <i className="mini-spin" /> : "Verify"}</button> : null}
      {verified ? <BadgeCheck className="dx-verified-icon" /> : null}
    </div>
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
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${endpoint}?${query}`).then(async (r) => { const p = await r.json(); if (!r.ok) throw new Error(p.error); return p.profile as Profile; }),
      fetch(`/api/connect/verification?accountId=${account.id}&profileType=${account.profileType}`).then((r) => r.json())
    ]).then(([next, checks]) => {
      setProfile(next);
      setValues(next.editable ?? {});
      setVerifications(Object.fromEntries((checks.verifications ?? []).map((item: Verification) => [item.kind, item])));
      if (next.profilePhotoUrl) onPhoto?.(next.profilePhotoUrl);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load profile."));
  }, [account.id, account.profileType, endpoint, query]);

  const enabled = useMemo(() => new Set(profile?.fieldRules?.enabled?.length ? profile.fieldRules.enabled : executive ? defaultExecutive : defaultEmployee), [executive, profile]);
  const required = useMemo(() => new Set(profile?.fieldRules?.required ?? []), [profile]);
  const completed = statusActive(profile?.status);
  const set = (key: string, value: string, clear: string[] = []) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (clear.length) setVerifications((current) => Object.fromEntries(Object.entries(current).filter(([kind]) => !clear.includes(kind))));
  };
  const key = (kind: string) => {
    if (kind === "pan") return values.panNumber?.toUpperCase() || "";
    if (kind === "pan_aadhaar") return `${values.panNumber?.toUpperCase() || ""}|${values.aadhaarNumber || ""}`;
    if (kind === "bank") return `${values.bankAccountNo?.toUpperCase() || ""}|${values.ifsc?.toUpperCase() || ""}`;
    if (kind === "pf_uan") return values.pfUan?.toUpperCase() || "";
    if (kind === "dl") return `${values.drivingLicenseNo?.toUpperCase() || ""}|${dateValue(values.dateOfBirth)}`;
    return values.vehicleRegistrationNo?.toUpperCase() || "";
  };
  const verified = (kind: string) => verifications[kind]?.verified && verifications[kind]?.inputKey === key(kind);

  async function verify(kind: string) {
    setRunning(kind); setError("");
    try {
      const body = {
        kind, accountId: account.id, profileType: account.profileType, fullName: profile?.readOnly.fullName,
        panNumber: values.panNumber, aadhaarNumber: values.aadhaarNumber, bankAccountNo: values.bankAccountNo,
        ifsc: values.ifsc, pfUan: values.pfUan, drivingLicenseNo: values.drivingLicenseNo,
        dateOfBirth: values.dateOfBirth, vehicleRegNo: values.vehicleRegistrationNo
      };
      const response = await fetch("/api/connect/verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as Verification & { error?: string };
      if (!response.ok) throw new Error(result.error || "Verification failed.");
      setVerifications((current) => ({ ...current, [kind]: result }));
      if (kind === "dl" && result.expiryDate) setValues((current) => ({ ...current, drivingLicenseExpiry: result.expiryDate! }));
      if (kind === "vehicle") setValues((current) => ({ ...current,
        registrationExpiry: result.registrationExpiryDate || current.registrationExpiry,
        insuranceExpiry: result.insuranceExpiryDate || current.insuranceExpiry,
        pollutionExpiry: result.pollutionExpiryDate || current.pollutionExpiry
      }));
      if (kind === "pan" && enabled.has("aadhaar_number")) await verify("pan_aadhaar");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Verification failed."); }
    finally { setRunning(""); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    const mandatory = [
      ...(enabled.has("pan_number") ? ["pan"] : []),
      ...(enabled.has("pan_number") && enabled.has("aadhaar_number") ? ["pan_aadhaar"] : []),
      ...(enabled.has("bank_account_no") && enabled.has("ifsc") ? ["bank"] : []),
      ...(!executive && enabled.has("pf_uan") && values.pfUan ? ["pf_uan"] : []),
      ...(executive && enabled.has("driving_license_no") ? ["dl"] : []),
      ...(executive && enabled.has("vehicle_reg_no") ? ["vehicle"] : [])
    ];
    if (mandatory.some((kind) => !verifications[kind] || verifications[kind].inputKey !== key(kind))) { setError("Complete every required verification before saving."); return; }
    if (verifications.dl?.blockSubmit) { setError("Driving licence is expired. Registration cannot be submitted."); return; }
    setSaving(true);
    try {
      const data = new FormData(event.currentTarget);
      data.set(executive ? "executive_id" : "employee_id", account.id);
      const checks = Object.values(verifications);
      data.set("manual_review_required", String(checks.some((item) => item.manualReview && ["pan","pan_aadhaar","dl","pf_uan"].includes(item.kind))));
      checks.forEach((item) => data.append("profile_verification_results", JSON.stringify({ ...item, inputKey: key(item.kind) })));
      const response = await fetch(endpoint, { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save profile.");
      setProfile(payload.profile); setNotice("Profile saved."); if (payload.profile.profilePhotoUrl) onPhoto?.(payload.profile.profilePhotoUrl);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save profile."); }
    finally { setSaving(false); }
  }

  if (!profile && !error) return <Spinner />;
  if (!profile) return <div className="dx-alert error">{error}</div>;

  if (completed) {
    const read = profile.readOnly;
    const sections = [
      { name: executive ? "Profile details" : "Employee details", values: {
        "Full name": read.fullName, [executive ? "DropX ID" : "ID"]: read[executive ? "reference" : "employeeId"],
        "Biometric ID": read.biometricId, "Email": read.email, "Location": read.location, "Designation": read.designation,
        "Date of join": read.dateOfJoin, "Mobile number": read.mobile, ...(executive ? { Status: profile.status === "under_review" ? "Under review" : "Active" } : {})
      }},
      { name: "Personal details", values: { Gender: values.gender, "Date of birth": values.dateOfBirth, "Aadhaar number": values.aadhaarNumber, PAN: values.panNumber, ...(executive ? { "eShram UAN": values.eshramUan, Handicapped: values.isHandicapped === "true" ? "Yes" : "No" } : {}), "Father name": values.fatherName, "Blood group": values.bloodGroup }},
      { name: "Address", values: { Address: values.address, "State code": values.stateCode, Pincode: values.pincode, Landmark: values.landmark }},
      { name: "Bank details", values: { "Bank account no": values.bankAccountNo, IFSC: values.ifsc }},
      ...(!executive && profile.statutoryApplicability?.length ? [{ name: "Statutory details", values: { ...(profile.statutoryApplicability.includes("pf") ? { "PF UAN": values.pfUan, "PF Account No": values.pfAccountNo } : {}), ...(profile.statutoryApplicability.includes("esi") ? { "ESI No": values.esiNo } : {}) } }] : []),
      ...(executive ? [{ name: "Driving and vehicle", values: { "Driving license no": values.drivingLicenseNo, "DL expiry date": values.drivingLicenseExpiry, "Vehicle reg no": values.vehicleRegistrationNo, "Reg expiry date": values.registrationExpiry, "Vehicle Insurance expiry": values.insuranceExpiry, "Pollution expiry date": values.pollutionExpiry } }] : []),
      { name: "Emergency contact", values: { "Emergency contact number": values.emergencyContactNumber, "Contact person name": values.emergencyContactName, Relation: values.emergencyContactRelation }},
      { name: "Uploads", values: Object.fromEntries(Object.entries(profile.uploads).map(([k, v]) => [title(k), v ? "Uploaded" : "-"])) }
    ];
    const verifyLabels: Record<string, string> = { "Aadhaar number": "pan_aadhaar", PAN: "pan", "Bank account no": "bank", "PF UAN": "pf_uan", "Driving license no": "dl", "Vehicle reg no": "vehicle" };
    return <div className="dx-profile-view">
      {notice ? <div className="dx-alert success">{notice}</div> : null}
      <div className="dx-profile-hero"><small>DROPX LOGISTICS</small><h1>Profile details</h1><i><UserRound /></i></div>
      {sections.map((section, sectionIndex) => <section key={section.name} className={sectionIndex === 0 ? "primary" : ""}>
        {sectionIndex ? <h2>{section.name}</h2> : null}
        <div>{Object.entries(section.values).map(([label, value]) => <ReadTile full={["Full name","Address"].includes(label)} key={label} label={label} value={String(value || "")} verified={Boolean(verifyLabels[label] && verified(verifyLabels[label]))} url={section.name === "Uploads" ? profile.uploadUrls[label.replace(/\s(.)/g, (_, c) => c.toUpperCase()).replace(/^./, (c) => c.toLowerCase())] : undefined} />)}</div>
      </section>)}
    </div>;
  }

  const input = (keyName: string, label: string, options?: { type?: string; choices?: string[]; readOnly?: boolean }) => {
    if (!enabled.has(keyName)) return null;
    const camel = keyName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = values[camel] ?? "";
    return <label className="dx-field" key={keyName}><span>{label}{required.has(keyName) ? " *" : ""}</span>
      {options?.choices ? <select name={keyName} onChange={(e) => set(camel, e.target.value)} required={required.has(keyName)} value={value}><option value="">Select</option>{options.choices.map((v) => <option key={v}>{v}</option>)}</select>
      : <input name={keyName} onChange={(e) => set(camel, e.target.value)} readOnly={options?.readOnly} required={required.has(keyName)} type={options?.type || "text"} value={options?.type === "date" ? dateInput(value) : value} />}</label>;
  };
  const upload = (name: string, label: string, slot: string) => enabled.has(name) ? <label className="dx-upload"><span>{label}{required.has(name) ? " *" : ""}</span><input accept="image/*,.pdf" name={name} required={required.has(name) && !profile.uploads[slot]} type="file" /><em>{profile.uploads[slot] ? "Uploaded" : "Choose file"}</em></label> : null;
  return <form className="dx-profile-form" onSubmit={save} ref={formRef}>
    <p className="dx-company">{account.companyName}</p>
    <ProfileSection title={executive ? "Profile details" : "Employee details"}>
      {Object.entries(profile.readOnly).map(([label, value]) => <div className="dx-readonly" key={label}><span>{title(label)}</span><strong>{value || "-"}</strong></div>)}
    </ProfileSection>
    <ProfileSection title="Personal details">
      {input("gender","Gender",{ choices: ["Male","Female","Other"] })}{input("date_of_birth","Date of birth",{ type: "date" })}{input("aadhaar_number","Aadhaar number")}
      {enabled.has("pan_number") ? <><VerifyField label="PAN" name="pan_number" onChange={(v) => set("panNumber", v.toUpperCase(), ["pan","pan_aadhaar"])} onVerify={() => verify("pan")} running={running === "pan" || running === "pan_aadhaar"} value={values.panNumber || ""} verified={verified("pan") && (!enabled.has("aadhaar_number") || verified("pan_aadhaar"))} /><VerificationText checks={[verifications.pan, verifications.pan_aadhaar]} /></> : null}
      {input("eshram_uan","eShram UAN")}{input("father_name","Father name")}{input("blood_group","Blood group",{ choices: bloodGroups })}{input("is_handicapped","Handicapped",{ choices: ["true","false"] })}
    </ProfileSection>
    <ProfileSection title="Address">{input("address","Address")}{input("state_code","State code",{ choices: states })}{input("pincode","Pincode")}{input("landmark","Landmark")}</ProfileSection>
    <ProfileSection title="Bank details">
      {input("bank_account_no","Bank account no")}
      {enabled.has("ifsc") ? <><VerifyField label="IFSC" name="ifsc" onChange={(v) => set("ifsc", v.toUpperCase(), ["bank"])} onVerify={() => verify("bank")} running={running === "bank"} value={values.ifsc || ""} verified={verified("bank")} /><VerificationText checks={[verifications.bank]} /></> : null}
    </ProfileSection>
    {!executive ? <ProfileSection title="Statutory details">
      {profile.statutoryApplicability?.includes("pf") ? <>{input("pf_uan","PF UAN")} {values.pfUan ? <button className="dx-inline-verify" onClick={() => verify("pf_uan")} type="button">{verified("pf_uan") ? "Verified" : "Verify PF UAN"}</button> : null}{input("pf_account_no","PF Account No")}</> : null}
      {profile.statutoryApplicability?.includes("esi") ? input("esi_no","ESI No") : null}
    </ProfileSection> : null}
    {executive ? <ProfileSection title="Driving and vehicle">
      <VerifyField label="Driving license no" name="driving_license_no" onChange={(v) => set("drivingLicenseNo", v.toUpperCase(), ["dl"])} onVerify={() => verify("dl")} running={running === "dl"} value={values.drivingLicenseNo || ""} verified={verified("dl")} /><VerificationText checks={[verifications.dl]} />
      {input("driving_license_exp_date","DL expiry date",{ type: "date", readOnly: Boolean(verifications.dl?.expiryDate) })}
      <VerifyField label="Vehicle reg no" name="vehicle_reg_no" onChange={(v) => set("vehicleRegistrationNo", v.toUpperCase(), ["vehicle"])} onVerify={() => verify("vehicle")} running={running === "vehicle"} value={values.vehicleRegistrationNo || ""} verified={verified("vehicle")} /><VerificationText checks={[verifications.vehicle]} />
      {input("vehicle_reg_exp_date","Reg expiry date",{ type: "date", readOnly: Boolean(verifications.vehicle?.registrationExpiryDate) })}{input("vehicle_insurance_exp_date","Vehicle Insurance expiry",{ type: "date", readOnly: Boolean(verifications.vehicle?.insuranceExpiryDate) })}{!verifications.vehicle?.fuelType?.toLowerCase().includes("electric") ? input("vehicle_pollution_exp_date","Pollution expiry date",{ type: "date", readOnly: Boolean(verifications.vehicle?.pollutionExpiryDate) }) : null}
    </ProfileSection> : null}
    <ProfileSection title="Emergency contact">{input("emergency_contact_number","Emergency contact number")}{input("emergency_contact_name","Contact person name")}{input("emergency_contact_relation","Relation",{ choices: relations })}</ProfileSection>
    <ProfileSection title="Uploads">{upload("aadhaar_front","Aadhaar front","aadhaarFront")}{upload("aadhaar_back","Aadhaar back","aadhaarBack")}{upload("pan_upload","PAN upload","pan")}{executive ? upload("dl_front","DL front","dlFront") : null}{executive ? upload("dl_back","DL back","dlBack") : null}{upload("profile_photo","Photo upload","photo")}</ProfileSection>
    {error ? <div className="dx-alert error">{error}</div> : null}{notice ? <div className="dx-alert success">{notice}</div> : null}
    <button className="dx-save" disabled={saving} type="submit">{saving ? "Saving..." : "Save profile"}</button>
  </form>;
}

function ProfileSection({ title: heading, children }: { title: string; children: ReactNode }) {
  return <section className="dx-form-section"><h2>{heading}</h2><div>{children}</div></section>;
}
function VerificationText({ checks }: { checks: Array<Verification | undefined> }) {
  return <>{checks.filter(Boolean).map((check) => <p className={`dx-verification ${check!.verified ? "ok" : "fail"}`} key={check!.kind}><ShieldCheck />{check!.name || check!.accountName || check!.ownerName ? `${check!.name || check!.accountName || check!.ownerName}${check!.fuelType ? ` | Fuel type: ${check!.fuelType}` : ""}` : check!.message || "Verification checked"}</p>)}</>;
}
