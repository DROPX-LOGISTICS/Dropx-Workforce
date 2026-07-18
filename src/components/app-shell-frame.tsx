"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type AppShellFrameProps = {
  children: ReactNode;
  desktopActions: ReactNode;
  mobileActions: ReactNode;
  sidebar: ReactNode;
};

export function AppShellFrame({ children, desktopActions, mobileActions, sidebar }: AppShellFrameProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle("mobile-nav-open", sidebarOpen);
    return () => document.body.classList.remove("mobile-nav-open");
  }, [sidebarOpen]);

  return (
    <div className={`shell ${sidebarOpen ? "sidebar-open" : ""}`}>
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-menu-button"
          aria-label={sidebarOpen ? "Close menu" : "Open menu"}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((current) => !current)}
        >
          {sidebarOpen ? <X size={21} strokeWidth={2.4} /> : <Menu size={21} strokeWidth={2.4} />}
        </button>
        <img className="mobile-brand-logo" src="/dropx-logo.png" alt="DropX" />
        <div className="mobile-top-actions">{mobileActions}</div>
      </header>

      {sidebarOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      {sidebar}

      <main className="main">
        <header className="topbar">
          <div />
          <div className="top-actions">{desktopActions}</div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
