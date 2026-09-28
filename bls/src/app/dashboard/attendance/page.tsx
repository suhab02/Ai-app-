import { redirect } from "next/navigation";
import { FamilyAttendance } from "@/components/attendance/family-view";
import { TakeAttendance } from "@/components/attendance/take-attendance";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; date?: string; month?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const params = await searchParams;
  const locale = await getLocale();
  const dictionary = getDictionary(locale);

  // Which view you get is a UX choice only: both views read through RLS, so a
  // student or guardian could not load a roster by editing the URL.
  if (profile.role === "STUDENT" || profile.role === "PARENT") {
    return <FamilyAttendance dictionary={dictionary} locale={locale} monthParam={params.month} />;
  }

  return (
    <TakeAttendance profile={profile} dictionary={dictionary} sectionParam={params.section} dateParam={params.date} />
  );
}
