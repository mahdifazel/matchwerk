import { notFound } from "next/navigation";
import { ContactMessageDetail } from "@/components/admin/contact-message-detail";
import { requireAdminPage } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export default async function AdminMessageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();
  const { id } = await params;
  const message = await prisma.contactMessage.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      },
    },
  });
  if (!message) notFound();
  return <ContactMessageDetail message={message} />;
}
