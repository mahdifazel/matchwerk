import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { requireAdminPage } from "@/lib/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdminPage();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AdminSidebar
        role={admin.role}
        email={admin.email}
        name={admin.name}
      />
      <main className="min-w-0 flex-1 px-5 pb-24 pt-8 sm:px-8">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
