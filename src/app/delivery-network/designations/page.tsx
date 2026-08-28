import { DesignationMasterPageContent } from "@/components/designation-master-page-content";

export const dynamic = "force-dynamic";

export default function WorkforceDesignationsPage({
  searchParams
}: {
  searchParams?: { add?: string; edit?: string; q?: string };
}) {
  return (
    <DesignationMasterPageContent
      scope={{
        activeLabel: "Workforce Designations",
        basePath: "/delivery-network/designations",
        eyebrow: "Workforce master",
        peopleModule: "delivery_network",
        subtitle: "Create, edit or delete every master-classified Workforce role, including delivery, sorting, cleaning, driver and van operations.",
        title: "Workforce Designations"
      }}
      searchParams={searchParams}
    />
  );
}
