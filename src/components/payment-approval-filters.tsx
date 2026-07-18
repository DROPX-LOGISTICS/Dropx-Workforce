"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function PaymentApprovalFilters({
  search,
  status
}: {
  search: string;
  status: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(search);

  useEffect(() => {
    setQuery(search);
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = query.trim();
      if (nextSearch === (searchParams.get("search") ?? "")) return;
      updateParams(router, pathname, searchParams, { search: nextSearch, manage: "" });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [pathname, query, router, searchParams]);

  return (
    <div className="inline-form">
      <input
        className="field compact"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search request, location, head"
        style={{ minWidth: 260 }}
        value={query}
      />
      <select
        className="field compact"
        name="status"
        onChange={(event) => updateParams(router, pathname, searchParams, { status: event.target.value, manage: "" })}
        value={status}
      >
        <option value="pending">Pending</option>
        <option value="returned">Returned</option>
        <option value="rejected">Rejected</option>
        <option value="all">All</option>
      </select>
    </div>
  );
}

function updateParams(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>,
  updates: Record<string, string>
) {
  const params = new URLSearchParams(searchParams.toString());
  Object.entries(updates).forEach(([key, value]) => {
    if (value) params.set(key, value);
    else params.delete(key);
  });
  if (!params.get("status")) params.set("status", "pending");
  const query = params.toString();
  const nextHref = `${pathname}${query ? `?${query}` : ""}`;
  if (nextHref === `${pathname}?${searchParams.toString()}`) return;
  router.push(nextHref, { scroll: false });
}
