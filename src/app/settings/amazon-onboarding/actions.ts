"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isCompanyOwner,requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function saveOnboardingConnection(form:FormData) {
  const auth=await requirePagePermission("amazon_connector","edit");
  if(!isCompanyOwner(auth)||auth.readOnly) redirect("/unauthorized?page=amazon_connector");
  let message="Connection could not be saved. Refresh and try again.";
  let ok=false;
  if(supabaseAdmin) {
    const username=String(form.get("username")??"").trim();
    const password=String(form.get("password")??""); // Do not trim or reflect passwords.
    const version=Number(form.get("version"));
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)||username.length>254||password.length>1024||!Number.isInteger(version)||version<0) message="Enter a valid login email and refresh the connection version.";
    else {
      const result=await supabaseAdmin.rpc("workforce_save_amazon_connection",{p_company:requireCompanyId(auth),p_actor:auth.userId,p_username:username,p_password:password||null,p_enabled:form.get("enabled")==="on",p_version:version,p_request_login:form.get("intent")==="test"});
      ok=!result.error;
      message=ok ? form.get("enabled")==="on" ? "Encrypted connection saved. The worker will check it on the next 30-minute cycle; this is not confirmation of a successful Amazon login." : "Connection saved and paused. Scheduled onboarding checks are disabled." : "Not saved. A new login needs a password, and concurrent changes require a page refresh. No password is displayed or logged.";
    }
  }
  cookies().set("workforce_amazon_connection_notice",JSON.stringify({ok,message}),{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/settings/amazon-onboarding",maxAge:30});
  revalidatePath("/settings/amazon-onboarding");
  redirect("/settings/amazon-onboarding");
}
