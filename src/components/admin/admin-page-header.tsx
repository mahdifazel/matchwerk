import type { ReactNode } from "react";

/**
 * Standard admin page header: "Backoffice" eyebrow + display title + optional
 * description, with a right-aligned slot for page actions (Refresh, Export, …).
 */
export function AdminPageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow mb-2">Backoffice</p>
        <h1 className="font-display text-[2rem] leading-tight tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
