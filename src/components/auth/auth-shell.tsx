import { cn } from "@/lib/utils";

/**
 * Centered card layout shared by the login and register pages.
 *
 * When `illustrationSrc` is provided, the shell switches to a two-column
 * split-layout on `md+` viewports: brand illustration on the left, form on
 * the right. Below `md` the illustration hides and the form takes the
 * single-column centered layout (so the form stays in the thumb-zone on
 * phones and we don't ship a heavy SVG to a screen that can't show it).
 *
 * The illustration column intentionally pins its own `#F5F1E8` Paper
 * background regardless of theme — the artwork carries dark Ink (#1A1233)
 * line work that would disappear on a dark plum surface. Magazines don't
 * invert their illustrations for night reading; neither should we.
 */
export function AuthShell({
  title,
  subtitle,
  illustrationSrc,
  children,
}: {
  title: string;
  subtitle: string;
  /** Optional brand illustration. Path relative to /public. */
  illustrationSrc?: string;
  children: React.ReactNode;
}) {
  const split = Boolean(illustrationSrc);
  return (
    <main
      className={cn(
        "flex min-h-screen",
        split ? "md:items-stretch" : "items-center justify-center px-5 py-12",
      )}
    >
      {split && illustrationSrc && (
        <aside
          aria-hidden="true"
          className="relative hidden flex-1 items-center justify-center overflow-hidden md:flex"
          // Paper background pinned regardless of theme so the illustration's
          // Ink linework stays readable in both light and dark modes.
          style={{ backgroundColor: "#F5F1E8" }}
        >
          {/* Faint dot-grid texture borrowed from the editorial palette —
              keeps the cream surface from reading as a flat color block when
              the illustration doesn't fully cover it on ultrawide displays. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "radial-gradient(#1A1233 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />
          <div className="relative flex w-full max-w-xl items-center justify-center p-10 lg:p-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={illustrationSrc}
              alt=""
              width={594}
              height={564}
              loading="eager"
              decoding="async"
              draggable={false}
              className="h-auto w-full select-none"
            />
          </div>
        </aside>
      )}

      <section
        className={cn(
          "flex flex-1 items-center justify-center px-5 py-12",
          split && "md:max-w-xl md:flex-initial lg:max-w-2xl",
        )}
      >
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <Logomark />
            <p className="eyebrow text-muted-foreground mt-5">{subtitle}</p>
            <h1 className="font-display mt-1 text-3xl">{title}</h1>
          </div>
          <div className="border-border/60 bg-card rounded-2xl border p-6 shadow-sm sm:p-8">
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}

function Logomark() {
  return (
    <span
      aria-hidden
      className="bg-primary text-primary-foreground relative flex size-10 items-center justify-center rounded-lg shadow-sm"
    >
      <span className="font-display text-[1.3rem] leading-none">M</span>
      <span
        className="bg-accent absolute -top-0.5 -right-0.5 size-2 rounded-full"
        style={{ boxShadow: "0 0 0 2px var(--background)" }}
      />
    </span>
  );
}
