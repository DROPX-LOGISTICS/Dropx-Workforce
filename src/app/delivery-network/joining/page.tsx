import {redirect} from "next/navigation";
export const dynamic="force-dynamic";
export default function LegacyJoiningPage({searchParams={}}:{searchParams?:{person?:string}}){
 const query=new URLSearchParams({view:"pending"});
 if(searchParams.person)query.set("q",searchParams.person);
 redirect(`/delivery-network/id-onboarding?${query}`);
}
