"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type VerificationKind = "pan" | "pan_aadhaar" | "dl" | "vehicle" | "bank";

type VerificationResult = {
  kind: VerificationKind;
  inputKey?: string;
  verified?: boolean;
  manualReview?: boolean;
  blockSubmit?: boolean;
  name?: string;
  accountName?: string;
  ownerName?: string;
  fuelType?: string;
  message?: string;
  warning?: string;
  expiryDate?: string;
  registrationExpiryDate?: string;
  insuranceExpiryDate?: string;
  pollutionExpiryDate?: string;
};

type ProfileVerificationPanelProps = {
  accountId: string;
  profileType: "employee" | "field_executive";
  pageCode?: "employees" | "delivery_associates" | "contractors";
  showDrivingAndVehicle?: boolean;
};

const labels: Record<VerificationKind, string> = {
  pan: "PAN",
  pan_aadhaar: "PAN Aadhaar link",
  dl: "Driving license",
  vehicle: "Vehicle RC",
  bank: "Bank account"
};

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function inputKey(parts: string[]) {
  return parts.map((part) => part.trim().toUpperCase()).join("|");
}

function displayDateToInput(value?: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return raw;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function resultMessage(result: VerificationResult) {
  const parts = [];
  if (result.kind === "pan" && result.name) parts.push(`PAN name: ${result.name}`);
  if (result.kind === "dl" && result.name) parts.push(`DL name: ${result.name}`);
  if (result.kind === "vehicle" && result.ownerName) parts.push(`RC owner: ${result.ownerName}`);
  if (result.kind === "vehicle" && result.fuelType) parts.push(`Fuel type: ${result.fuelType}`);
  if (result.kind === "bank" && result.accountName) parts.push(`Bank name: ${result.accountName}`);
  let message = result.warning || result.message || "";
  if (result.kind === "pan" && result.name) {
    const normalized = message.toLowerCase();
    if (normalized.includes("pan verified") && normalized.includes("pan name")) message = "";
  }
  if (message && !parts.some((part) => part.includes(message))) parts.push(message);
  return parts.join(" | ");
}

function isElectric(result?: VerificationResult) {
  const fuel = String(result?.fuelType ?? "").toLowerCase();
  return fuel.includes("electric") || fuel === "ev";
}

export function ProfileVerificationPanel({
  accountId,
  profileType,
  pageCode = "employees",
  showDrivingAndVehicle = false
}: ProfileVerificationPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<Partial<Record<VerificationKind, VerificationResult>>>({});
  const [running, setRunning] = useState<VerificationKind | null>(null);
  const [error, setError] = useState("");

  const supportedKinds = useMemo<VerificationKind[]>(() => {
    const items: VerificationKind[] = ["pan", "pan_aadhaar", "bank"];
    if (showDrivingAndVehicle) items.splice(2, 0, "dl", "vehicle");
    return items;
  }, [showDrivingAndVehicle]);

  function form() {
    return hostRef.current?.closest("form") ?? null;
  }

  function currentFields() {
    const currentForm = form();
    const data = new FormData(currentForm ?? undefined);
    return {
      fullName: text(data.get("full_name")),
      panNumber: text(data.get("pan_number")).toUpperCase(),
      aadhaarNumber: text(data.get("aadhaar_number")).replace(/\D/g, ""),
      dateOfBirth: text(data.get("date_of_birth")),
      drivingLicenseNo: text(data.get("driving_license_no")).toUpperCase(),
      vehicleRegNo: text(data.get("vehicle_reg_no")).toUpperCase(),
      bankAccountNo: text(data.get("bank_account_no")).replace(/\D/g, ""),
      ifsc: text(data.get("ifsc") ?? data.get("ifsc_code")).toUpperCase()
    };
  }

  function keyFor(kind: VerificationKind, fields = currentFields()) {
    if (kind === "pan") return inputKey([fields.panNumber]);
    if (kind === "pan_aadhaar") return inputKey([fields.panNumber, fields.aadhaarNumber]);
    if (kind === "dl") return inputKey([fields.drivingLicenseNo, fields.dateOfBirth.replace(/\//g, "-")]);
    if (kind === "vehicle") return inputKey([fields.vehicleRegNo]);
    return inputKey([fields.bankAccountNo, fields.ifsc]);
  }

  function setFieldValue(name: string, value?: string) {
    const input = form()?.elements.namedItem(name) as HTMLInputElement | null;
    const next = displayDateToInput(value);
    if (input && next) {
      input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  async function request(kind: VerificationKind, fields = currentFields()) {
    const response = await fetch("/api/profile-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, profileType, pageCode, kind, ...fields })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Unable to verify.");
    const result = { ...body, kind } as VerificationResult;
    if (kind === "dl") setFieldValue("driving_license_exp_date", result.expiryDate);
    if (kind === "vehicle") {
      setFieldValue("vehicle_reg_exp_date", result.registrationExpiryDate);
      setFieldValue("vehicle_insurance_exp_date", result.insuranceExpiryDate);
      setFieldValue("vehicle_pollution_exp_date", isElectric(result) ? "" : result.pollutionExpiryDate);
    }
    return result;
  }

  function missingMessage(kind: VerificationKind, fields = currentFields()) {
    if (kind === "pan" && !fields.panNumber) return "PAN number is required.";
    if (kind === "pan_aadhaar" && (!fields.panNumber || !fields.aadhaarNumber)) return "PAN and Aadhaar number are required.";
    if (kind === "pan_aadhaar" && !results.pan?.verified) return "Verify PAN first.";
    if (kind === "dl" && (!fields.drivingLicenseNo || !fields.dateOfBirth)) return "DL number and date of birth are required.";
    if (kind === "vehicle" && !fields.vehicleRegNo) return "Vehicle registration number is required.";
    if (kind === "bank" && (!fields.bankAccountNo || !fields.ifsc)) return "Bank account number and IFSC are required.";
    return "";
  }

  async function verifyOne(kind: VerificationKind) {
    const fields = currentFields();
    const missing = missingMessage(kind, fields);
    if (missing) {
      setError(missing);
      return;
    }
    setError("");
    setRunning(kind);
    try {
      const next = { ...results, [kind]: await request(kind, fields) };
      if (kind === "pan") delete next.pan_aadhaar;
      setResults(next);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Unable to verify.");
    } finally {
      setRunning(null);
    }
  }

  useEffect(() => {
    let alive = true;
    fetch(`/api/profile-verification?accountId=${encodeURIComponent(accountId)}&profileType=${encodeURIComponent(profileType)}&pageCode=${encodeURIComponent(pageCode)}`)
      .then((response) => response.ok ? response.json() : { verifications: [] })
      .then((body) => {
        if (!alive) return;
        const next: Partial<Record<VerificationKind, VerificationResult>> = {};
        for (const row of body.verifications ?? []) {
          const details = row.details ?? {};
          next[row.kind as VerificationKind] = {
            ...details,
            kind: row.kind,
            inputKey: row.inputKey,
            verified: row.verified,
            message: row.message ?? ""
          };
        }
        setResults(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [accountId, pageCode, profileType]);

  useEffect(() => {
    const currentForm = form();
    if (!currentForm) return;
    const reconcile = () => {
      setResults((current) => {
        const fields = currentFields();
        const next = { ...current };
        for (const kind of supportedKinds) {
          if (next[kind]?.inputKey && next[kind]?.inputKey !== keyFor(kind, fields)) delete next[kind];
        }
        return next;
      });
    };
    currentForm.addEventListener("input", reconcile);
    currentForm.addEventListener("change", reconcile);
    return () => {
      currentForm.removeEventListener("input", reconcile);
      currentForm.removeEventListener("change", reconcile);
    };
  }, [supportedKinds]);

  return (
    <div className="profile-verification-panel span-3" ref={hostRef}>
      <div className="profile-verification-head">
        <div>
          <strong>Verification</strong>
          <span>Verify each item and review the status before saving.</span>
        </div>
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="profile-verification-list">
        {supportedKinds.map((kind) => {
          const result = results[kind];
          const isRunning = running === kind;
          const missing = missingMessage(kind);
          return (
            <div className={`profile-verification-row ${result?.verified ? "ok" : result ? "warn" : ""}`} key={kind}>
              <span>{isRunning ? "..." : result?.verified ? "OK" : result ? "!" : "-"}</span>
              <div>
                <strong>{labels[kind]}</strong>
                <small>{isRunning ? "Verifying..." : result ? resultMessage(result) || "Checked." : "Not verified"}</small>
              </div>
              <button
                className="button secondary profile-verification-button"
                disabled={running !== null || Boolean(missing)}
                onClick={() => verifyOne(kind)}
                type="button"
              >
                {isRunning ? "Verifying" : result?.verified ? "Verified" : "Verify"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
