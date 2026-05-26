import { AnnouncementsManager } from "@/components/admin/announcements-manager";
import { requireAdminPage } from "@/lib/admin";

export default async function AdminAnnouncementsPage() {
  await requireAdminPage();
  return <AnnouncementsManager />;
}
