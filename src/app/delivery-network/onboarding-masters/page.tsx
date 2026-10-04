import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { WorkforceOnboardingShell } from '@/components/workforce-onboarding-shell';
import { SubmitButton } from '@/components/submit-button';
import { hasPermission,requirePagePermission } from '@/lib/authorization';
import { requireCompanyId } from '@/lib/company-scope';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { saveOnboardingExitReason } from './actions';
import styles from './page.module.css';

export const dynamic='force-dynamic';
type Reason={id:string;client_code:string;code:string;label:string;description:string;requires_note:boolean;sort_order:number;is_active:boolean};

export default async function OnboardingMastersPage({searchParams={}}:{searchParams?:Record<string,string|undefined>}){
 const auth=await requirePagePermission('delivery_associates','access'),company=requireCompanyId(auth);
 if(!supabaseAdmin)throw new Error('Database unavailable.');
 const result=await supabaseAdmin.from('workforce_onboarding_exit_reasons').select('id,client_code,code,label,description,requires_note,sort_order,is_active').eq('company_id',company).order('client_code').order('sort_order').order('label');
 const rows=(result.data??[]) as Reason[],editing=rows.find(row=>row.id===searchParams.edit);
 const canEdit=hasPermission(auth,'delivery_associates','edit')&&!auth.readOnly;
 return <WorkforceOnboardingShell active="masters"><main className={styles.page}>
  <header className={styles.hero}><div><div className={styles.eyebrow}><Settings2 size={14}/> WORKFORCE CONFIGURATION</div><h1>Onboarding masters</h1><p>Control the choices associates see when they decide not to continue. Changes apply without a code release.</p></div></header>
  {searchParams.error||result.error?<div className={styles.error} role="alert">{searchParams.error||result.error?.message}</div>:searchParams.notice?<div className={styles.notice} role="status">{searchParams.notice}</div>:null}
  {canEdit?<section className={styles.panel}><header><div><small>ASSOCIATE EXIT</small><h2>{editing?'Edit exit reason':'Add exit reason'}</h2></div></header><form action={saveOnboardingExitReason} className={styles.form}>
   {editing?<input type="hidden" name="id" value={editing.id}/>:null}
   <label>Client code<input name="client_code" required maxLength={40} defaultValue={editing?.client_code??'AMAZON'} placeholder="AMAZON"/></label>
   <label>Reason code<input name="code" required maxLength={60} defaultValue={editing?.code} placeholder="personal_reason"/></label>
   <label>Display order<input name="sort_order" type="number" min="1" max="10000" defaultValue={editing?.sort_order??100}/></label>
   <label className={styles.wide}>Associate-facing reason<input name="label" required maxLength={120} defaultValue={editing?.label}/></label>
   <label className={styles.wide}>Workforce guidance<textarea name="description" maxLength={500} defaultValue={editing?.description}/></label>
   <label className={styles.check}><input type="checkbox" name="requires_note" defaultChecked={editing?.requires_note}/> Require a note</label>
   <label className={styles.check}><input type="checkbox" name="is_active" defaultChecked={editing?.is_active??true}/> Available in DropX One</label>
   <footer><SubmitButton pendingText="Saving…">{editing?'Save changes':'Add reason'}</SubmitButton>{editing?<Link href="/delivery-network/onboarding-masters">Cancel</Link>:null}</footer>
  </form></section>:null}
  <section className={styles.panel}><header><div><small>CONFIGURED OPTIONS</small><h2>Associate exit reasons</h2><p>Only active choices are shown to associates.</p></div><span>{rows.length} reasons</span></header>
   <div className={styles.list}>{rows.map(row=><article key={row.id}><div><span>{row.client_code}</span><strong>{row.label}</strong><p>{row.description||'No internal guidance'}</p></div><div className={styles.meta}><code>{row.code}</code><small>{row.requires_note?'Note required':'Note optional'} · Order {row.sort_order}</small></div><b data-active={row.is_active}>{row.is_active?'Active':'Paused'}</b>{canEdit?<Link href={`/delivery-network/onboarding-masters?edit=${row.id}`}>Edit</Link>:null}</article>)}{!rows.length?<p className={styles.empty}>No exit reasons are configured.</p>:null}</div>
  </section>
 </main></WorkforceOnboardingShell>;
}
