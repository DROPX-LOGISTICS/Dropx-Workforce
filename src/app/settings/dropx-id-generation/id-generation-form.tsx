"use client";

import { useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { saveIdGenerationSetting } from "./actions";

type SettingType = "dropx_id" | "biometric_id";
type ScopeType = "company" | "category" | "model" | "location" | "designation";

type GenerationConfig = {
  label?: string | null;
  prefix?: string | null;
  separator?: string | null;
  suffix?: string | null;
  next_serial_no?: number | null;
  serial_digits?: number | null;
};

type SettingRow = {
  id: string;
  setting_type: SettingType;
  scope_type: ScopeType;
  configs: Record<string, GenerationConfig> | null;
  is_active: boolean;
  is_locked: boolean;
};

type OptionRow = {
  id: string;
  code?: string | null;
  name?: string | null;
  station_code?: string | null;
  station_name?: string | null;
};

const scopeTypes: Array<{ value: ScopeType; label: string }> = [
  { value: "company", label: "Company wise" },
  { value: "category", label: "Category wise" },
  { value: "model", label: "Model wise" },
  { value: "location", label: "Location wise" },
  { value: "designation", label: "Designation wise" }
];

function optionLabel(row: OptionRow) {
  return [row.code ?? row.station_code, row.name ?? row.station_name].filter(Boolean).join(" - ") || row.id;
}

function defaultConfig(label: string, defaultPrefix: string): GenerationConfig {
  return {
    label,
    prefix: defaultPrefix,
    separator: "",
    suffix: null,
    next_serial_no: 1,
    serial_digits: defaultPrefix ? 3 : 1
  };
}

function formatSample(config: GenerationConfig) {
  const prefix = config.prefix ?? "";
  const separator = config.separator ?? "";
  const suffix = config.suffix ?? "";
  const serial = String(config.next_serial_no ?? 1).padStart(config.serial_digits ?? 3, "0");
  return `${prefix}${prefix ? separator : ""}${serial}${suffix ? `${separator}${suffix}` : ""}`;
}

function ConfigRow({
  config,
  label,
  optionId,
  scope
}: {
  config: GenerationConfig;
  label: string;
  optionId: string;
  scope: ScopeType;
}) {
  const [prefix, setPrefix] = useState(config.prefix ?? "");
  const [separator, setSeparator] = useState(config.separator ?? "");
  const [serial, setSerial] = useState(String(config.next_serial_no ?? 1));
  const [digits, setDigits] = useState(String(config.serial_digits ?? 3));
  const [suffix, setSuffix] = useState(config.suffix ?? "");
  const sample = formatSample({
    prefix,
    separator,
    suffix,
    next_serial_no: Number.parseInt(serial || "1", 10) || 1,
    serial_digits: Number.parseInt(digits || "1", 10) || 1
  });

  return (
    <div className="id-generation-row">
      <input name="row_scope" type="hidden" value={scope} />
      <input name="row_key" type="hidden" value={optionId} />
      <input name="row_label" type="hidden" value={label} />
      <strong>{label}</strong>
      <input className="field id-generation-soft-placeholder" name="row_prefix" onChange={(event) => setPrefix(event.target.value)} placeholder="Optional" value={prefix} />
      <input className="field id-generation-soft-placeholder" name="row_separator" onChange={(event) => setSeparator(event.target.value)} placeholder="Optional" value={separator} />
      <input className="field" min={1} name="row_next_serial_no" onChange={(event) => setSerial(event.target.value)} type="number" value={serial} />
      <input className="field" max={12} min={1} name="row_serial_digits" onChange={(event) => setDigits(event.target.value)} type="number" value={digits} />
      <input className="field id-generation-soft-placeholder" name="row_suffix" onChange={(event) => setSuffix(event.target.value)} placeholder="Optional" value={suffix} />
      <code>{sample}</code>
    </div>
  );
}

function ConfigRows({
  defaultPrefix,
  options,
  scope,
  setting
}: {
  defaultPrefix: string;
  options: OptionRow[];
  scope: ScopeType;
  setting?: SettingRow;
}) {
  if (!options.length) {
    return (
      <div className="id-generation-empty">
        No active {scopeTypes.find((item) => item.value === scope)?.label.toLowerCase()} items found.
      </div>
    );
  }

  return (
    <div className="id-generation-scope-block">
      <h4>{scopeTypes.find((item) => item.value === scope)?.label}</h4>
      <div className="id-generation-row-head">
        <span>Item</span>
        <span>Prefix</span>
        <span>Separator</span>
        <span>Starting number</span>
        <span>Minimum digit</span>
        <span>Suffix</span>
        <span>Sample</span>
      </div>
      {options.map((option) => {
        const label = optionLabel(option);
        const config = setting?.configs?.[option.id] ?? defaultConfig(label, defaultPrefix);
        return (
          <ConfigRow config={config} key={`${scope}-${option.id}`} label={label} optionId={option.id} scope={scope} />
        );
      })}
    </div>
  );
}

export function IdGenerationForm({
  canEdit,
  categories,
  companyLabel,
  defaultPrefix,
  designations,
  locations,
  models,
  setting,
  subtitle,
  title,
  type
}: {
  canEdit: boolean;
  categories: OptionRow[];
  companyLabel: string;
  defaultPrefix: string;
  designations: OptionRow[];
  locations: OptionRow[];
  models: OptionRow[];
  setting?: SettingRow;
  subtitle: string;
  title: string;
  type: SettingType;
}) {
  const [selectedScope, setSelectedScope] = useState<ScopeType | "">(setting?.scope_type ?? "");
  const locked = Boolean(setting?.is_locked);
  const disabled = !canEdit || locked;
  const optionsByScope = {
    company: [{ id: "company", code: null, name: companyLabel }],
    category: categories,
    model: models,
    location: locations,
    designation: designations
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p className="subtle">{subtitle}</p>
        </div>
        <div className="status-stack">{locked ? <StatusPill status="Locked" /> : <StatusPill status="Editable" />}</div>
      </div>
      <div className="panel-body">
        <form action={saveIdGenerationSetting}>
          <input name="setting_type" type="hidden" value={type} />
          <div className="form-grid three">
            <label>Generation method
              <select
                className="select"
                disabled={disabled}
                name="scope_type"
                onChange={(event) => setSelectedScope(event.target.value as ScopeType | "")}
                required
                value={selectedScope}
              >
                <option value="">Select generation method</option>
                {scopeTypes.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
              </select>
            </label>
          </div>

          <div className="id-generation-note">
            Select one generation method. Only that method's structure will be displayed and saved.
          </div>

          {selectedScope ? (
            <ConfigRows
              defaultPrefix={defaultPrefix}
              options={optionsByScope[selectedScope]}
              scope={selectedScope}
              setting={setting}
            />
          ) : (
            <div className="id-generation-empty">Select a generation method to configure the ID structure.</div>
          )}

          {locked ? <p className="inline-error">This setting is locked because it has already generated an ID.</p> : null}
          <div className="form-actions align-right">
            <SubmitButton disabled={disabled}>Save {title}</SubmitButton>
          </div>
        </form>
      </div>
    </section>
  );
}
