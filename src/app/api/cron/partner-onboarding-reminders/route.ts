import {processPartnerOnboardingDigests} from "@/lib/partner-onboarding-digest";
import {NextResponse} from "next/server";
import {supabaseAdmin} from "@/lib/supabase-admin";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET?.trim();
 if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  if(!supabaseAdmin)throw new Error("Database unavailable");
  const rules=await supabaseAdmin.from("workforce_partner_reminder_rules").select("company_id").eq("is_active",true);
  if(rules.error)throw new Error(rules.error.message);
  let queued=0;
  for(const company of new Set((rules.data??[]).map(row=>row.company_id))){const result=await supabaseAdmin.rpc("workforce_queue_partner_reminders",{p_company:company});if(result.error)throw new Error(result.error.message);queued+=Number(result.data||0);}
  const digest=await processPartnerOnboardingDigests();
  return NextResponse.json({queued,digest});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Reminder processing failed"},{status:500});}
}
