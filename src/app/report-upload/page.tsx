import { ReportUploadPageContent } from "@/components/report-upload-page-content";

export default function ReportUploadPage({ searchParams }: { searchParams?: { date?: string } }) {
  return <ReportUploadPageContent active="Report Imports" pageCode="imports" selectedDate={searchParams?.date} />;
}
