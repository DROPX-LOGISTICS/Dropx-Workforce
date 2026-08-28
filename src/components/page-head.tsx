import type { ReactNode } from "react";

export function PageHead({
  eyebrow,
  title,
  subtitle,
  action
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-copy">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="subtle">{subtitle}</p> : null}
      </div>
      {action ? <div className="page-head-action">{action}</div> : null}
    </header>
  );
}
