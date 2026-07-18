import { redirect } from "next/navigation";

export default async function NotificationTemplatesPage() {
  redirect("/settings/notification-templates/business-documents");
}
