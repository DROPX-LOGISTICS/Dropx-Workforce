import { ReportUploadPageContent } from "@/components/report-upload-page-content";

export default function ReportUploadPage({ searchParams }: { searchParams?: { date?: string; report?: string; shipment?: string } }) {
  return <ReportUploadPageContent active="Report Imports" pageCode="imports" selectedDate={searchParams?.date} selectedReport={searchParams?.report} showShipmentCoverage={searchParams?.shipment === "1"} />;
}
