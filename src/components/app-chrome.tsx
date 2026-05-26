"use client";

import { usePathname } from "next/navigation";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { AppHeader } from "@/components/app-header";
import { ImpersonationBanner } from "@/components/impersonation-banner";

// Routes with their own layout (auth screens, admin backoffice) — no client
// header, no page transition.
const BARE_PREFIXES = ["/login", "/register", "/forgot-password", "/reset-password", "/admin"];

/**
 * Renders the persistent app header once (so it survives client navigations
 * without remounting/flickering) and gives page content a consistent enter
 * transition. Keying the content wrapper by pathname replays the animation on
 * each route change while leaving the header untouched. Honors reduce-motion
 * via the global rule in globals.css.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";

  const bare = BARE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (bare) return <>{children}</>;

  return (
    <>
      <ImpersonationBanner />
      <AnnouncementBanner />
      <AppHeader />
      <div
        key={pathname}
        className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out"
      >
        {children}
      </div>
    </>
  );
}
