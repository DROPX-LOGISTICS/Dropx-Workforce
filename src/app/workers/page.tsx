import { FieldExecutivePageContent } from "@/components/field-executive-page-content";

export default function WorkersPage({
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
      activeLabel="Workers"
      addTitle="Add worker"
      bulkImportDescription="Upload existing worker rows and keep profile completion pending for DropX One."
      bulkImportTitle="Bulk upload workers"
      designationCategoryFilter={["workers"]}
      designationPeopleModule="people_hr"
      detailSubtitle="Complete worker profile"
      editId={searchParams?.edit}
      editTitle="Edit worker"
      emptyListLabel="No workers added yet."
      entityLabel="Worker"
      errorMessage={searchParams?.error}
      listTitle="Worker register"
      notice={searchParams?.notice}
      pageCode="workers"
      pageSubtitle="Register and maintain workers by location."
      pageTitle="Workers"
      returnPath="/workers"
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
