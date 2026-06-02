"use client";

import { ArrowLeft, ExternalLink, Mail, MailOpen, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatusBadge } from "@/components/admin/admin-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Category = "QUESTION" | "BUG" | "FEATURE_REQUEST" | "OTHER";
type Status = "NEW" | "READ" | "REPLIED";

type Message = {
  id: string;
  userId: string;
  name: string;
  email: string;
  subject: string;
  category: Category;
  body: string;
  status: Status;
  createdAt: Date | string;
  readAt: Date | string | null;
  repliedAt: Date | string | null;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: "USER" | "ADMIN" | "SUPER_ADMIN";
    createdAt: Date | string;
  };
};

const CATEGORY_LABEL: Record<Category, string> = {
  QUESTION: "Question",
  BUG: "Bug",
  FEATURE_REQUEST: "Feature request",
  OTHER: "Other",
};

const STATUS_TONE = {
  NEW: "primary",
  READ: "muted",
  REPLIED: "ok",
} as const;

function fmt(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

/** Quote the original message body inside a Re: email reply. */
function quote(body: string): string {
  return body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function ContactMessageDetail({ message }: { message: Message }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(message.status);
  const [readAt, setReadAt] = useState<Date | string | null>(message.readAt);
  const [repliedAt, setRepliedAt] = useState<Date | string | null>(
    message.repliedAt,
  );
  const [busy, setBusy] = useState<"" | "markRead" | "markReplied" | "markNew">("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function transition(action: "markRead" | "markReplied" | "markNew") {
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Could not update.");
        return;
      }
      setStatus(data.message.status);
      setReadAt(data.message.readAt);
      setRepliedAt(data.message.repliedAt);
      toast.success(
        action === "markRead"
          ? "Marked read"
          : action === "markReplied"
            ? "Marked replied"
            : "Reset to New",
      );
      router.refresh();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/messages/${message.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        toast.error(d?.error ?? "Could not delete.");
        return;
      }
      toast.success("Message deleted.");
      router.push("/admin/messages");
      router.refresh();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const mailtoHref = (() => {
    const subject = `Re: ${message.subject}`;
    const body = `\n\n---\n${quote(message.body)}`;
    const params = new URLSearchParams({ subject, body });
    return `mailto:${encodeURIComponent(message.email)}?${params.toString()}`;
  })();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/messages"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          <ArrowLeft className="size-3.5" />
          All messages
        </Link>
      </div>

      <AdminPageHeader title={message.subject}>
        <div className="flex items-center gap-2">
          <StatusBadge tone={STATUS_TONE[status]}>
            {status === "NEW" ? "New" : status === "READ" ? "Read" : "Replied"}
          </StatusBadge>
          <StatusBadge tone="muted">{CATEGORY_LABEL[message.category]}</StatusBadge>
        </div>
      </AdminPageHeader>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Styled anchor (not Button) so the mailto: opens in the user's
            default email client naturally; clicking also marks the message
            replied so the inbox status reflects the admin's intent. */}
        <a
          href={mailtoHref}
          onClick={() => void transition("markReplied")}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] border border-transparent px-2.5 text-[0.8rem] font-medium transition-colors"
        >
          <Mail className="size-3.5" />
          Reply via email
        </a>
        {status !== "READ" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => transition("markRead")}
            disabled={Boolean(busy)}
          >
            <MailOpen className="size-3.5" />
            Mark read
          </Button>
        )}
        {status !== "REPLIED" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => transition("markReplied")}
            disabled={Boolean(busy)}
          >
            <Mail className="size-3.5" />
            Mark replied
          </Button>
        )}
        {status !== "NEW" && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground gap-1.5"
            onClick={() => transition("markNew")}
            disabled={Boolean(busy)}
          >
            <RotateCcw className="size-3.5" />
            Reset to New
          </Button>
        )}
        {/* Pushed to the right edge of the action row — destructive actions
            sit visually apart from the affirmative ones (Reply / Mark
            read / Mark replied) so a fat-finger click is less likely. */}
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:bg-destructive/10 ml-auto gap-1.5"
          onClick={() => setConfirmDelete(true)}
          disabled={deleting}
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>

      {/* Body */}
      <div className="border-border/60 bg-card rounded-2xl border p-6">
        <p className="eyebrow text-muted-foreground mb-3 text-[0.7rem]">
          Message
        </p>
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.body}
        </div>
      </div>

      {/* Sender card */}
      <div className="border-border/60 bg-card rounded-2xl border p-6">
        <p className="eyebrow text-muted-foreground mb-3 text-[0.7rem]">
          From
        </p>
        <p className="text-sm font-medium">
          {message.name || message.email}
        </p>
        <p className="text-muted-foreground text-xs">{message.email}</p>
        <div className="text-muted-foreground mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span>
            <span className="text-foreground/70 font-medium">Account:</span>{" "}
            <Link
              href={`/admin/users/${message.user.id}`}
              className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              Open
              <ExternalLink className="size-3" />
            </Link>
          </span>
          <span>
            <span className="text-foreground/70 font-medium">Role:</span> {message.user.role}
          </span>
          <span>
            <span className="text-foreground/70 font-medium">Sent:</span> {fmt(message.createdAt)}
          </span>
          {readAt && (
            <span>
              <span className="text-foreground/70 font-medium">Read:</span> {fmt(readAt)}
            </span>
          )}
          {repliedAt && (
            <span>
              <span className="text-foreground/70 font-medium">Replied:</span> {fmt(repliedAt)}
            </span>
          )}
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the message from the database. The
              audit log keeps a record of the deletion (who, when, sender
              email, subject) — but the body itself can&apos;t be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete message"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
