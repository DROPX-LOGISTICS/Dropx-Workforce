import {supabaseAdmin} from '@/lib/supabase-admin';
import {requireCompanyId} from '@/lib/company-scope';
import type {AuthorizationContext} from '@/lib/authorization';
import {CopyProfileValue} from './copy-profile-value';

export async function AssociateRegistrationDetails({auth,id}:{auth:AuthorizationContext;id:string}){
 if(!supabaseAdmin)return null;
 const result=await supabaseAdmin.from('workforce').select('id,full_name,mobile,mobile_country_code,email,date_of_birth,gender,father_name,address,landmark,state_code,postal_pin,pan_number,aadhaar_number,driving_license_no,driving_license_exp_date,location_id,source_profile_type,source_profile_id,aadhaar_front_path,aadhaar_back_path,pan_upload_path,dl_front_path,dl_back_path,profile_photo_path').eq('company_id',requireCompanyId(auth)).eq('id',id).is('deleted_at',null).neq('migration_state','reclassified').maybeSingle();
 if(result.error)throw new Error('Registration details could not load.');
 const person=result.data;if(!person||!auth.hasAllLocationAccess&&!auth.locationScopeIds.includes(person.location_id))return null;
 const fields=[['Full name',person.full_name],['Mobile',person.mobile?`+${person.mobile_country_code||'91'} ${person.mobile}`:''],['Email',person.email],['Date of birth',person.date_of_birth],['Gender',person.gender],['Father’s name',person.father_name],['Submitted address',[person.address,person.landmark,person.state_code,person.postal_pin].filter(Boolean).join(', ')],['PAN',person.pan_number],['Aadhaar',person.aadhaar_number],['Driving licence',person.driving_license_no],['Licence expiry',person.driving_license_exp_date]];
 const files=[['Photo','profile_photo_path'],['PAN card','pan_upload_path'],['Aadhaar front','aadhaar_front_path'],['Aadhaar back','aadhaar_back_path'],['Licence front','dl_front_path'],['Licence back','dl_back_path']] as const;
 return <details className="wf-registration"><summary>Registration details & documents</summary><div className="wf-profile-fields">{fields.map(([label,value])=><CopyProfileValue key={label} label={label!} value={value||''}/>)}</div><p className="subtle">Registration currently has one address field. Confirm current and permanent addresses with the associate if Amazon requires both.</p><div className="wf-document-links">{files.map(([label,field])=>{const url=`/api/people/profile-file?profile_type=workforce&id=${id}&field=${field}`;return <div key={field}><strong>{label}</strong>{person[field]?<span><a href={url} target="_blank" rel="noreferrer">View</a> · <a href={url+'&download=1'} download>Download</a></span>:<small>Not submitted</small>}</div>;})}</div><a href={`/delivery-network/onboarding/associates?view=${encodeURIComponent(id)}`}>Open full registration</a></details>;
}
