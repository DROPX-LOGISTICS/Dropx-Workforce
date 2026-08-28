import { FieldExecutivePageContent } from "@/components/field-executive-page-content";
import { currentAccessSurface } from "@/lib/access-surface";

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
  const isWorkforce = currentAccessSurface() === "workforce";
  return (
    <FieldExecutivePageContent
      activeLabel="Vendors"
      addTitle={isWorkforce ? "Add Workforce vendor" : "Add vendor"}
      bulkImportDescription={isWorkforce
        ? "Upload Van Renter, Van Vendor, Sorter, House Keeping and other vendor-network rows while keeping registration compatible with DropX One."
        : "Upload existing vendor rows and keep profile completion pending for DropX One."}
      bulkImportTitle={isWorkforce ? "Bulk upload Workforce vendors" : "Bulk upload vendors"}
      designationCategoryFilter={["vendors"]}
      designationPeopleModule={isWorkforce ? "delivery_network" : "people_hr"}
      detailSubtitle="Complete vendor profile"
      editId={searchParams?.edit}
      editTitle="Edit vendor"
      emptyListLabel="No vendors added yet."
      entityLabel="Vendor"
      errorMessage={searchParams?.error}
      listTitle="Vendor register"
      notice={searchParams?.notice}
      pageCode="vendors"
      pageSubtitle={isWorkforce ? "Register and maintain the Workforce vendor network by location." : "Register and maintain vendors by location."}
      pageTitle={isWorkforce ? "Workforce Vendors" : "Vendors"}
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
