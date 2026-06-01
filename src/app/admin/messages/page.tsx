import { ContactMessagesManager } from "@/components/admin/contact-messages-manager";
import { requireAdminPage } from "@/lib/admin";

export default async function AdminMessagesPage() {
  await requireAdminPage();
  return <ContactMessagesManager />;
}
