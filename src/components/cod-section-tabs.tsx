import Link from "next/link";

const codSections = [
  { href: "/ops-pulse/cod/submission", key: "submission", label: "Submission" },
  { href: "/ops-pulse/cod/validation", key: "validation", label: "Validation" },
  { href: "/ops-pulse/cod/reports", key: "reports", label: "Reports" },
  { href: "/ops-pulse/cod/portal-checks", key: "portal-checks", label: "Portal Checks" }
] as const;

export function CodSectionTabs({ active }: { active: typeof codSections[number]["key"] }) {
  return (
    <section className="tabs" aria-label="COD sections">
      {codSections.map((section) => (
        <Link className={`tab ${active === section.key ? "active" : ""}`} href={section.href} key={section.key}>
          {section.label}
        </Link>
      ))}
    </section>
  );
}
