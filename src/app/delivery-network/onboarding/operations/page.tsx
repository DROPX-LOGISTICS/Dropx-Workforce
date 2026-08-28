import { FieldExecutivePageContent } from "@/components/field-executive-page-content";

export default function WorkforceOperationsPartnerOnboardingPage({
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
      activeLabel="Onboard Workforce"
      addTitle="Invite ground or fleet partner"
      bulkImportDescription="Upload ground-support and fleet-partner onboarding requests selected from the Workforce designation master."
      bulkImportTitle="Bulk operations-partner onboarding"
      designationCategoryFilter={["vendors"]}
      designationPeopleModule="delivery_network"
      detailSubtitle="Ground and fleet partner profile"
      editId={searchParams?.edit}
      editTitle="Edit operations-partner request"
      emptyListLabel="No ground or fleet partner registrations yet."
      entityLabel="Operations partner"
      errorMessage={searchParams?.error}
      listTitle="Ground and fleet onboarding requests"
      notice={searchParams?.notice}
      pageCode="delivery_associates"
      pageSubtitle="Onboard master-classified Sorter, Housekeeping, Van Renter, Van Vendor and future vendor roles without mixing People / HR records."
      pageTitle="Ground & Fleet Onboarding"
      returnPath="/delivery-network/onboarding/operations"
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
