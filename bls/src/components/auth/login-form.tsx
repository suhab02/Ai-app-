"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleButton } from "./google-button";
import { useI18n } from "@/lib/i18n/provider";

export function LoginForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <div className="flex flex-col gap-5">
      <form action={formAction} className="flex flex-col gap-4">
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
          autoComplete="current-password"
          required
          error={state?.fieldErrors?.password?.[0]}
        />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? t("common.loading") : t("nav.login")}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        {t("auth.orDivider")}
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <GoogleButton />

      <p className="text-center text-sm text-slate-500">
        {t("auth.noAccount")}{" "}
        <Link href="/signup" className="font-medium text-brand-green hover:underline">
          {t("nav.signup")}
        </Link>
      </p>
    </div>
  );
}
