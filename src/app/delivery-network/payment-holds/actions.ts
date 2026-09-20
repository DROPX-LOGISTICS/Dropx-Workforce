"use server";
import {redirect} from 'next/navigation';import {revalidatePath} from 'next/cache';
import {requirePagePermission,isCompanyOwner} from '@/lib/authorization';import {manageWorkforceHold} from '@/lib/workforce-hold-actions';
export async function manageHold(form:FormData){const auth=await requirePagePermission('workforce_adjustments','edit');const query=new URLSearchParams();try{query.set('notice',await manageWorkforceHold(auth,form,isCompanyOwner(auth)));revalidatePath('/delivery-network/payment-holds');revalidatePath('/delivery-network/earnings');}catch(error){query.set('error',error instanceof Error?error.message:'Unable to update hold.');}redirect(`/delivery-network/payment-holds?${query}`);}
