"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { ActionResult } from "@/lib/admin/actions";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/** Wraps a Server Action in a form that shows its success/error message inline. */
export function ActionForm({
  action,
  submitLabel,
  className,
  compact,
  children,
}: {
  action: Action;
  submitLabel: string;
  className?: string;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className={cn("flex flex-col gap-3", compact && "flex-row items-end", className)}>
      {children}
      <Button type="submit" disabled={pending} className={compact ? "w-auto" : undefined}>
        {submitLabel}
      </Button>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-brand-green-dark">{state.ok}</p>}
    </form>
  );
}

export function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-brand-navy">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300 accent-brand-green"
      />
      {label}
    </label>
  );
}
