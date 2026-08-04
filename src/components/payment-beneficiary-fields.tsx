"use client";

import { useState } from "react";

type PaymentMode = "account_transfer" | "upi_payment";

type PaymentBeneficiaryFieldsProps = {
  defaultBankAccountNo?: string | null;
  defaultContactNo?: string | null;
  defaultEmail?: string | null;
  defaultIfsc?: string | null;
};

export function PaymentBeneficiaryFields({
  defaultBankAccountNo,
  defaultContactNo,
  defaultEmail,
  defaultIfsc
}: PaymentBeneficiaryFieldsProps) {
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("account_transfer");
  const [bankAccountNo, setBankAccountNo] = useState((defaultBankAccountNo ?? "").toUpperCase());
  const [ifsc, setIfsc] = useState((defaultIfsc ?? "").toUpperCase());
  const [accountHolderName, setAccountHolderName] = useState("");
  const [contactNo, setContactNo] = useState(defaultContactNo ?? "");
  const [contactEmail, setContactEmail] = useState(defaultEmail ?? "");
  const [bankVerified, setBankVerified] = useState(false);
  const [bankVerifying, setBankVerifying] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");

  function invalidateBankVerification() {
    setBankVerified(false);
    setAccountHolderName("");
    setVerificationMessage("");
  }

  async function verifyBankAccount() {
    setBankVerifying(true);
    setVerificationMessage("");
    try {
      const response = await fetch("/api/payments/bank-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountNo, ifsc, contactNo, email: contactEmail })
      });
      const result = await response.json();
      if (!response.ok || !result.verified) {
        throw new Error(result.error || result.message || "Bank verification failed.");
      }
      setAccountHolderName(result.accountHolderName || "");
      setBankVerified(true);
      setVerificationMessage(result.source === "contact" ? "Verified account found in Contacts." : "Bank account verified.");
    } catch (error) {
      setBankVerified(false);
      setAccountHolderName("");
      setVerificationMessage(error instanceof Error ? error.message : "Bank verification failed.");
    } finally {
      setBankVerifying(false);
    }
  }

  return (
    <>
      <div className="payment-mode-switch" role="radiogroup" aria-label="Payment method">
        {[
          { value: "account_transfer" as const, label: "Account Transfer" },
          { value: "upi_payment" as const, label: "UPI Payment" }
        ].map((option) => (
          <label key={option.value} className={paymentMode === option.value ? "active" : undefined}>
            <input
              checked={paymentMode === option.value}
              name="payment_mode"
              onChange={() => setPaymentMode(option.value)}
              type="radio"
              value={option.value}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>

      {paymentMode === "upi_payment" ? (
        <div className="form-grid three">
          <label>
            UPI ID *
            <input className="field" name="upi_id" placeholder="name@bank" required />
          </label>
          <label>
            Contact No
            <input className="field" name="contact_no" onChange={(event) => setContactNo(event.target.value)} placeholder="Optional" type="tel" value={contactNo} />
          </label>
          <label>
            Email
            <input className="field" name="email" onChange={(event) => setContactEmail(event.target.value)} placeholder="Optional" type="email" value={contactEmail} />
          </label>
        </div>
      ) : (
        <div className="form-grid three">
          <label>
            Bank Account No *
            <input
              className="field"
              maxLength={30}
              minLength={4}
              name="bank_account_no"
              onChange={(event) => {
                setBankAccountNo(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase());
                invalidateBankVerification();
              }}
              required
              value={bankAccountNo}
            />
          </label>
          <label>
            IFSC *
            <span className="field-with-action">
              <input
                className="field"
                maxLength={11}
                minLength={11}
                name="ifsc"
                onChange={(event) => {
                  setIfsc(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase());
                  invalidateBankVerification();
                }}
                required
                value={ifsc}
              />
              <button
                className="button secondary compact"
                disabled={bankVerifying || !bankAccountNo || ifsc.length !== 11 || bankVerified}
                onClick={verifyBankAccount}
                type="button"
              >
                {bankVerifying ? "Verifying..." : bankVerified ? "Verified" : "Verify"}
              </button>
            </span>
            {verificationMessage ? (
              <span className={bankVerified ? "verification-message success" : "verification-message error"}>{verificationMessage}</span>
            ) : null}
          </label>
          <label>
            Acc Holder Name *
            <input className="field" name="account_holder_name" readOnly required value={accountHolderName} />
            <input name="bank_verified" type="hidden" value={bankVerified ? "1" : "0"} />
          </label>
          <label>
            Contact No
            <input className="field" name="contact_no" onChange={(event) => setContactNo(event.target.value)} placeholder="Optional" type="tel" value={contactNo} />
          </label>
          <label>
            Email
            <input className="field" name="email" onChange={(event) => setContactEmail(event.target.value)} placeholder="Optional" type="email" value={contactEmail} />
          </label>
        </div>
      )}
    </>
  );
}
