import { ProviderMappingPageContent } from "@/components/provider-mapping-page-content";

export default function WorkforceRateMappingPage({searchParams}:{searchParams:{station?:string;person?:string}}) {
  return (
    <ProviderMappingPageContent
      eyebrow="Onboarding · Commercial setup"
      subtitle="Confirm provider IDs and apply date-effective rate cards after the client ID is ready."
      title="ID & Rate Mapping"
      initialStation={searchParams.station}
      workforceId={searchParams.person}
    />
  );
}
