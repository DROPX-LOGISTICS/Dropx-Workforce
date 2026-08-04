"use client";

import { useState } from "react";
import { SearchableSelect } from "@/components/searchable-select";

export type ScopedLocationOption = {
  value: string;
  label: string;
  helper?: string;
  modelId?: string | null;
};

export type ScopedDesignationOption = {
  value: string;
  label: string;
  code?: string;
  helper?: string;
  modelIds?: string[];
  dashboardRules?: { enabled: string[]; required: string[] };
};

function designationOptionsForLocation(
  locationId: string,
  locations: ScopedLocationOption[],
  designations: ScopedDesignationOption[]
) {
  if (!locationId) return [];
  const modelId = locations.find((location) => location.value === locationId)?.modelId ?? "";
  return designations.filter((designation) => {
    const modelIds = designation.modelIds ?? [];
    return !modelIds.length || (modelId ? modelIds.includes(modelId) : false);
  });
}

export function ScopedDesignationFields({
  designationName,
  designationOptions,
  initialDesignation = "",
  initialLocationId = "",
  locationName,
  locationOptions,
  onDesignationChange,
  required = true,
  vehicleTypeName = "vehicle_type",
  initialVehicleType = ""
}: {
  designationName: string;
  designationOptions: ScopedDesignationOption[];
  initialDesignation?: string | null;
  initialLocationId?: string | null;
  locationName: string;
  locationOptions: ScopedLocationOption[];
  onDesignationChange?: (value: string) => void;
  required?: boolean;
  vehicleTypeName?: string;
  initialVehicleType?: string | null;
}) {
  const [selectedLocationId, setSelectedLocationId] = useState(initialLocationId ?? "");
  const [selectedDesignation, setSelectedDesignation] = useState(initialDesignation ?? "");
  const filteredDesignationOptions = designationOptionsForLocation(selectedLocationId, locationOptions, designationOptions);
  const effectiveDesignationOptions = selectedDesignation && !filteredDesignationOptions.some((option) => option.value === selectedDesignation)
    ? [{ value: selectedDesignation, label: selectedDesignation, helper: "Current", modelIds: [] }, ...filteredDesignationOptions]
    : filteredDesignationOptions;
  const designationDisabled = !selectedLocationId || !effectiveDesignationOptions.length;
  const selectedDesignationCode = effectiveDesignationOptions.find((option) => option.value === selectedDesignation)?.code ?? "";
  const vehicleTypeRequired = ["DA", "PTDA"].includes(selectedDesignationCode.toUpperCase());

  return (
    <>
      <label>Location
        <SearchableSelect
          name={locationName}
          onValueChange={(value) => {
            setSelectedLocationId(value);
            setSelectedDesignation("");
            onDesignationChange?.("");
          }}
          options={locationOptions}
          placeholder="Select location"
          required={required}
          value={selectedLocationId}
        />
      </label>
      <label>Designation
        <SearchableSelect
          disabled={designationDisabled}
          name={designationName}
          onValueChange={(value) => {
            setSelectedDesignation(value);
            onDesignationChange?.(value);
          }}
          options={effectiveDesignationOptions}
          placeholder={selectedLocationId ? "Select designation" : "Select location first"}
          required={required && !designationDisabled}
          value={selectedDesignation}
        />
      </label>
      {vehicleTypeRequired ? <label>Vehicle type
        <SearchableSelect
          name={vehicleTypeName}
          options={[{ value: "bike", label: "Bike" }, { value: "van", label: "Van" }]}
          placeholder="Select Bike or Van"
          required
          defaultValue={initialVehicleType ?? ""}
        />
      </label> : null}
    </>
  );
}
