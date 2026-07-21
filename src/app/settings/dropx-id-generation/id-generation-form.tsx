"use client";

import { useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { saveIdGenerationSetting } from "./actions";

type SettingType = "dropx_id" | "biometric_id";
type ScopeType = "category" | "model" | "location" | "designation";

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
        <span>Serial</span>
        <span>Digits</span>
        <span>Suffix</span>
        <span>Sample</span>
      </div>
      {options.map((option) => {
        const label = optionLabel(option);
        const config = setting?.configs?.[option.id] ?? defaultConfig(label, defaultPrefix);
        return (
          <div className="id-generation-row" key={`${scope}-${option.id}`}>
            <input name="row_scope" type="hidden" value={scope} />
            <input name="row_key" type="hidden" value={option.id} />
            <input name="row_label" type="hidden" value={label} />
            <strong>{label}</strong>
            <input className="field" defaultValue={config.prefix ?? ""} name="row_prefix" placeholder="Prefix" />
            <input className="field" defaultValue={config.separator ?? ""} name="row_separator" placeholder="-" />
            <input className="field" defaultValue={config.next_serial_no ?? 1} min={1} name="row_next_serial_no" type="number" />
            <input className="field" defaultValue={config.serial_digits ?? 3} max={12} min={1} name="row_serial_digits" type="number" />
            <input className="field" defaultValue={config.suffix ?? ""} name="row_suffix" placeholder="Optional" />
            <code>{formatSample(config)}</code>
          </div>
        );
      })}
    </div>
  );
}

export function IdGenerationForm({
  canEdit,
  categories,
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
        <div className="status-stack">
          <StatusPill status={setting?.is_active === false ? "Inactive" : "Active"} />
          {locked ? <StatusPill status="Locked" /> : <StatusPill status="Editable" />}
        </div>
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
            <label>Status
              <select className="select" defaultValue={setting?.is_active === false ? "false" : "true"} disabled={disabled} name="is_active">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
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
