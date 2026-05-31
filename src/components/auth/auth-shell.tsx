import { AuthIllustration } from "@/components/auth/auth-illustration";
import { cn } from "@/lib/utils";

/**
 * Centered card layout shared by the login and register pages.
 *
 * When `illustrationSrc` is provided, the shell switches to a two-column
 * split-screen on `lg+` viewports (illustration ~52%, form ~48%). Between
 * `md` and `lg` it falls back to a single-column stack so neither column
 * gets cramped on landscape tablets. Below `md` the illustration hides
 * entirely — the form keeps its single-column centered layout (thumb-zone
 * on phones), and we don't ship a heavy SVG to a screen that can't show it.
 *
 * The illustration column pins its own #F5F1E8 Paper background regardless
 * of theme — the artwork carries Ink (#1A1233) line work that would
 * disappear on dark plum. Real magazines don't invert their illustrations
 * for night reading; neither should we. The form column still respects
 * light/dark — intentional asymmetry: the illustration is the brand's
 * always-on "print surface", the form is the product's "device surface".
 */
export function AuthShell({
  title,
  subtitle,
  illustrationSrc,
  /** Brand caption shown beneath the illustration (Fraunces). */
  illustrationTagline,
  children,
}: {
  title: string;
  subtitle: string;
  illustrationSrc?: string;
  /** ReactNode so callers can inline emphasis (`<strong>`) where useful. */
  illustrationTagline?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasIllustration = Boolean(illustrationSrc);

  return (
    <main
      className={cn(
        "flex min-h-screen",
        hasIllustration
          ? "lg:flex-row-reverse lg:items-stretch"
          : "items-center justify-center px-5 py-12",
      )}
    >
      {hasIllustration && illustrationSrc && (
        <aside
          aria-hidden="true"
          className="relative hidden flex-1 flex-col items-center justify-center overflow-hidden lg:flex lg:basis-[52%]"
          // Paper pinned in both themes so the Ink linework stays readable.
          style={{ backgroundColor: "#F5F1E8" }}
        >
          <div className="relative flex w-full max-w-xl flex-col items-center justify-center gap-8 p-10 xl:max-w-2xl xl:p-16">
            {/* Outer wrapper carries a small lg-only leftward shift; the
                inner div carries the mount animation. Splitting them
                prevents the static translateX from clobbering the keyframe
                transform on the same element. */}
            <div className="lg:-translate-x-[4px]">
              <div
                className="auth-illustration-mount block w-full select-none"
                style={{ maxWidth: "min(100%, 520px)" }}
              >
                <AuthIllustration
                  src={illustrationSrc}
                  width={594}
                  height={564}
                  className="block h-auto w-full"
                />
              </div>
            </div>
            {illustrationTagline && (
              <div className="auth-illustration-mount auth-illustration-caption max-w-lg text-center">
                {/* Matches the wordmark style in the app header
                    (Fraunces / leading-none / tracking-tight), but a touch
                    bolder (font-weight 700 vs the header's 550) since this
                    is the brand anchor on the auth surface. */}
                <p
                  className="font-display text-[1.35rem] leading-none tracking-tight"
                  style={{ color: "#1A1233", fontWeight: 700 }}
                >
                  Matchwerk
                </p>
                {/* Longer multi-sentence caption: text-base + relaxed leading
                    keeps it readable across ~3 lines (italic display on bigger
                    sizes would read as a heavy block). Ink at 60% so it stays
                    subordinate to the wordmark while passing WCAG AA on Paper
                    (≈5.5:1). max-w-lg on the parent gives ~60-65 chars per
                    line — the editorial sweet spot. */}
                <p
                  className="font-display mt-3 text-base leading-relaxed italic"
                  style={{ color: "rgba(26, 18, 51, 0.60)" }}
                >
                  {illustrationTagline}
                </p>
              </div>
            )}
          </div>
        </aside>
      )}

      <section
        className={cn(
          "flex flex-1 items-center justify-center px-5 py-12",
          // The form column gets the Sage stage only on lg+ (where the
          // split is active). On mobile/tablet the form is centered on the
          // theme background — Sage filling a whole phone viewport would
          // feel arbitrary outside the context of the two-column composition.
          hasIllustration && "lg:basis-[48%] lg:bg-[#C7D7A0] lg:px-10",
        )}
      >
        <div className="w-full max-w-sm lg:-translate-y-[49.5px]">
          <div className="mb-8 flex flex-col items-center text-center">
            <Logomark />
            {/* Header texts on the Sage stage pin to Ink-derived tones so
                contrast passes AA in both light and dark mode (the section
                bg is pinned regardless of theme, so foreground must be too). */}
            <p
              className={cn(
                "eyebrow mt-5",
                hasIllustration
                  ? "text-muted-foreground lg:text-[#1A1233]/65"
                  : "text-muted-foreground",
              )}
            >
              {subtitle}
            </p>
            <h1
              className={cn(
                "font-display mt-1 text-3xl",
                hasIllustration && "lg:text-[#1A1233]",
              )}
            >
              {title}
            </h1>
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
