import Link from "next/link";

const codSections = [
  { href: "/ops-pulse/cod/executive-reconciliation", key: "executive-reconciliation", label: "Executive Reconciliation", visible: true },
  { href: "/ops-pulse/cod/submission", key: "submission", label: "COD Submission", visible: true },
  { href: "/ops-pulse/cod/reports", key: "reports", label: "COD Reports", visible: true },
  { href: "/ops-pulse/cod/validation", key: "validation", label: "Validation", visible: false },
  { href: "/ops-pulse/cod/portal-checks", key: "portal-checks", label: "Portal Checks", visible: false }
] as const;

export function CodSectionTabs({ active }: { active: typeof codSections[number]["key"] }) {
  return (
    <section className="tabs" aria-label="COD sections">
      {codSections.filter((section) => section.visible).map((section) => (
        <Link className={`tab ${active === section.key ? "active" : ""}`} href={section.href} key={section.key}>
          {section.label}
        </Link>
      ))}
    </section>
  );
}
