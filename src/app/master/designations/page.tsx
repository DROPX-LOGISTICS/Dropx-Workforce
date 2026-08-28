import { DesignationMasterPageContent } from "@/components/designation-master-page-content";

export const dynamic = "force-dynamic";

export default function DesignationsPage({
  searchParams
}: {
  searchParams?: { add?: string; edit?: string; q?: string };
}) {
  return (
    <DesignationMasterPageContent
      scope={{
        activeLabel: "Designations",
        basePath: "/master/designations",
        eyebrow: "Master Data",
        peopleModule: null,
        subtitle: "Maintain every Workforce and HR designation from one master.",
        title: "Designations"
      }}
      searchParams={searchParams}
    />
  );
}
