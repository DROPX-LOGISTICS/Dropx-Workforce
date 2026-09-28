"use client";
import {useEffect,useRef,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import './associate-workbench.css';

export function AssociateWorkbench({children,closeHref}:{children:ReactNode;closeHref:string}){
 const dialog=useRef<HTMLDialogElement>(null),router=useRouter();
 useEffect(()=>{const node=dialog.current;if(node&&!node.open)node.showModal();return()=>node?.close();},[]);
 return <dialog ref={dialog} className="associate-workbench" aria-label="Associate workspace" onCancel={event=>{event.preventDefault();router.replace(closeHref,{scroll:false});}}>
  <header className="associate-workbench-bar"><strong>Associate workspace</strong><button type="button" className="button secondary compact" onClick={()=>router.replace(closeHref,{scroll:false})} aria-label="Close associate workspace">Close ×</button></header>
  <div className="associate-workbench-body">{children}</div>
 </dialog>;
}
