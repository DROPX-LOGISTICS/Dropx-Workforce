"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function PerformanceSortControl({ options, value }: { options: Array<{ label: string; value: string }>; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return <label className="performance-sort-control"><span>Sort</span><select value={value} onChange={(event) => {
    const next = new URLSearchParams(params.toString());
    next.set("sort", event.target.value);
    router.replace(`${pathname}?${next.toString()}`);
  }}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
