import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border/60 bg-card/40 flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-20 text-center ring-1 ring-foreground/[0.02]">
      <div className="bg-muted text-muted-foreground mb-6 flex size-14 items-center justify-center rounded-full ring-1 ring-border/70">
        {icon}
      </div>
      <h3 className="font-display text-[1.5rem] leading-tight tracking-tight">
        {title}
      </h3>
      <p className="text-muted-foreground mt-2.5 max-w-md text-[0.95rem] leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
