import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";

export const metadata: Metadata = { title: "Log in · Bright Learning School" };

export default async function LoginPage() {
  const dictionary = getDictionary(await getLocale());

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-brand-navy">{dictionary.auth.loginTitle}</h1>
      <LoginForm />
    </div>
  );
}
