import { RolesManager } from "@/components/admin/roles-manager";
import { requireSuperAdminPage } from "@/lib/admin";

export default async function AdminRolesPage() {
  // Belt-and-braces: the nav hides this for regular admins, but enforce here too.
  await requireSuperAdminPage();
  return <RolesManager />;
}
