import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MetaMessagingSettingsPage({
  searchParams
}: {
  searchParams?: { section?: string; platform?: string };
}) {
  const platform = searchParams?.platform ?? searchParams?.section;
  redirect(`/settings/meta${platform ? `?platform=${encodeURIComponent(platform)}` : ""}`);
}
