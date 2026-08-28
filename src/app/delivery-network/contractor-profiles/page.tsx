import { FieldExecutivePageContent } from "@/components/field-executive-page-content";

export default function WorkforceContractorProfilesPage({
  searchParams
}: {
  searchParams?: {
    edit?: string;
    error?: string;
    notice?: string;
    view?: string;
  };
}) {
  return (
    <FieldExecutivePageContent
      activeLabel="Workforce Register"
      addTitle="Add Workforce associate"
      bulkImportDescription="Upload Workforce associates while preserving DropX One registration compatibility."
      bulkImportTitle="Bulk upload Workforce associates"
      designationCategoryFilter={["contractors"]}
      designationPeopleModule="delivery_network"
      detailSubtitle="Workforce associate application and profile"
      editId={searchParams?.edit}
      editTitle="Edit Workforce associate"
      emptyListLabel="No contractor-sourced Workforce profiles found."
      entityLabel="Workforce associate"
      errorMessage={searchParams?.error}
      listTitle="Contractor-sourced Workforce profiles"
      notice={searchParams?.notice}
      pageCode="delivery_associates"
      pageSubtitle="Compatibility register for Workforce registrations that began in the independent-contractor table."
      pageTitle="Workforce Associate Profile"
      returnPath="/delivery-network/contractor-profiles"
      viewId={searchParams?.view}
    />
  );
}
