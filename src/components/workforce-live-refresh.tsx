"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

export function WorkforceLiveRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(seconds);
  const [pending, startTransition] = useTransition();
  const remainingRef = useRef(seconds);

  useEffect(() => {
    remainingRef.current = seconds;
    setRemaining(seconds);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || document.activeElement?.closest("form")) return;
      remainingRef.current -= 1;
      if (remainingRef.current <= 0) {
        remainingRef.current = seconds;
        setRemaining(seconds);
        startTransition(() => router.refresh());
      } else setRemaining(remainingRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);

  return (
    <button
      className="wf-live-refresh"
      disabled={pending}
      onClick={() => {
        remainingRef.current = seconds;
        setRemaining(seconds);
        startTransition(() => router.refresh());
      }}
      type="button"
    >
      <RefreshCw className={pending ? "spin" : ""} size={15} />
      {pending ? "Refreshing" : `Live · ${remaining}s`}
    </button>
  );
}
