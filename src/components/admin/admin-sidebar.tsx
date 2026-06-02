"use client";

import {
  Activity,
  ArrowLeft,
  LayoutDashboard,
  Mail,
  Megaphone,
  Menu,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Users,
  Webhook,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { UserRole } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof Users; superAdminOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "User Management", icon: Users },
  { href: "/admin/plans", label: "Plans & Pricing", icon: Tag },
  { href: "/admin/system", label: "System Settings", icon: SlidersHorizontal },
  { href: "/admin/health", label: "API Health", icon: Activity },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
  { href: "/admin/messages", label: "Messages", icon: Mail },
  { href: "/admin/webhooks", label: "Stripe Events", icon: Webhook },
  { href: "/admin/roles", label: "Role Management", icon: ShieldCheck, superAdminOnly: true },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="bg-primary text-primary-foreground relative flex size-8 items-center justify-center rounded-md shadow-sm">
        <span className="font-display text-[1.1rem] leading-none">M</span>
        <span
          className="bg-accent absolute -right-0.5 -top-0.5 size-1.5 rounded-full"
          style={{ boxShadow: "0 0 0 2px var(--card)" }}
        />
      </span>
      <div className="leading-tight">
        <div className="font-display text-[1.1rem] tracking-tight">Matchwerk</div>
        <div className="eyebrow text-[0.6rem]">Backoffice</div>
      </div>
    </div>
  );
}

export function AdminSidebar({
  role,
  email,
  name,
}: {
  role: UserRole;
  email: string;
  name: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isSuperAdmin = role === "SUPER_ADMIN";

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname?.startsWith(href);

  return (
    <aside className="border-border/60 bg-card/40 flex shrink-0 flex-col border-b md:sticky md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-5 py-4">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
          className="hover:bg-muted rounded-md p-1.5 transition-colors md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      <nav
        className={cn(
          "flex flex-1 flex-col gap-0.5 px-3 pb-3 md:flex md:overflow-y-auto",
          open ? "flex" : "hidden md:flex",
        )}
      >
        {NAV.filter((item) => !item.superAdminOnly || isSuperAdmin).map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm tracking-tight transition-colors",
                active
                  ? "bg-accent/15 text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground font-medium",
              )}
            >
              {active && (
                <span className="bg-accent absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full" />
              )}
              <item.icon className={cn("size-4", active && "text-foreground")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-border/60 mt-auto hidden flex-col gap-3 border-t px-5 py-4 md:flex">
        <div>
          <div className="truncate text-sm font-medium">{name || email}</div>
          <div className="text-muted-foreground truncate text-xs">{email}</div>
          <div className="eyebrow mt-1 text-[0.6rem]">{isSuperAdmin ? "Super Admin" : "Admin"}</div>
        </div>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to app
        </Link>
      </div>
    </aside>
  );
}
