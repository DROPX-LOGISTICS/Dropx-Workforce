"use client";
import { RefreshCw } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

export function WorkforceLiveRefresh({ seconds=30, paused=false, pauseWhenFormFocused=true, refreshedAt }: {seconds?:number;paused?:boolean;pauseWhenFormFocused?:boolean;refreshedAt?:string}) {
  const router=useRouter(), pathname=usePathname(), search=useSearchParams();
  const [remaining,setRemaining]=useState(seconds), [dirty,setDirty]=useState(false), [pending,startTransition]=useTransition();
  const [online,setOnline]=useState(true);
  const remainingRef=useRef(seconds);
  // A focused or edited form must never be replaced by a background refresh.
  useEffect(()=>{setDirty(false);},[pathname,search,refreshedAt]);
  useEffect(()=>{
    if(!pauseWhenFormFocused)return;
    const edit=(event:Event)=>{if((event.target as Element)?.closest('form'))setDirty(true);};
    document.addEventListener('input',edit);document.addEventListener('change',edit);
    return ()=>{document.removeEventListener('input',edit);document.removeEventListener('change',edit);};
  },[pauseWhenFormFocused]);
  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine);update();
    window.addEventListener('online',update);window.addEventListener('offline',update);
    return ()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[]);
  const stopped=paused||dirty||!online;
  useEffect(()=>{
    const refresh=()=>{
      if(stopped||pending||document.visibilityState!=='visible'||(pauseWhenFormFocused&&document.activeElement?.closest('form')))return;
      remainingRef.current=seconds;setRemaining(seconds);startTransition(()=>router.refresh());
    };
    const timer=window.setInterval(()=>{
      if(stopped||pending||document.visibilityState!=='visible'||(pauseWhenFormFocused&&document.activeElement?.closest('form')))return;
      remainingRef.current-=1;
      if(remainingRef.current<=0)refresh();else setRemaining(remainingRef.current);
    },1000);
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('focus',refresh);
    return ()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);};
  },[router,seconds,stopped,pending,pauseWhenFormFocused]);
  return <button className="wf-live-refresh" type="button" disabled={pending||stopped} title={refreshedAt?`Last refreshed ${refreshedAt}. Checks for imported updates every ${seconds} seconds.`:`Checks for updates every ${seconds} seconds.`} onClick={()=>{remainingRef.current=seconds;setRemaining(seconds);startTransition(()=>router.refresh());}}><RefreshCw size={14} className={pending?'spin':''}/>{!online?'Offline':paused||dirty?'Paused while editing':pending?'Refreshing…':`Auto refresh · ${remaining}s`}</button>;
}
