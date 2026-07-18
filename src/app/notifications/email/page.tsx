import { redirect } from "next/navigation";

export default async function EmailNotificationsPage() {
  redirect("/settings/notification-templates/email");
}
