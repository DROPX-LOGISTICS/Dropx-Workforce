import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { readAllRows } from '@/lib/supabase-pagination';
import { workforceDesignationPredicate } from '@/lib/workforce-designation-policy';
import { replacementAuthorized, replacementFilters, replacementSources } from '@/lib/workforce-replacement-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const emptyId = '00000000-0000-0000-0000-000000000000';
const headers = {'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff'};
const reply = (body: unknown, status = 200) => NextResponse.json(body, {status, headers});

/** Server-to-server, company-bound, read-only integration for the restricted replacement.
 * This credential cannot perform mutations or select arbitrary database resources.
 * It is independent of the database service key, which never leaves this application.
 */
export async function GET(request: NextRequest) {
  if (!replacementAuthorized(request.headers.get('authorization'), process.env.WORKFORCE_REPLACEMENT_TOKEN)) return reply({error:'Unauthorized.'},401);
  const company = process.env.WORKFORCE_REPLACEMENT_COMPANY_ID;
  if (!supabaseAdmin || !company || !/^[0-9a-f-]{36}$/i.test(company)) return reply({error:'Source is not configured.'},503);
  const params = request.nextUrl.searchParams;
  const kind = params.get('kind') || 'overview';
  if (!['context','overview','people'].includes(kind) && !Object.hasOwn(replacementSources,kind)) return reply({error:'Unknown source.'},400);
  let filters;
  try { filters = replacementFilters(params); } catch { return reply({error:'Invalid filters.'},400); }
  try {
    const db = supabaseAdmin;
    const result = await Promise.all([
      readAllRows(db.from('workforce').select('id,full_name,dropx_id,designation,designation_id,location_id,date_of_join,onboarding_status,lifecycle_status,provider_id_status,provider_employee_id,is_active,last_working_date,source_profile_type,source_profile_id,compatibility_mode,migration_state').eq('company_id',company).is('deleted_at',null).neq('migration_state','reclassified').order('id')),
      readAllRows(db.from('designations').select('id,code,name,is_active,category:designation_categories!designations_designation_category_id_fkey(people_module)').eq('company_id',company).order('id')),
      readAllRows(db.from('stations').select('id,station_code,station_name,provider_id,is_active').eq('company_id',company).order('station_code').order('id')),
      readAllRows(db.from('providers').select('id,code,name,is_active').eq('company_id',company).order('id')),
    ]);
    if (result.some(r=>r.error)) throw new Error('Context query failed.');
    const classify = workforceDesignationPredicate(result[1].data || []);
    const allPeople = (result[0].data || []).filter(classify);
    const stations = result[2].data || [];
    const selectedStation = stations.find(s=>s.id===filters.station);
    if (filters.station && !selectedStation) return reply({error:'Unknown station.'},400);
    const people = allPeople.filter(p=>!filters.station || p.location_id===filters.station);
    const identities = (column:string, type?:string) => people.filter(p=>!type || p.source_profile_type===type).map(p=>String(p[column])).filter(v=>/^[0-9a-f-]{36}$/i.test(v));
    const inValues = (values:string[]) => (values.length ? values : [emptyId]).join(',');
    const canonicalIds = identities('id');
    const ownPerson = (row:Record<string,unknown>) => allPeople.find(p=>row.workforce_id===p.id || (p.source_profile_id && ((p.source_profile_type==='field_executive' && row.field_executive_id===p.source_profile_id) || (p.source_profile_type==='contractor' && row.contractor_id===p.source_profile_id) || (p.source_profile_type==='employee' && row.employee_id===p.source_profile_id))));
    const base = {kind,readOnly:true,readAt:new Date().toISOString()};
    if (kind==='context') return reply({...base,people:allPeople,stations,providers:result[3].data,designations:(result[1].data || []).filter(d=>(Array.isArray(d.category)?d.category[0]:d.category)?.people_module==='delivery_network'),sources:Object.keys(replacementSources)});
    if (kind==='people') {
      const rows = people.filter(p=>!filters.q || [p.full_name,p.dropx_id,p.designation,p.provider_employee_id].some(v=>String(v||'').toLowerCase().includes(filters.q.toLowerCase())));
      return reply({...base,rows:rows.slice(filters.page*100,(filters.page+1)*100),page:filters.page,total:rows.length,hasMore:rows.length>(filters.page+1)*100});
    }
    if (kind==='overview') {
      let latestQuery = db.from('cps_shipment_daily').select('work_date').eq('company_id',company).order('work_date',{ascending:false}).limit(1);
      if(selectedStation)latestQuery=latestQuery.eq('station_code',selectedStation.station_code);
      const latest = await latestQuery;
      if(latest.error)throw latest.error;
      const day = latest.data?.[0]?.work_date;
      let production = db.from('cps_shipment_daily').select(replacementSources.shipments.select).eq('company_id',company).eq('work_date',day || '1900-01-01').order('id');
      if(selectedStation)production=production.eq('station_code',selectedStation.station_code);
      const [daily,mappings,batches,joining] = await Promise.all([
        readAllRows(production),
        readAllRows(db.from('field_executive_provider_mappings').select(replacementSources.mappings.select).eq('company_id',company).order('id')),
        db.from('report_import_batches').select(replacementSources.imports.select).eq('company_id',company).eq('source_type','amazon_shipments').order('created_at',{ascending:false}).limit(3),
        db.from('workforce_joining_plans').select('workforce_id,provider_stage,next_follow_up_on,eligible_from,training_completed_on,provider_activated_on').eq('company_id',company).in('workforce_id',canonicalIds.length?canonicalIds:[emptyId]).order('workforce_id').limit(1000),
      ]);
      if([daily,mappings,batches,joining].some(r=>r.error))throw new Error('Overview query failed.');
      const rows = (daily.data || []).map(row=>{
        const station = stations.find(s=>s.station_code===row.station_code);
        const provider = (result[3].data || []).find(p=>p.name.toLowerCase()===String(row.client).toLowerCase() || p.code.toLowerCase()===String(row.client).toLowerCase());
        const matches = (mappings.data || []).filter(m=>m.station_id===station?.id && m.provider_id===provider?.id && m.provider_member_id===row.provider_employee_id && m.effective_from<=row.work_date && (!m.effective_to || m.effective_to>=row.work_date) && m.status!=='cancelled');
        const person = matches.length===1 ? ownPerson(matches[0]) : undefined;
        return {...row,canonical_id:person?.id || null,dropx_id:person?.dropx_id || null,link_status:matches.length>1?'Overlapping mappings':matches.length===0?'Unmapped ID':!person?'Identity needs reconciliation':'Linked'};
      });
      const total = (key:string) => rows.reduce((sum,row)=>sum+Number(row[key]||0),0);
      return reply({...base,day:day||null,associateCount:people.length,activeProfileCount:people.filter(p=>p.is_active).length,workingIds:new Set(rows.map(r=>r.provider_employee_id)).size,stationCount:new Set(rows.map(r=>r.station_code)).size,shipmentRows:rows.length,deliveries:total('total_delivery'),amazon:total('amazon_delivery'),swa:total('swa_delivery'),returns:total('c_return'),pickups:total('mfn'),sellerReturns:total('mfn_return'),unmapped:rows.filter(r=>r.link_status!=='Linked').length,paymentMissing:rows.filter(r=>r.mapping_status==='Payment setup missing').length,sourceUpdatedAt:rows.map(r=>r.updated_at).filter(Boolean).sort().at(-1)||null,exceptions:rows.filter(r=>r.link_status!=='Linked'||r.mapping_status==='Payment setup missing'),joining:joining.data,batches:batches.data});
    }
    const spec = replacementSources[kind];
    let query = db.from(spec.table).select(spec.select,{count:'exact'}).eq('company_id',company);
    if(spec.station && selectedStation)query=query.eq(spec.station,spec.station==='station_code'?selectedStation.station_code:selectedStation.id);
    if(spec.date){if(filters.from)query=query.gte(spec.date,filters.from);if(filters.to)query=query.lte(spec.date,filters.to);}
    if(spec.search && filters.q)query=query.eq(spec.search,filters.q);
    if(spec.person==='workforce_id')query=query.in('workforce_id',canonicalIds.length?canonicalIds:[emptyId]);
    if(spec.person==='attendance')query=query.or(`workforce_id.in.(${inValues(canonicalIds)}),field_executive_id.in.(${inValues(identities('source_profile_id','field_executive'))}),contractor_id.in.(${inValues(identities('source_profile_id','contractor'))})`);
    if(kind==='imports')query=query.eq('source_type','amazon_shipments');
    if(kind==='exits'||kind==='settlements'){
      const cases = await readAllRows(db.from('workforce_lifecycle_cases').select('id,profile_type,profile_id,field_executive_id').eq('company_id',company).order('id'));
      if(cases.error)throw cases.error;
      const caseIds = (cases.data || []).filter(c=>people.some(p=>(c.profile_type==='workforce'&&c.profile_id===p.id)||(p.source_profile_id&&c.profile_type===p.source_profile_type&&c.profile_id===p.source_profile_id)||(p.source_profile_type==='field_executive'&&c.field_executive_id===p.source_profile_id))).map(c=>c.id);
      query=query.in(kind==='exits'?'id':'lifecycle_case_id',caseIds.length?caseIds:[emptyId]);
    }
    const data = await query.order(spec.order,{ascending:['paymentTypes','paymentFields','metrics','metricLinks','agreements','checklists'].includes(kind)}).order(['joining','amazon'].includes(kind)?'workforce_id':'id').range(filters.page*100,filters.page*100+99);
    if(data.error)throw data.error;
    const rows = (data.data || []).map(row=>{
      const record=row as unknown as Record<string,unknown>;
      const person=ownPerson(record);
      return {...record,...(person?{canonical_id:person.id,associate_name:person.full_name,dropx_id:person.dropx_id}:{})};
    });
    return reply({...base,rows,page:filters.page,total:data.count,hasMore:(data.count || 0)>(filters.page+1)*100});
  } catch (error) {
    console.error('[workforce-replacement] read failed',{kind,code:typeof error==='object'&&error&&'code' in error?error.code:'query'});
    return reply({error:'The source could not be read. No records were changed.'},502);
  }
}
