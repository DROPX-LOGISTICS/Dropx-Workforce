"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

type PendingLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  disableWhenCurrent?: boolean;
  scroll?: boolean;
  title?: string;
  "aria-label"?: string;
};

export function PendingLink({
  "aria-label": ariaLabel,
  children,
  className,
  disableWhenCurrent = false,
  href,
  scroll,
  title
}: PendingLinkProps) {
  const [loading, setLoading] = useState(false);
  const iconOnly = className?.includes("icon-button") ?? false;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentUrl = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const isCurrent = disableWhenCurrent && (currentUrl === href || pathname === href);

  useEffect(() => {
    setLoading(false);
  }, [currentUrl]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    if (isCurrent) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    setLoading(true);
    router.push(href, { scroll });
  }

  return (
    <Link
      aria-label={ariaLabel}
      aria-current={isCurrent ? "page" : undefined}
      aria-disabled={isCurrent ? true : undefined}
      className={`${className ?? ""} ${loading ? "loading" : ""} ${isCurrent ? "current disabled-current" : ""}`.trim()}
      href={href}
      onClick={handleClick}
      onFocus={() => router.prefetch(href)}
      onMouseEnter={() => router.prefetch(href)}
      prefetch
      scroll={scroll}
      title={title}
    >
      {loading ? <span className="inline-spinner" aria-hidden="true" /> : null}
      {loading && iconOnly ? null : children}
    </Link>
  );
}
