import { SystemSettings } from "@/components/admin/system-settings";
import { requireAdminPage } from "@/lib/admin";

export default async function AdminSystemPage() {
  await requireAdminPage();
  return <SystemSettings />;
}
