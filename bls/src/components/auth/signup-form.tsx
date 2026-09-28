"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signup } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleButton } from "./google-button";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils/cn";

const SELF_SERVICE_ROLES = ["STUDENT", "PARENT"] as const;

export function SignupForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(signup, undefined);
  const [role, setRole] = useState<(typeof SELF_SERVICE_ROLES)[number]>("STUDENT");

  return (
    <div className="flex flex-col gap-5">
      <form action={formAction} className="flex flex-col gap-4">
        <Input
          name="fullName"
          label={t("auth.fullName")}
          autoComplete="name"
          required
          error={state?.fieldErrors?.fullName?.[0]}
        />
        <Input
          name="email"
          type="email"
          label={t("auth.email")}
          autoComplete="email"
          required
          error={state?.fieldErrors?.email?.[0]}
        />
        <Input
          name="password"
          type="password"
          label={t("auth.password")}
          autoComplete="new-password"
          required
          error={state?.fieldErrors?.password?.[0]}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-brand-navy">{t("auth.iAmA")}</span>
          <div className="flex gap-2">
            {SELF_SERVICE_ROLES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRole(value)}
                className={cn(
                  "flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                  role === value
                    ? "border-brand-green bg-brand-green-light text-brand-green-dark"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50",
                )}
                aria-pressed={role === value}
              >
                {t(`roles.${value}`)}
              </button>
            ))}
            <input type="hidden" name="requestedRole" value={role} />
          </div>
        </div>

        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

        <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
          {t("auth.signupNotice")}
        </p>

        <Button type="submit" disabled={pending}>
          {pending ? t("common.loading") : t("nav.signup")}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        {t("auth.orDivider")}
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <GoogleButton />

      <p className="text-center text-sm text-slate-500">
        {t("auth.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-brand-green hover:underline">
          {t("nav.login")}
        </Link>
      </p>
    </div>
  );
}
