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
    <div className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? (
          <p className="subtle" style={{ marginTop: 6 }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
