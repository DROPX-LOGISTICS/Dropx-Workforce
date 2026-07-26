import { FieldExecutivePageContent } from "@/components/field-executive-page-content";

export default function VendorsPage({
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
      activeLabel="Vendors"
      addTitle="Add vendor"
      bulkImportDescription="Upload existing vendor rows and keep profile completion pending for DropX One."
      bulkImportTitle="Bulk upload vendors"
      designationCategoryFilter={["vendors"]}
      detailSubtitle="Complete vendor profile"
      editId={searchParams?.edit}
      editTitle="Edit vendor"
      emptyListLabel="No vendors added yet."
      entityLabel="Vendor"
      errorMessage={searchParams?.error}
      listTitle="Vendor register"
      notice={searchParams?.notice}
      pageCode="vendors"
      pageSubtitle="Register and maintain vendors by location."
      pageTitle="Vendors"
      returnPath="/vendors"
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
