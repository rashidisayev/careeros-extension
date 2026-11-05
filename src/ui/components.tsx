/**
 * The few controls the extension needs, built from CareerOS tokens to match the web app's
 * components (apps/web/components/ui): 36px controls, radius 8, petrol primary, one focus ring.
 */
import { AlertTriangle, Check, CircleAlert, Info, Loader2, PencilLine, Sparkles } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ApplicationStatus } from "../shared/api-types";
import { CATEGORY_LABEL, STATUS_DOT, STATUS_LABEL } from "./labels";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "destructive" | "link";
  size?: "sm" | "md";
  busy?: boolean;
};

const VARIANT = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-input bg-card text-foreground hover:bg-accent",
  ghost: "text-foreground hover:bg-accent",
  destructive: "border border-destructive/50 text-destructive hover:bg-destructive/10",
  link: "text-primary underline-offset-4 hover:underline px-0 h-auto",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", busy, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-55 disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0",
        variant !== "link" && (size === "sm" ? "h-8 px-3 text-[0.8125rem]" : "h-9 px-4 text-sm"),
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {busy && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-muted-foreground", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} />;
}

const ALERT = {
  info: { icon: Info, cls: "border-border bg-muted/50", iconCls: "text-primary" },
  warning: { icon: AlertTriangle, cls: "border-warning/50 bg-warning/10", iconCls: "text-warning" },
  error: { icon: CircleAlert, cls: "border-destructive/50 bg-destructive/10", iconCls: "text-destructive" },
  success: { icon: Check, cls: "border-success/50 bg-success/10", iconCls: "text-success" },
};

export function Alert({
  tone = "info",
  title,
  children,
  role,
  action,
}: {
  tone?: keyof typeof ALERT;
  title?: ReactNode;
  children?: ReactNode;
  role?: "alert" | "status";
  action?: ReactNode;
}) {
  const { icon: Icon, cls, iconCls } = ALERT[tone];
  return (
    <div role={role ?? (tone === "error" ? "alert" : undefined)} className={cn("flex gap-2.5 rounded-lg border p-3 text-sm", cls)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconCls)} aria-hidden />
      <div className="grid min-w-0 flex-1 gap-1">
        {title && <p className="font-medium text-foreground">{title}</p>}
        {children && <div className="text-muted-foreground [&_p+p]:mt-1">{children}</div>}
        {action && <div className="mt-1.5 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: ApplicationStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <span className={cn("size-2 rounded-full", STATUS_DOT[status])} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

const FIT: Record<string, string> = {
  excellent: "bg-fit-5 text-fit-5-foreground",
  strong: "bg-fit-4 text-fit-4-foreground",
  good: "bg-fit-3 text-fit-3-foreground",
  moderate: "bg-fit-2 text-fit-2-foreground",
  low: "bg-fit-1 text-fit-1-foreground",
};

/** Score + category in words: colour is never the only signal. */
export function MatchBadge({ score, category, size = "md" }: { score: number; category: string; size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "tabular inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium",
        size === "lg" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs",
        FIT[category] ?? FIT.low,
      )}
    >
      <span className="sr-only">Match score </span>
      <span className="font-semibold">{score}</span>
      <span className="opacity-90">{CATEGORY_LABEL[category] ?? category}</span>
    </span>
  );
}

export type Provenance = { basis: "explicit" | "inferred"; source: string; confidence: "high" | "medium" | "low" };

/** Where a value came from, in the web app's words: stated in the posting, or interpreted. */
export function SourceTag({ source, edited, empty }: { source?: Provenance | null; edited?: boolean; empty?: boolean }) {
  if (edited) {
    return (
      <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
        <PencilLine className="size-3" aria-hidden />
        Edited
      </span>
    );
  }
  if (!source) return empty ? <span className="text-xs whitespace-nowrap text-muted-foreground">Not found</span> : null;
  const stated = source.basis === "explicit";
  const label = stated ? "From the posting" : source.confidence === "low" ? "Please check" : "Interpreted";
  const explain = stated
    ? `Stated in the posting${source.source === "structured_data" ? " (its structured data)" : ""}.`
    : `${source.source === "ai" ? "AI" : "CareerOS"} interpreted this from the posting; please check it.`;
  return (
    <span
      title={explain}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs leading-none font-medium whitespace-nowrap",
        stated ? "bg-muted text-muted-foreground" : "bg-warning/15 text-foreground",
      )}
    >
      {stated ? <Check className="size-3" aria-hidden /> : <Sparkles className="size-3" aria-hidden />}
      {label}
      <span className="sr-only">: {explain}</span>
    </span>
  );
}

export function Field({
  id,
  label,
  tag,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  tag?: ReactNode;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <label htmlFor={id} className="text-[0.8125rem] font-medium">
          {label}
        </label>
        {tag}
      </div>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export const CONTROL =
  "field h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-55 aria-[invalid=true]:border-destructive";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
        <path d="M23.964 16.672A9.5 9.5 0 1 1 15.328 8.036" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className="text-brand dark:text-foreground" />
        <circle cx="25.531" cy="6.469" r="3.25" className="fill-brand-node" />
      </svg>
      <span className="text-[0.9375rem] tracking-[-0.02em]">
        <span className="font-semibold">Career</span>
        <span className="font-medium opacity-80">OS</span>
      </span>
    </span>
  );
}

/** Empty states (DESIGN.md): dashed region, inline icon + title + one action, no icon tiles. */
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid gap-2 rounded-xl border border-dashed p-4">
      <p className="flex items-center gap-2 font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        {title}
      </p>
      {children && <div className="text-muted-foreground">{children}</div>}
      {action && <div className="mt-1 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
