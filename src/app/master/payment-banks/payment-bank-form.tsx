"use client";

import { FormEvent, useRef, useState, useTransition } from "react";

type PaymentBankRow = {
  id: string;
  bank_code: string;
  display_name: string;
  account_no: string;
  ifsc: string;
  is_active: boolean;
};

type BankOption = {
  value: string;
  label: string;
};

export function PaymentBankForm({
  action,
  bank,
  bankOptions,
  submitLabel = "Save bank"
}: {
  action: (formData: FormData) => Promise<void>;
  bank?: PaymentBankRow | null;
  bankOptions: BankOption[];
  submitLabel?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError(null);
    startTransition(async () => {
      try {
        await action(formData);
        if (!bank) {
          formRef.current?.reset();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to save bank.");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="panel-body">
      {bank ? <input name="id" type="hidden" value={bank.id} /> : null}
      {error ? (
        <div className="message-panel error" style={{ marginBottom: 16 }}>
          <strong>Bank not saved</strong>
          <p className="subtle" style={{ marginTop: 6 }}>{error}</p>
        </div>
      ) : null}
      <div className="form-grid two">
        <label>Bank
          <select className="field" name="bank_code" defaultValue={bank?.bank_code ?? "FEDERAL_BANK"} required>
            {bankOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>Display name
          <input className="field" name="display_name" defaultValue={bank?.display_name ?? ""} placeholder="Federal Bank - Main account" required />
        </label>
        <label>Bank acc no
          <input className="field" name="account_no" defaultValue={bank?.account_no ?? ""} placeholder="Debit account number" required />
        </label>
        <label>IFSC
          <input className="field" name="ifsc" defaultValue={bank?.ifsc ?? ""} placeholder="FDRL0000000" required />
        </label>
        {bank ? (
          <label>Status
            <select className="field" name="is_active" defaultValue={bank.is_active ? "true" : "false"}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
        ) : null}
      </div>
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Saving" : submitLabel}
      </button>
    </form>
  );
}
