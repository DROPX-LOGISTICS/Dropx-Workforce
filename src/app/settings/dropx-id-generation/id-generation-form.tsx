"use client";

import { useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { saveIdGenerationSetting } from "./actions";

type SettingType = "dropx_id" | "biometric_id";
type ScopeType = "company" | "category" | "model" | "location" | "designation" | "multi_designation";

type GenerationConfig = {
  label?: string | null;
  prefix?: string | null;
  separator?: string | null;
  suffix?: string | null;
  next_serial_no?: number | null;
  serial_digits?: number | null;
  designation_ids?: string[] | null;
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
  { value: "designation", label: "Designation wise" },
  { value: "multi_designation", label: "Multi Designation Wise" }
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

type MultiSeries = GenerationConfig & { key: string; designation_ids: string[] };

function MultiDesignationRows({
  defaultPrefix,
  designations,
  setting
}: {
  defaultPrefix: string;
  designations: OptionRow[];
  setting?: SettingRow;
}) {
  const initial = Object.entries(setting?.scope_type === "multi_designation" ? setting.configs ?? {} : {}).map(([key, config]) => ({
    ...defaultConfig(config.label || "Series", defaultPrefix),
    ...config,
    key,
    designation_ids: Array.isArray(config.designation_ids) ? config.designation_ids : []
  }));
  const [series, setSeries] = useState<MultiSeries[]>(initial);

  function addSeries() {
    setSeries((current) => [
      ...current,
      {
        ...defaultConfig(`Series ${current.length + 1}`, defaultPrefix),
        key: `series_${Date.now()}_${current.length + 1}`,
        designation_ids: []
      }
    ]);
  }

  function updateSeries(key: string, patch: Partial<MultiSeries>) {
    setSeries((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  const assignedTo = new Map<string, string>();
  series.forEach((item) => item.designation_ids.forEach((id) => assignedTo.set(id, item.key)));

  return (
    <div className="id-generation-scope-block multi-designation-block">
      <div className="multi-designation-title">
        <div>
          <h4>Multi Designation Wise</h4>
          <p className="subtle">Create independent ID series and map one or more designations to each series.</p>
        </div>
        <button className="button secondary compact" onClick={addSeries} type="button">+ Add series</button>
      </div>

      {!series.length ? (
        <div className="id-generation-empty">Add the first series, then choose the designations that share it.</div>
      ) : null}

      {series.map((item, index) => {
        const sample = formatSample(item);
        const selectedDesignations = designations.filter((designation) => item.designation_ids.includes(designation.id));
        return (
          <div className="multi-designation-series" key={item.key}>
            <input name="row_scope" type="hidden" value="multi_designation" />
            <input name="row_key" type="hidden" value={item.key} />
            <input name="row_designation_ids" type="hidden" value={JSON.stringify(item.designation_ids)} />
            <div className="multi-designation-series-head">
              <strong>Series {index + 1}</strong>
              <button className="button secondary compact danger-text" onClick={() => setSeries((current) => current.filter((row) => row.key !== item.key))} type="button">Remove</button>
            </div>
            <div className="multi-designation-fields">
              <label>Series name
                <input className="field" name="row_label" onChange={(event) => updateSeries(item.key, { label: event.target.value })} placeholder={`Series ${index + 1}`} required value={item.label ?? ""} />
              </label>
              <label>Prefix
                <input className="field id-generation-soft-placeholder" name="row_prefix" onChange={(event) => updateSeries(item.key, { prefix: event.target.value })} placeholder="Optional" value={item.prefix ?? ""} />
              </label>
              <label>Separator
                <input className="field id-generation-soft-placeholder" name="row_separator" onChange={(event) => updateSeries(item.key, { separator: event.target.value })} placeholder="Optional" value={item.separator ?? ""} />
              </label>
              <label>Starting number
                <input className="field" min={1} name="row_next_serial_no" onChange={(event) => updateSeries(item.key, { next_serial_no: Number(event.target.value) })} required type="number" value={item.next_serial_no ?? 1} />
              </label>
              <label>Minimum digit
                <input className="field" max={12} min={1} name="row_serial_digits" onChange={(event) => updateSeries(item.key, { serial_digits: Number(event.target.value) })} required type="number" value={item.serial_digits ?? 3} />
              </label>
              <label>Suffix
                <input className="field id-generation-soft-placeholder" name="row_suffix" onChange={(event) => updateSeries(item.key, { suffix: event.target.value })} placeholder="Optional" value={item.suffix ?? ""} />
              </label>
              <label>Sample
                <code className="multi-designation-sample">{sample}</code>
              </label>
            </div>
            <div className="multi-designation-picker">
              <span className="field-label">Designations</span>
              {selectedDesignations.length ? (
                <div className="multi-designation-tags" aria-label="Selected designations">
                  {selectedDesignations.map((designation) => (
                    <button
                      className="multi-designation-tag"
                      key={designation.id}
                      onClick={() => updateSeries(item.key, { designation_ids: item.designation_ids.filter((id) => id !== designation.id) })}
                      title={`Remove ${optionLabel(designation)}`}
                      type="button"
                    >
                      <span>{optionLabel(designation)}</span>
                      <b aria-hidden="true">×</b>
                    </button>
                  ))}
                </div>
              ) : null}
              <details className="multi-designation-dropdown">
                <summary>
                  <span>{item.designation_ids.length ? `${item.designation_ids.length} designation${item.designation_ids.length === 1 ? "" : "s"} selected` : "Select designations"}</span>
                  <span aria-hidden="true">⌄</span>
                </summary>
                <div className="multi-designation-options">
                  {designations.map((designation) => {
                    const owner = assignedTo.get(designation.id);
                    const checked = item.designation_ids.includes(designation.id);
                    const unavailable = Boolean(owner && owner !== item.key);
                    return (
                      <label className={`${checked ? "selected" : ""} ${unavailable ? "disabled" : ""}`} key={designation.id}>
                        <input
                          checked={checked}
                          disabled={unavailable}
                          onChange={(event) => updateSeries(item.key, {
                            designation_ids: event.target.checked
                              ? [...item.designation_ids, designation.id]
                              : item.designation_ids.filter((id) => id !== designation.id)
                          })}
                          type="checkbox"
                        />
                        <span>{optionLabel(designation)}</span>
                        {unavailable ? <small>Already used in another series</small> : null}
                      </label>
                    );
                  })}
                </div>
              </details>
            </div>
          </div>
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
    designation: designations,
    multi_designation: []
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

          {selectedScope === "multi_designation" ? (
            <MultiDesignationRows defaultPrefix={defaultPrefix} designations={designations} setting={setting} />
          ) : selectedScope ? (
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
