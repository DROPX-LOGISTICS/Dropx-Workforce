import { FieldExecutivePageContent } from "@/components/field-executive-page-content";

export default function WorkforceAssociateOnboardingPage({
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
      addTitle="Invite Workforce associate"
      bulkImportDescription="Upload master-classified Workforce associates. Every registration remains compatible with the existing DropX One flow."
      bulkImportTitle="Bulk associate onboarding"
      designationCategoryFilter={["contractors"]}
      designationPeopleModule="delivery_network"
      detailSubtitle="Associate registration and profile"
      editId={searchParams?.edit}
      editTitle="Edit associate request"
      emptyListLabel="No Workforce associate registrations yet."
      entityLabel="Workforce associate"
      errorMessage={searchParams?.error}
      listTitle="Associate onboarding requests"
      notice={searchParams?.notice}
      pageCode="delivery_associates"
      pageSubtitle="Onboard only Workforce-classified contractor roles such as delivery, driving and Wishmaster. People / HR roles are excluded by the designation master."
      pageTitle="Associate Onboarding"
      returnPath="/delivery-network/onboarding/associates"
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
