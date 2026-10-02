import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { refreshAmazonPilot } from '@/lib/amazon-pilot-data';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET?.trim();
 if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!supabaseAdmin)return NextResponse.json({error:'Unavailable'},{status:503});
 // Oldest checked first avoids starving records. Bounded batches fit the platform deadline.
 const batch=await supabaseAdmin.from('workforce_amazon_pilots').select('company_id,workforce_id').is('closed_at',null).order('last_checked_at',{nullsFirst:true}).limit(10);
 if(batch.error)return NextResponse.json({error:'Pilot queue unavailable'},{status:503});
 let synced=0,failed=0;const started=Date.now();
 for(const p of batch.data??[]){
  if(Date.now()-started>40000)break;
  try{
   const queue=await supabaseAdmin.rpc('workforce_queue_amazon_pilot',{p_company:p.company_id,p_workforce:p.workforce_id});
   if(queue.error)throw new Error(queue.error.message);
   await refreshAmazonPilot(p.company_id,p.workforce_id);synced++;
  }catch(error){failed++;await supabaseAdmin.from('workforce_amazon_pilots').update({sync_error:error instanceof Error?error.message:'Sync unavailable',last_checked_at:new Date().toISOString()}).eq('company_id',p.company_id).eq('workforce_id',p.workforce_id);}
 }
 return NextResponse.json({synced,failed},{status:failed?207:200});
}
