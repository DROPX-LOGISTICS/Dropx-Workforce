"use client";

import { useMemo, useState } from "react";
import { AutoGrowTextarea } from "@/components/auto-grow-textarea";
import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";
import { SubmitButton } from "@/components/submit-button";

type PaymentQuestion = {
  id: string;
  question_text: string;
  answer_type: string;
  dropdown_options: string | null;
  is_required: boolean;
};

type PaymentHead = {
  id: string;
  code: string;
  name: string;
  requires_supporting_document: boolean;
  request_expense_approval?: boolean | null;
  expense_approval_threshold?: number | null;
  payment_head_questions: PaymentQuestion[];
};

type PaymentMode = "online_payment" | "account_transfer";

type PaymentRequestFormProps = {
  action: (formData: FormData) => void;
  amountLabel?: string;
  headOptions: SearchableSelectOption[];
  heads: PaymentHead[];
  locationOptions: SearchableSelectOption[];
  showBankDetails?: boolean;
  submitLabel?: string;
};

function inputForQuestion(question: PaymentQuestion, disabled = false) {
  const name = `answers[${question.id}]`;
  if (question.answer_type === "dropdown") {
    const options = (question.dropdown_options ?? "")
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
    return (
      <select className="field" disabled={disabled} name={name} required={question.is_required}>
        <option value="">Select</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (question.answer_type === "textarea") {
    return <AutoGrowTextarea disabled={disabled} name={name} required={question.is_required} rows={3} />;
  }
  if (question.answer_type === "yes_no") {
    return (
      <select className="field" disabled={disabled} name={name} required={question.is_required}>
        <option value="">Select</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }
  if (question.answer_type === "file") {
    return <input className="field" disabled={disabled} name={`files[${question.id}]`} required={question.is_required} type="file" />;
  }
  return (
    <input
      className="field"
      disabled={disabled}
      name={name}
      required={question.is_required}
      step={question.answer_type === "number" ? "0.01" : undefined}
      type={question.answer_type === "number" ? "number" : question.answer_type === "date" ? "date" : "text"}
    />
  );
}

export function PaymentRequestForm({
  action,
  amountLabel = "Amount",
  headOptions,
  heads,
  locationOptions,
  showBankDetails = true,
  submitLabel = "Submit request"
}: PaymentRequestFormProps) {
  const [selectedHeadId, setSelectedHeadId] = useState("");
  const [amountText, setAmountText] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("account_transfer");
  const selectedHead = useMemo(() => heads.find((head) => head.id === selectedHeadId) ?? null, [heads, selectedHeadId]);
  const amount = Number(amountText);
  const hasAmount = amountText.trim().length > 0 && Number.isFinite(amount);
  const expenseApprovalThreshold = selectedHead?.expense_approval_threshold ?? null;
  const blockedByExpenseApproval = showBankDetails && Boolean(selectedHead?.request_expense_approval) && (
    expenseApprovalThreshold == null || (hasAmount && amount > Number(expenseApprovalThreshold))
  );
  const isOnlinePayment = showBankDetails && paymentMode === "online_payment";

  return (
    <form action={action} className="panel-body" encType="multipart/form-data">
      <div className="form-grid three">
        <label>
          Location
          <SearchableSelect name="location_id" options={locationOptions} placeholder="Select location" required />
        </label>
        <label>
          Payment Head
          <SearchableSelect name="payment_head_id" options={headOptions} placeholder="Select payment head" required onValueChange={setSelectedHeadId} />
        </label>
        <label>
          {amountLabel}
          <input className="field" min="0" name="amount" onChange={(event) => setAmountText(event.target.value)} placeholder="0.00" required step="0.01" type="number" value={amountText} />
        </label>
      </div>
      {blockedByExpenseApproval ? <p className="payment-form-warning" role="alert">Required Expense Approval</p> : null}
      {showBankDetails ? (
        <>
          <div className="payment-mode-switch" role="radiogroup" aria-label="Payment mode">
            {[
              { value: "account_transfer" as PaymentMode, label: "Account Transfer" },
              { value: "online_payment" as PaymentMode, label: "Online Payment" }
            ].map((option) => (
              <label key={option.value} className={paymentMode === option.value ? "active" : undefined}>
                <input
                  checked={paymentMode === option.value}
                  disabled={blockedByExpenseApproval}
                  name="payment_mode"
                  onChange={() => setPaymentMode(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {isOnlinePayment ? (
            <div className="form-grid two">
              <label>
                Payment Portal *
                <input className="field" disabled={blockedByExpenseApproval} name="payment_portal" required />
              </label>
              <label>
                Reference ID / Service Number / Consumer ID
                <input className="field" disabled={blockedByExpenseApproval} name="payment_reference" placeholder="Optional" />
              </label>
              <label>
                Contact No
                <input className="field" disabled={blockedByExpenseApproval} name="contact_no" placeholder="Optional" type="tel" />
              </label>
              <label>
                Email
                <input className="field" disabled={blockedByExpenseApproval} name="email" placeholder="Optional" type="email" />
              </label>
            </div>
          ) : (
            <div className="form-grid three">
              <label>
                Bank Account No *
                <input className="field" disabled={blockedByExpenseApproval} name="bank_account_no" required />
              </label>
              <label>
                IFSC *
                <input className="field" disabled={blockedByExpenseApproval} name="ifsc" required />
              </label>
              <label>
                Acc Holder Name *
                <input className="field" disabled={blockedByExpenseApproval} name="account_holder_name" required />
              </label>
              <label>
                Contact No
                <input className="field" disabled={blockedByExpenseApproval} name="contact_no" placeholder="Optional" type="tel" />
              </label>
              <label>
                Email
                <input className="field" disabled={blockedByExpenseApproval} name="email" placeholder="Optional" type="email" />
              </label>
            </div>
          )}
        </>
      ) : null}

      {selectedHead?.payment_head_questions.length ? (
        <>
          <div className="section-divider" />
          <div className="form-grid three">
            {selectedHead.payment_head_questions.map((question) => {
              const questionLabel = question.question_text.toLowerCase();
              const isWideField = question.answer_type === "textarea" || questionLabel.includes("mail subject") || questionLabel.includes("subject");
              return (
                <label key={question.id} className={isWideField ? "span-3" : undefined}>
                  {question.question_text}{question.is_required ? " *" : ""}
                  <input type="hidden" name="question_ids" value={question.id} />
                  {inputForQuestion(question, blockedByExpenseApproval)}
                </label>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="section-divider" />
      <div className="form-grid two">
        <label className="span-2">
          Remarks
          <textarea className="field" disabled={blockedByExpenseApproval} name="remarks" rows={3} />
        </label>
      </div>

      <div className="form-actions">
        <SubmitButton
          disabled={!heads.length || !locationOptions.length || blockedByExpenseApproval}
          disabledText={blockedByExpenseApproval ? "Required Expense Approval" : !heads.length ? "Add payment head first" : "Add location first"}
        >
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
