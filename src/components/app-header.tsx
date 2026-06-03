"use client";

import { Coins, LogOut, Mail, Settings as SettingsIcon, Shield, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { ThemeToggle } from "@/components/theme-toggle";
import { LOW_TOKEN_THRESHOLD } from "@/lib/plans";
import { formatTokens, useTokenBalance } from "@/lib/use-token-balance";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

const NAV: NavItem[] = [
  { href: "/", label: "Board" },
  { href: "/settings", label: "Settings" },
];

export function AppHeader() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  return (
    <header className="border-border/60 bg-background/75 sticky top-0 z-30 border-b backdrop-blur-md">
      {/* Mobile-first sizing: shorter bar, tighter padding, no wordmark.
          The wordmark alone is ~115px on a 375px screen, so hiding it
          below sm: is the single biggest fix for the overflow that
          made the header feel "non-responsive". */}
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:h-16 sm:gap-3 sm:px-8">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5"
          aria-label="Matchwerk home"
        >
          <Logomark />
          {/* Wordmark is decorative on small screens — the logomark
              carries the brand alone. Show from sm+ where there's room. */}
          <span className="font-display hidden text-[1.35rem] leading-none tracking-tight sm:inline">
            Matchwerk
          </span>
        </Link>

        <nav className="flex min-w-0 items-center gap-0.5 sm:gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                // Compact on mobile so two text links + a coin pill + two
                // icon buttons can co-exist inside ~330px of nav space.
                "relative px-2 py-1.5 text-sm font-medium tracking-tight transition-colors sm:px-2.5 sm:text-[0.95rem]",
                isActive(item.href)
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              <span
                aria-hidden
                className={cn(
                  "bg-foreground pointer-events-none absolute inset-x-2 -bottom-px h-px origin-left transition-transform duration-200 sm:inset-x-2.5",
                  isActive(item.href) ? "scale-x-100" : "scale-x-0",
                )}
              />
            </Link>
          ))}
          <TokenPill />
          <span className="bg-border/80 mx-1 hidden h-5 w-px sm:block" />
          <ThemeToggle />
          <UserMenu />
        </nav>
      </div>
    </header>
  );
}

function TokenPill() {
  const { status } = useSession();
  const { balance } = useTokenBalance();
  // Hide only on the definitively signed-out state. `status === "loading"`
  // happens whenever NextAuth re-validates the session on tab refocus
  // (refetchOnWindowFocus is on by default in SessionProvider) — bailing
  // there would make the pill flicker out for ~100-500ms every time the
  // user switches tabs. Balance is the separate gate for "no data yet".
  if (status === "unauthenticated" || balance == null) return null;

  const low = balance < LOW_TOKEN_THRESHOLD;

  return (
    <Link
      href="/plans"
      title={low ? "Low balance — buy more tokens" : "Token balance — buy more"}
      className={cn(
        // Smaller on mobile (px-2, text-xs) so it fits between the nav
        // links and the icon buttons without overflow; full size on sm+.
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium tabular-nums transition-colors sm:gap-1.5 sm:px-2.5 sm:text-sm",
        low
          ? "border-accent/60 bg-accent/15 hover:bg-accent/25 text-foreground"
          : "border-border/70 bg-card hover:bg-muted text-foreground",
      )}
    >
      <Coins
        className={cn("size-3.5", low ? "text-foreground" : "text-muted-foreground")}
      />
      {formatTokens(balance)}
      {/* "Top up" hint is supporting copy; hide on mobile to save room. */}
      {low && (
        <span className="hidden text-xs font-semibold sm:inline">· Top up</span>
      )}
    </Link>
  );
}

function UserMenu() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // Same anti-flicker as TokenPill: don't bail on the transient "loading"
  // state that NextAuth enters when the tab refocuses and the session is
  // being revalidated (refetchOnWindowFocus default). NextAuth preserves
  // `data` across that refetch, so we keep rendering the existing identity.
  if (status === "unauthenticated") return null;
  const user = session?.user;
  if (!user) return null;
  const display = user.name || user.email || "Account";
  const initial = (user.name || user.email || "?").charAt(0).toUpperCase();
  const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="border-border/70 bg-card text-foreground hover:bg-muted ml-1 flex size-8 items-center justify-center overflow-hidden rounded-full border text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Account menu"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="size-full object-cover" />
        ) : (
          initial
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex flex-col gap-0.5 px-1.5 py-1">
          <span className="truncate text-sm font-medium">{display}</span>
          {user.email && user.email !== display && (
            <span className="text-muted-foreground truncate text-xs">
              {user.email}
            </span>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/account")}>
          <UserRound />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/plans")}>
          <Coins />
          Buy tokens
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/settings")}>
          <SettingsIcon />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/contact")}>
          <Mail />
          Contact us
        </DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/admin")}>
              <Shield />
              Admin panel
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Logomark() {
  return (
    <span
      aria-hidden
      className="bg-primary text-primary-foreground relative flex size-8 items-center justify-center rounded-md shadow-sm"
    >
      <span className="font-display text-[1.1rem] leading-none">M</span>
      <span
        className="bg-accent absolute -right-0.5 -top-0.5 size-1.5 rounded-full"
        style={{ boxShadow: "0 0 0 2px var(--background)" }}
      />
    </span>
  );
}
