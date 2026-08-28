import { FieldExecutivePageContent } from "@/components/field-executive-page-content";

export default function FieldExecutivePage({
  searchParams
}: {
  searchParams?: {
    edit?: string;
    error?: string;
    notice?: string;
    view?: string;
    full_name?: string;
    mobile_country_code?: string;
    mobile?: string;
    email?: string;
    date_of_join?: string;
    location_id?: string;
    designation?: string;
  };
}) {
  return (
    <FieldExecutivePageContent
      activeLabel="Delivery Network Onboarding"
      addTitle="Request Delivery Network onboarding"
      bulkImportDescription="Upload Delivery Network onboarding requests. Every applicant remains pending until profile submission, agreement acceptance and HO activation."
      bulkImportTitle="Bulk Delivery Network requests"
      designationCategoryFilter={["field_executives", "contractors", "vendors", "workers"]}
      designationPeopleModule="delivery_network"
      detailSubtitle="Delivery Network application and profile"
      editId={searchParams?.edit}
      editTitle="Edit workforce request"
      emptyListLabel="No Delivery Network onboarding requests yet."
      entityLabel="Delivery Network applicant"
      errorMessage={searchParams?.error}
      listTitle="Delivery Network onboarding requests"
      notice={searchParams?.notice}
      pageCode="delivery_associates"
      pageSubtitle="Create DA, PTDA, DCD/ODCD, Wishmaster, Sorter and similar partner requests, then track submission and activation."
      pageTitle="Delivery Network Onboarding"
      returnPath="/field-executive"
      viewId={searchParams?.view}
      addFormValues={{
        fullName: searchParams?.full_name,
        mobileCountryCode: searchParams?.mobile_country_code,
        mobile: searchParams?.mobile,
        email: searchParams?.email,
        dateOfJoin: searchParams?.date_of_join,
        locationId: searchParams?.location_id,
        designation: searchParams?.designation
      }}
    />
  );
}
