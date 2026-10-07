"use client";

import { ActionForm } from "@/components/admin/action-form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { submitApplication } from "@/lib/admissions/actions";
import { useI18n } from "@/lib/i18n/provider";

export function AdmissionForm() {
  const { t } = useI18n();
  return (
    <ActionForm action={submitApplication} submitLabel={t("admissions.submit")} className="max-w-xl">
      <Input name="applicantName" label={t("admissions.childName")} maxLength={120} required />
      <Input name="applicantNameBn" label={t("admissions.childNameBn")} maxLength={120} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input name="dateOfBirth" type="date" label={t("admissions.dob")} required />
        <Select name="gender" label={t("admissions.gender")} defaultValue="">
          <option value="">—</option>
          <option value="MALE">{t("enums.gender.MALE")}</option>
          <option value="FEMALE">{t("enums.gender.FEMALE")}</option>
          <option value="OTHER">{t("enums.gender.OTHER")}</option>
        </Select>
      </div>
      <Input name="desiredClass" label={t("admissions.desiredClass")} maxLength={60} required />
      <Input name="previousSchool" label={t("admissions.previousSchool")} maxLength={200} />
      <Input name="guardianName" label={t("admissions.guardianName")} maxLength={120} required />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input name="guardianPhone" type="tel" label={t("admissions.guardianPhone")} maxLength={30} required />
        <Input name="guardianEmail" type="email" label={t("admissions.guardianEmail")} maxLength={254} />
      </div>
      <Input name="address" label={t("admissions.address")} maxLength={500} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="message" className="text-sm font-medium text-brand-navy">{t("admissions.message")}</label>
        <textarea id="message" name="message" rows={3} maxLength={2000} className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm" />
      </div>
      {/* Honeypot: hidden from people, tempting to bots. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <p className="text-xs text-slate-500">{t("admissions.privacy")}</p>
    </ActionForm>
  );
}
