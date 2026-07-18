import { redirect } from "next/navigation";

export default function FleetDocumentEmailNotificationsRedirect() {
  redirect("/settings/notification-templates/fleet-documents");
}
