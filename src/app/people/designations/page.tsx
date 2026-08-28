import { DesignationMasterPageContent } from "@/components/designation-master-page-content";

export const dynamic = "force-dynamic";

export default function PeopleDesignationsPage({
  searchParams
}: {
  searchParams?: { add?: string; edit?: string; q?: string };
}) {
  return (
    <DesignationMasterPageContent
      scope={{
        activeLabel: "People Designations",
        basePath: "/people/designations",
        eyebrow: "People",
        peopleModule: "people_hr",
        subtitle: "Maintain HR designations only. Workforce designations remain outside the People master.",
        title: "People Designations"
      }}
      searchParams={searchParams}
    />
  );
}
