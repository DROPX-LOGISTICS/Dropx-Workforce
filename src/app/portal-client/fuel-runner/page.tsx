import { redirect } from "next/navigation";

/** Legacy path — runner must live under /portal-fuel-proxy/ for the SW proxy scope. */
export default function LegacyFuelPortalRunnerPage({
  searchParams
}: {
  searchParams?: { portal?: string; reportDate?: string };
}) {
  const portal = searchParams?.portal || "iocl_fuel";
  const reportDate = searchParams?.reportDate || "";
  const qs = new URLSearchParams();
  if (portal) qs.set("portal", portal);
  if (reportDate) qs.set("reportDate", reportDate);
  redirect(`/portal-fuel-proxy/runner?${qs.toString()}`);
}
