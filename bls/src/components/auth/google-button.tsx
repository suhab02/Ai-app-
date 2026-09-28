"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";

export function GoogleButton() {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);

  async function handleClick() {
    setIsLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    // Browser navigates away to Google; no need to reset isLoading.
  }

  return (
    <Button type="button" variant="outline" onClick={handleClick} disabled={isLoading}>
      {t("auth.continueWithGoogle")}
    </Button>
  );
}
