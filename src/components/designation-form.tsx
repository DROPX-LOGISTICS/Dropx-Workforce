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
  type ProfileFieldRule
} from "@/lib/profile-field-rules";

type ProviderOption = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type LocationOption = {
  id: string;
  station_code: string;
  station_name: string | null;
  hide_from_location_list?: boolean | null;
};

type DesignationInitial = {
  id: string;
  code: string;
  name: string;
  provider_ids: string[];
  location_ids: string[];
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
  rules: DesignationProfileFieldRules["employees"];
  title: string;
}) {
  const [enabled, setEnabled] = useState<string[]>(rules.enabled);
  const [required, setRequired] = useState<string[]>(rules.required.filter((key) => rules.enabled.includes(key)));
  const enabledSet = useMemo(() => new Set(enabled), [enabled]);
  const requiredSet = useMemo(() => new Set(required), [required]);

  function toggleEnabled(key: string) {
    if (enabledSet.has(key)) {
      setEnabled(enabled.filter((value) => value !== key));
      setRequired(required.filter((value) => value !== key));
      return;
    }
    setEnabled([...enabled, key]);
  }

  function toggleRequired(key: string) {
    if (!enabledSet.has(key)) {
      setEnabled([...enabled, key]);
      setRequired([...required, key]);
      return;
    }
    setRequired(requiredSet.has(key) ? required.filter((value) => value !== key) : [...required, key]);
  }

  const grouped = fields.reduce<Record<string, ProfileFieldRule[]>>((acc, field) => {
    acc[field.group] = [...(acc[field.group] ?? []), field];
    return acc;
  }, {});

  return (
    <section className="designation-field-rules">
      {enabled.map((key) => <input key={`enabled-${key}`} name={`${namePrefix}_enabled_fields`} type="hidden" value={key} />)}
      {required.map((key) => <input key={`required-${key}`} name={`${namePrefix}_required_fields`} type="hidden" value={key} />)}
      <div className="designation-field-rules-head">
        <h3>{title}</h3>
        <p className="subtle">Choose which profile fields appear in app onboarding and which must be filled.</p>
      </div>
      {Object.entries(grouped).map(([group, groupFields]) => (
        <div className="designation-rule-group" key={group}>
          <h4>{group}</h4>
          <div className="designation-rule-list">
            {groupFields.map((field) => (
              <div className="designation-rule-row" key={field.key}>
                <div>
                  <strong>{field.label}</strong>
                  <small>{field.kind}</small>
                </div>
                <label className="check-row">
                  <input checked={enabledSet.has(field.key)} className="matrix-checkbox" onChange={() => toggleEnabled(field.key)} type="checkbox" />
                  <span>Enable</span>
                </label>
                <label className="check-row">
                  <input checked={requiredSet.has(field.key)} className="matrix-checkbox" onChange={() => toggleRequired(field.key)} type="checkbox" />
                  <span>Required</span>
                </label>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function LocationMultiSelect({
  locations,
  selected,
  setSelected
}: {
  locations: LocationOption[];
  selected: string[];
  setSelected: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => locations.filter((location) => {
    const haystack = `${location.station_code} ${location.station_name ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [locations, query]);
  const selectedLocations = locations.filter((location) => selectedSet.has(location.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every((location) => selectedSet.has(location.id));
  const summary = selectedLocations.length
    ? `${selectedLocations.length} selected`
    : locations.length
      ? "Select locations"
      : "No locations added";

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
      const filteredIds = new Set(filtered.map((location) => location.id));
      setSelected(selected.filter((value) => !filteredIds.has(value)));
      return;
    }
    setSelected(Array.from(new Set([...selected, ...filtered.map((location) => location.id)])));
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
        <div className="multi-select-menu designation-location-menu">
          <div className="multi-select-search">
            <input
              className="field"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search location"
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
            {filtered.length ? filtered.map((location) => (
              <label className="multi-select-option" key={location.id}>
                <input checked={selectedSet.has(location.id)} className="matrix-checkbox" onChange={() => toggle(location.id)} type="checkbox" />
                <span>
                  <strong>{location.station_code}</strong>
                  <small>{[location.station_name, location.hide_from_location_list ? "Hidden" : ""].filter(Boolean).join(" - ")}</small>
                </span>
              </label>
            )) : <div className="searchable-empty">No locations found</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DesignationForm({
  action,
  initial,
  locations,
  submitLabel = "Add designation"
}: {
  action: (formData: FormData) => void;
  initial?: DesignationInitial | null;
  providers?: ProviderOption[];
  locations: LocationOption[];
  submitLabel?: string;
}) {
  const [selectedLocations, setSelectedLocations] = useState<string[]>(initial?.location_ids ?? []);
  const [selectedCategories, setSelectedCategories] = useState<DesignationCategory[]>(
    normalizeDesignationCategories(initial?.onboarding_categories)
  );
  const fieldRules = normalizeProfileFieldRules(initial?.profile_field_rules);
  const showEmployeeFields = selectedCategories.includes("employees");
  const showFieldExecutiveFields =
    selectedCategories.includes("field_executives") || selectedCategories.includes("delivery_executives");
  const hasVisibleFieldRules = showEmployeeFields || showFieldExecutiveFields;

  return (
    <form action={action} className="designation-form">
      {initial ? <input name="id" type="hidden" value={initial.id} /> : null}
      {selectedLocations.map((locationId) => (
        <input key={locationId} name="location_ids" type="hidden" value={locationId} />
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
          Locations
          <LocationMultiSelect locations={locations} selected={selectedLocations} setSelected={setSelectedLocations} />
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
            <FieldRuleMatrix fields={fieldExecutiveProfileFields} namePrefix="field_executives" rules={fieldRules.field_executives} title="Delivery executive fields" />
          ) : null}
        </div>
      ) : (
        <div className="designation-field-rule-empty">Select Employees, Field executives, or Delivery executives to configure onboarding fields.</div>
      )}
      <div className="form-actions right">
        <SubmitButton className="button" pendingText="Saving">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
