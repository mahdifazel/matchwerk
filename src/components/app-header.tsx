"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
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
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5">
          <Logomark />
          <span className="font-display text-[1.35rem] leading-none tracking-tight">
            Job&nbsp;Hunter
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative px-2.5 py-1.5 text-[0.95rem] font-medium tracking-tight transition-colors",
                isActive(item.href)
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              <span
                aria-hidden
                className={cn(
                  "bg-foreground pointer-events-none absolute inset-x-2.5 -bottom-px h-px origin-left transition-transform duration-200",
                  isActive(item.href) ? "scale-x-100" : "scale-x-0",
                )}
              />
            </Link>
          ))}
          <span className="bg-border/80 mx-1 hidden h-5 w-px sm:block" />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

function Logomark() {
  return (
    <span
      aria-hidden
      className="bg-primary text-primary-foreground relative flex size-8 items-center justify-center rounded-md shadow-sm"
    >
      <span className="font-display text-[1.1rem] leading-none">J</span>
      <span
        className="bg-accent absolute -right-0.5 -top-0.5 size-1.5 rounded-full"
        style={{ boxShadow: "0 0 0 2px var(--background)" }}
      />
    </span>
  );
}
