import { redirect } from "next/navigation";

export default function WorkforceProfilesPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value) params.set(key, value);
  }
  redirect(`/delivery-network/onboarding/associates${params.size ? `?${params}` : ""}`);
}
