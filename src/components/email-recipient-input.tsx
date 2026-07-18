"use client";

import { useMemo, useState } from "react";

export type EmailRecipientOption = {
  email: string;
  label: string;
  helper?: string;
};

function parseEmails(value: string) {
  return Array.from(new Set(
    value
      .split(/[,\n;]/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.includes("@"))
  ));
}

export function EmailRecipientInput({
  defaultValue = [],
  disabled,
  name,
  options,
  placeholder
}: {
  defaultValue?: string[];
  disabled?: boolean;
  name: string;
  options: EmailRecipientOption[];
  placeholder: string;
}) {
  const [emails, setEmails] = useState(() => Array.from(new Set(defaultValue.map((email) => email.trim().toLowerCase()).filter(Boolean))));
  const [query, setQuery] = useState("");
  const optionByEmail = useMemo(() => new Map(options.map((option) => [option.email.toLowerCase(), option])), [options]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return options
      .filter((option) => !emails.includes(option.email.toLowerCase()))
      .filter((option) => `${option.label} ${option.email} ${option.helper ?? ""}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [emails, options, query]);

  function addEmail(value: string) {
    const parsed = parseEmails(value);
    if (!parsed.length) return;
    setEmails((current) => Array.from(new Set([...current, ...parsed])));
    setQuery("");
  }

  function removeEmail(value: string) {
    setEmails((current) => current.filter((email) => email !== value));
  }

  return (
    <div className="email-recipient-input">
      <input name={name} type="hidden" value={emails.join(",")} />
      <div className={`email-recipient-box ${disabled ? "disabled" : ""}`}>
        {emails.map((email) => (
          <span className="email-recipient-chip" key={`${name}-${email}`}>
            <span className="email-recipient-chip-text">
              {optionByEmail.get(email)?.label ? <strong>{optionByEmail.get(email)?.label}</strong> : null}
              <small>{email}</small>
            </span>
            {!disabled ? <button aria-label={`Remove ${email}`} onClick={() => removeEmail(email)} type="button">x</button> : null}
          </span>
        ))}
        <input
          disabled={disabled}
          onBlur={() => addEmail(query)}
          onChange={(event) => {
            const value = event.target.value;
            if (/[,\n;]/.test(value)) {
              addEmail(value);
            } else {
              setQuery(value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addEmail(query);
            }
            if (event.key === "Backspace" && !query) {
              setEmails((current) => current.slice(0, -1));
            }
          }}
          placeholder={emails.length ? "" : placeholder}
          value={query}
        />
      </div>
      {filtered.length ? (
        <div className="email-recipient-suggestions">
          {filtered.map((option) => (
            <button
              key={`${name}-${option.email}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addEmail(option.email)}
              type="button"
            >
              <span>{option.label}</span>
              <small>{[option.helper, option.email].filter(Boolean).join(" | ")}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
