"use client";

import { useMemo, useState } from "react";
import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";

type ModelOption = SearchableSelectOption & {
  providerId: string | null;
};

export function LocationProviderModelFields({
  initialModelId,
  initialProviderId,
  modelOptions,
  providerOptions
}: {
  initialModelId?: string | null;
  initialProviderId?: string | null;
  modelOptions: ModelOption[];
  providerOptions: SearchableSelectOption[];
}) {
  const [providerId, setProviderId] = useState(initialProviderId ?? "");
  const [modelId, setModelId] = useState(initialModelId ?? "");
  const filteredModels = useMemo(
    () => providerId ? modelOptions.filter((model) => model.providerId === providerId) : [],
    [modelOptions, providerId]
  );
  const selectedModelAllowed = filteredModels.some((model) => model.value === modelId);

  function updateProvider(value: string) {
    setProviderId(value);
    setModelId("");
  }

  return (
    <>
      <label>Provider
        <SearchableSelect
          name="provider_id"
          onValueChange={updateProvider}
          options={providerOptions}
          placeholder="Search provider"
          value={providerId}
        />
      </label>
      <label>Model
        <SearchableSelect
          disabled={!providerId}
          name="location_model_id"
          onValueChange={setModelId}
          options={filteredModels}
          placeholder={providerId ? "Search model" : "Select provider first"}
          value={selectedModelAllowed ? modelId : ""}
        />
      </label>
    </>
  );
}
