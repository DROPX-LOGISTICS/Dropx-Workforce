type Designation = {id:string;code:string|null;name:string|null;category:{people_module:string|null}|{people_module:string|null}[]|null};

/** An explicit canonical designation always wins over a stale display label. */
export function workforceDesignationPredicate(designations:Designation[]) {
  const rows=designations.filter(row=>(Array.isArray(row.category)?row.category[0]:row.category)?.people_module==='delivery_network');
  const ids=new Set(rows.map(row=>row.id));
  const keys=new Set(rows.flatMap(row=>[row.code,row.name].map(value=>String(value??'').trim().toLowerCase()).filter(Boolean)));
  return (person:{designation_id?:string|null;designation?:string|null})=>person.designation_id
    ? ids.has(person.designation_id)
    : keys.has(String(person.designation??'').trim().toLowerCase());
}
