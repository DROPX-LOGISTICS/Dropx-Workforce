import {NextRequest,NextResponse} from 'next/server';
import {getAuthorization,hasPermission} from '@/lib/authorization';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {betaLifecycleEnabled} from '@/lib/beta-lifecycle';
import {BetaReportError,fetchBetaReportFile} from '@/lib/beta-report-proxy';
export const dynamic='force-dynamic';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(request:NextRequest) {
 const auth=await getAuthorization(),candidate=request.nextUrl.searchParams.get('candidate')??'';
 if(!auth||auth.readOnly||!hasPermission(auth,'delivery_associates','view')||!supabaseAdmin||!betaLifecycleEnabled(auth.companyId,candidate))return NextResponse.json({error:'Report access is unavailable.'},{status:403,headers});
 const result=await supabaseAdmin.from('workforce_amazon_email_pilot_candidates').select('station_id,alias_email').eq('company_id',auth.companyId!).eq('id',candidate).maybeSingle();
 if(result.error||!result.data||(!auth.hasAllLocationAccess&&!auth.locationScopeIds.includes(result.data.station_id)))return NextResponse.json({error:'Report access is unavailable.'},{status:403,headers});
 try {
  const file=await fetchBetaReportFile(candidate,request.nextUrl.searchParams.get('fresh')==='1');
  return new Response(file.pdf,{headers:{...file.headers,'Content-Disposition':`${request.nextUrl.searchParams.get('view')==='inline'?'inline':'attachment'}; filename="IDfy-verification-${file.profile}.pdf"`}});
 }catch(error){return NextResponse.json({error:error instanceof BetaReportError?error.message:'The report could not be prepared. Please retry.',code:error instanceof BetaReportError?error.code:'unavailable',requestId:error instanceof BetaReportError?error.requestId:null},{status:error instanceof BetaReportError?error.status:503,headers});}
}
