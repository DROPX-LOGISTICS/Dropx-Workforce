import {NextRequest,NextResponse} from 'next/server';
import {getAuthorization,hasPermission} from '@/lib/authorization';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {betaLifecycleEnabled} from '@/lib/beta-lifecycle';
import {betaReportUrl,readBetaPdf} from '@/lib/beta-report';
export const dynamic='force-dynamic';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(request:NextRequest) {
 const auth=await getAuthorization(),candidate=request.nextUrl.searchParams.get('candidate')??'';
 if(!auth||auth.readOnly||!hasPermission(auth,'delivery_associates','view')||!supabaseAdmin||!betaLifecycleEnabled(auth.companyId,candidate))return NextResponse.json({error:'Report access is unavailable.'},{status:403,headers});
 const result=await supabaseAdmin.from('workforce_amazon_email_pilot_candidates').select('station_id,alias_email').eq('company_id',auth.companyId!).eq('id',candidate).maybeSingle();
 if(result.error||!result.data||(!auth.hasAllLocationAccess&&!auth.locationScopeIds.includes(result.data.station_id)))return NextResponse.json({error:'Report access is unavailable.'},{status:403,headers});
 try {
  const base=process.env.WORKFORCE_AMAZON_WORKER_URL?.trim().replace(/\/$/,''),key=process.env.WORKFORCE_AMAZON_WORKER_KEY?.trim()||process.env.WORKFORCE_AMAZON_WORKER_ADMIN_KEY?.trim();
  if(!base||!key)throw new Error('Report connection is not configured.');
  const response=await fetch(`${base}/api/admin/beta/idfy/report`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','x-admin-key':key},body:JSON.stringify({candidateId:candidate}),signal:AbortSignal.timeout(95000)});
  if(!response.ok)throw new Error('IDfy report is temporarily unavailable.');
  const report=await response.json();
  if(report.candidateId!==candidate||String(report.email).toLowerCase()!==result.data.alias_email.toLowerCase()||!/^\d+$/.test(String(report.profileId)))throw new Error('Report identity could not be verified.');
  const url=betaReportUrl(report.reportUrl);if(!url)return NextResponse.json({error:'IDfy has not published a report yet.'},{status:404,headers});
  const pdf=await readBetaPdf(await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)}));
  return new Response(pdf,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="IDfy-verification-${report.profileId}.pdf"`,'Content-Length':String(pdf.length)}});
 }catch{return NextResponse.json({error:'The IDfy report could not be downloaded. Retry shortly; confirmed check results remain visible.'},{status:503,headers});}
}
