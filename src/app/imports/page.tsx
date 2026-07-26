import { ReportUploadPageContent } from "@/components/report-upload-page-content";

export default function ImportsPage({ searchParams }: { searchParams?: { date?: string; shipment?: string } }) {
  return <ReportUploadPageContent active="Report Imports" pageCode="imports" selectedDate={searchParams?.date} showShipmentCoverage={searchParams?.shipment === "1"} />;
}
