import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";

export const metadata: Metadata = { title: "Sign up · Bright Learning School" };

export default async function SignupPage() {
  const dictionary = getDictionary(await getLocale());

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-brand-navy">{dictionary.auth.signupTitle}</h1>
      <SignupForm />
    </div>
  );
}
