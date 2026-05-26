import { WebhooksViewer } from "@/components/admin/webhooks-viewer";
import { requireAdminPage } from "@/lib/admin";

export default async function AdminWebhooksPage() {
  await requireAdminPage();
  return <WebhooksViewer />;
}
