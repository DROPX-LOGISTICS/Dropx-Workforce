export type RegisterDesignation = { id: string; code: string; name: string };

export function hasWorkforcePaymentIdentity(worker: { designation_id: string; dropx_id: string | null }, workforceDesignationIds: Set<string>) {
  // A canonical Workforce record is classified by today's master, not its legacy source table.
  return workforceDesignationIds.has(worker.designation_id) && Boolean(worker.dropx_id?.trim());
}

const normalize = (value: string) => value.trim().toLocaleLowerCase();

// Match master code or full name, never substrings (DA must not include ODCD/PTDA).
export function designationMatches(value: string, designation: RegisterDesignation) {
  const key = normalize(value);
  return key === normalize(designation.code) || key === normalize(designation.name);
}

export function registerDesignationOptions(master: RegisterDesignation[], values: string[]) {
  const options = master.map(item => ({ ...item, values: values.filter(value => designationMatches(value, item)) }));
  for (const value of new Set(values)) {
    if (!options.some(item => item.values.includes(value))) {
      options.push({ id: `legacy:${value}`, code: value, name: value, values: [value] });
    }
  }
  return options;
}
