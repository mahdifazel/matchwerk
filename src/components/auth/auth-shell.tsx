/** Centered card layout shared by the login and register pages. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
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
