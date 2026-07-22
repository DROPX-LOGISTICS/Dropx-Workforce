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
      activeLabel="Field Executive"
      addTitle="Add field executive"
      bulkImportDescription="Upload existing field executive rows and keep the profile completion pending for the app."
      bulkImportTitle="Bulk upload field executives"
      designationCategoryFilter={["field_executives", "delivery_executives"]}
      detailSubtitle="Complete Field Executive profile"
      editId={searchParams?.edit}
      editTitle="Edit field executive"
      emptyListLabel="No field executives added yet."
      entityLabel="Field Executive"
      errorMessage={searchParams?.error}
      listTitle="Field Executive register"
      notice={searchParams?.notice}
      pageCode="delivery_associates"
      pageSubtitle="Register and maintain field executives by location."
      pageTitle="Field Executive"
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
