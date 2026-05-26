import { PlansManager } from "@/components/admin/plans-manager";
import { requireAdminPage } from "@/lib/admin";

export default async function AdminPlansPage() {
  await requireAdminPage();
  return <PlansManager />;
}
