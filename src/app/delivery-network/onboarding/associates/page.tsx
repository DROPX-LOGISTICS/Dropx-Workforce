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
    recruitment_lead_id?: string;
    onboarding_source?: string;
  };
}) {
  return (
    <FieldExecutivePageContent
      hideList
      profileOnly={Boolean(searchParams?.edit||searchParams?.view)}
      activeLabel="Invite Associate"
      addTitle="Invite Workforce associate"
      bulkImportDescription="Upload master-classified Workforce associates. Every registration remains compatible with the existing DropX One flow."
      bulkImportTitle="Bulk associate onboarding"
      designationCategoryFilter={["contractors", "field_executives"]}
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
      pageSubtitle="Create one invitation or upload a reviewed batch. Roles and registration rules come from Workforce masters."
      pageTitle="Invite associate"
      returnPath="/delivery-network/onboarding/associates"
      viewId={searchParams?.view}
      addFormValues={{
        fullName: searchParams?.full_name,
        mobileCountryCode: searchParams?.mobile_country_code,
        mobile: searchParams?.mobile,
        email: searchParams?.email,
        dateOfJoin: searchParams?.date_of_join,
        locationId: searchParams?.location_id,
        designation: searchParams?.designation,
        recruitmentLeadId: searchParams?.recruitment_lead_id,
        onboardingSource: searchParams?.onboarding_source
      }}
    />
  );
}
