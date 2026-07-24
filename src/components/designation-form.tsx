"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { designationCategoryOptions, normalizeDesignationCategories, type DesignationCategory } from "@/lib/designation-categories";
import {
  employeeProfileFields,
  fieldExecutiveProfileFields,
  normalizeProfileFieldRules,
  type DesignationProfileFieldRules,
  type ProfileFieldChannelRules,
  type ProfileFieldRule,
  type ProfileFieldRuleSet
} from "@/lib/profile-field-rules";

type ProviderOption = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type ModelOption = {
  id: string;
  code: string;
  name: string;
  provider?: string | null;
};

type DesignationInitial = {
  id: string;
  code: string;
  name: string;
  provider_ids: string[];
  model_ids?: string[] | null;
  onboarding_categories?: string[] | null;
  profile_field_rules?: unknown;
  is_active: boolean;
};

function CategoryMultiSelect({
  selected,
  setSelected
}: {
  selected: DesignationCategory[];
  setSelected: (value: DesignationCategory[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const summary = selected.length
    ? selected.map((category) => designationCategoryOptions.find((option) => option.value === category)?.label ?? category).join(", ")
    : "Select categories";

  useEffect(() => {
    if (!open) return;

    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  function toggle(value: DesignationCategory) {
    setSelected(selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  return (
    <div className="multi-select" ref={rootRef}>
      <button
        className={`multi-select-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="multi-select-summary">{summary}</span>
        <ChevronDown aria-hidden="true" className="multi-select-chevron" size={16} strokeWidth={2.4} />
      </button>
      {open ? (
        <div className="multi-select-menu designation-category-menu">
          <div className="multi-select-options compact">
            {designationCategoryOptions.map((category) => (
              <label className="multi-select-option" key={category.value}>
                <input
                  checked={selectedSet.has(category.value)}
                  className="matrix-checkbox"
                  onChange={() => toggle(category.value)}
                  type="checkbox"
                />
                <span><strong>{category.label}</strong></span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FieldRuleMatrix({
  fields,
  namePrefix,
  rules,
  title
}: {
  fields: ProfileFieldRule[];
  namePrefix: "employees" | "field_executives";
  rules: ProfileFieldChannelRules;
  title: string;
}) {
  const [dropxOne, setDropxOne] = useState<ProfileFieldRuleSet>(rules.dropx_one);
  const [dashboard, setDashboard] = useState<ProfileFieldRuleSet>(rules.dashboard);

  function toggleRule(
    scope: ProfileFieldRuleSet,
    setScope: (value: ProfileFieldRuleSet) => void,
    key: string,
    type: "enabled" | "required"
  ) {
    const enabledSet = new Set(scope.enabled);
    const requiredSet = new Set(scope.required);
    if (type === "enabled") {
      if (enabledSet.has(key)) {
        enabledSet.delete(key);
        requiredSet.delete(key);
      } else {
        enabledSet.add(key);
      }
    } else if (requiredSet.has(key)) {
      requiredSet.delete(key);
    } else {
      enabledSet.add(key);
      requiredSet.add(key);
    }
    setScope({ enabled: Array.from(enabledSet), required: Array.from(requiredSet) });
  }

  const grouped = fields.reduce<Record<string, ProfileFieldRule[]>>((acc, field) => {
    acc[field.group] = [...(acc[field.group] ?? []), field];
    return acc;
  }, {});

  return (
    <section className="designation-field-rules">
      {dropxOne.enabled.map((key) => <input key={`dropx-enabled-${key}`} name={`${namePrefix}_dropx_one_enabled_fields`} type="hidden" value={key} />)}
      {dropxOne.required.map((key) => <input key={`dropx-required-${key}`} name={`${namePrefix}_dropx_one_required_fields`} type="hidden" value={key} />)}
      {dashboard.enabled.map((key) => <input key={`dashboard-enabled-${key}`} name={`${namePrefix}_dashboard_enabled_fields`} type="hidden" value={key} />)}
      {dashboard.required.map((key) => <input key={`dashboard-required-${key}`} name={`${namePrefix}_dashboard_required_fields`} type="hidden" value={key} />)}
      <div className="designation-field-rules-head">
        <h3>{title}</h3>
        <p className="subtle">Configure visibility and required fields independently for DropX One and Dashboard.</p>
      </div>
      {Object.entries(grouped).map(([group, groupFields]) => (
        <div className="designation-rule-group" key={group}>
          <h4>{group}</h4>
          <div className="designation-rule-list">
            {groupFields.map((field) => (
              <div className="designation-rule-row" key={field.key}>
                <div className="designation-rule-name">
                  <strong>{field.label}</strong>
                  <small>{field.kind}</small>
                </div>
                {([
                  ["DropX One", dropxOne, setDropxOne],
                  ["Dashboard", dashboard, setDashboard]
                ] as const).map(([label, scope, setScope]) => (
                  <div className="designation-rule-channel" key={label}>
                    <strong>{label}</strong>
                    <label className="check-row">
                      <input
                        checked={scope.enabled.includes(field.key)}
                        className="matrix-checkbox"
                        onChange={() => toggleRule(scope, setScope, field.key, "enabled")}
                        type="checkbox"
                      />
                      <span>Enable</span>
                    </label>
                    <label className="check-row">
                      <input
                        checked={scope.required.includes(field.key)}
                        className="matrix-checkbox"
                        onChange={() => toggleRule(scope, setScope, field.key, "required")}
                        type="checkbox"
                      />
                      <span>Required</span>
                    </label>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ModelMultiSelect({
  models,
  selected,
  setSelected
}: {
  models: ModelOption[];
  selected: string[];
  setSelected: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => models.filter((model) => {
    const haystack = `${model.code} ${model.name} ${model.provider ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [models, query]);
  const selectedModels = models.filter((model) => selectedSet.has(model.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every((model) => selectedSet.has(model.id));
  const summary = selectedModels.length
    ? `${selectedModels.length} selected`
    : models.length
      ? "Select models"
      : "No models added";

  useEffect(() => {
    if (!open) return;

    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function toggle(id: string) {
    setSelected(selectedSet.has(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }

  function toggleAllFiltered() {
    if (allFilteredSelected) {
      const filteredIds = new Set(filtered.map((model) => model.id));
      setSelected(selected.filter((value) => !filteredIds.has(value)));
      return;
    }
    setSelected(Array.from(new Set([...selected, ...filtered.map((model) => model.id)])));
  }

  return (
    <div className="multi-select" ref={rootRef}>
      <button
        className={`multi-select-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>{summary}</span>
        <ChevronDown aria-hidden="true" className="multi-select-chevron" size={16} strokeWidth={2.4} />
      </button>
      {open ? (
        <div className="multi-select-menu designation-model-menu">
          <div className="multi-select-search">
            <input
              className="field"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search model"
              value={query}
            />
            <button className="button secondary" onClick={() => setQuery("")} type="button">Clear</button>
          </div>
          <label className="multi-select-all">
            <input checked={allFilteredSelected} className="matrix-checkbox" onChange={toggleAllFiltered} type="checkbox" />
            <span>Check all filtered</span>
            <small>{filtered.length} shown</small>
          </label>
          <div className="multi-select-options">
            {filtered.length ? filtered.map((model) => (
              <label className="multi-select-option" key={model.id}>
                <input checked={selectedSet.has(model.id)} className="matrix-checkbox" onChange={() => toggle(model.id)} type="checkbox" />
                <span>
                  <strong>{model.code}</strong>
                  <small>{[model.name, model.provider].filter(Boolean).join(" - ")}</small>
                </span>
              </label>
            )) : <div className="searchable-empty">No models found</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DesignationForm({
  action,
  initial,
  models,
  submitLabel = "Add designation"
}: {
  action: (formData: FormData) => void;
  initial?: DesignationInitial | null;
  providers?: ProviderOption[];
  models: ModelOption[];
  submitLabel?: string;
}) {
  const [selectedModels, setSelectedModels] = useState<string[]>(initial?.model_ids ?? []);
  const [selectedCategories, setSelectedCategories] = useState<DesignationCategory[]>(
    normalizeDesignationCategories(initial?.onboarding_categories)
  );
  const fieldRules = normalizeProfileFieldRules(initial?.profile_field_rules);
  const showEmployeeFields = selectedCategories.includes("employees");
  const showFieldExecutiveFields =
    selectedCategories.includes("field_executives") ||
    selectedCategories.includes("delivery_executives") ||
    selectedCategories.includes("contractors");
  const fieldExecutiveFieldTitle = selectedCategories.includes("contractors") &&
    !selectedCategories.includes("field_executives") &&
    !selectedCategories.includes("delivery_executives")
      ? "Independent Contractor fields"
      : selectedCategories.includes("contractors")
        ? "Delivery executive / Independent Contractor fields"
        : "Delivery executive fields";
  const hasVisibleFieldRules = showEmployeeFields || showFieldExecutiveFields;

  return (
    <form action={action} className="designation-form">
      {initial ? <input name="id" type="hidden" value={initial.id} /> : null}
      {selectedModels.map((modelId) => (
        <input key={modelId} name="model_ids" type="hidden" value={modelId} />
      ))}
      {selectedCategories.map((category) => (
        <input key={category} name="onboarding_categories" type="hidden" value={category} />
      ))}
      <div className="form-grid three">
        <label>
          Designation code
          <input className="field" defaultValue={initial?.code ?? ""} name="code" placeholder="Enter designation code" required />
        </label>
        <label>
          Designation name
          <input className="field" defaultValue={initial?.name ?? ""} name="name" placeholder="Enter designation name" required />
        </label>
        <label>
          Category
          <CategoryMultiSelect selected={selectedCategories} setSelected={setSelectedCategories} />
        </label>
        <label>
          Models
          <ModelMultiSelect models={models} selected={selectedModels} setSelected={setSelectedModels} />
        </label>
        {initial ? (
          <label>
            Status
            <select className="field" defaultValue={initial.is_active ? "active" : "inactive"} name="status">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        ) : null}
      </div>
      {hasVisibleFieldRules ? (
        <div className={`designation-field-rule-grid ${showEmployeeFields !== showFieldExecutiveFields ? "single" : ""}`}>
          {showEmployeeFields ? (
            <FieldRuleMatrix fields={employeeProfileFields} namePrefix="employees" rules={fieldRules.employees} title="Employee fields" />
          ) : null}
          {showFieldExecutiveFields ? (
            <FieldRuleMatrix fields={fieldExecutiveProfileFields} namePrefix="field_executives" rules={fieldRules.field_executives} title={fieldExecutiveFieldTitle} />
          ) : null}
        </div>
      ) : (
        <div className="designation-field-rule-empty">Select Employees, Field executives, Delivery executives, or Independent Contractor to configure onboarding fields.</div>
      )}
      <div className="form-actions right">
        <SubmitButton className="button" pendingText="Saving">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
