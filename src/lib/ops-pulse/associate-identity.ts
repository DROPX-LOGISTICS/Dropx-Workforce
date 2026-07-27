export function isScientificAssociateId(value: string) {
  return /^\d+(?:\.\d+)?e[+-]?\d+$/i.test(value.trim());
}

export function normalizeAssociateName(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function associateIdentityKey(stationCode: string, id: string, name: string | null | undefined) {
  const base = `${stationCode}|${id}`;
  return isScientificAssociateId(id) ? `${base}|${normalizeAssociateName(name) || "unmapped"}` : base;
}

export function associateMatches(id: string, requestedName: string, rowId: string, rowName: string | null | undefined) {
  if (requestedName) return normalizeAssociateName(rowName) === normalizeAssociateName(requestedName);
  return rowId === id;
}
