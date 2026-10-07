import { Select } from "@/components/ui/select";
import type { SectionSubjectOptions } from "@/lib/school/assignment-options";

/** Teachers pick one of their assignments; staff pick a section and a subject separately. */
export function SectionSubjectFields({
  options,
  labels,
}: {
  options: SectionSubjectOptions;
  labels: { classSubject: string; section: string; subject: string; choose: string };
}) {
  if (options.isTeacher) {
    return (
      <Select name="pair" label={labels.classSubject} required defaultValue="">
        <option value="" disabled>{labels.choose}</option>
        {options.pairs.map((p) => <option key={p.value} value={p.value}>{p.name}</option>)}
      </Select>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Select name="sectionId" label={labels.section} required defaultValue="">
        <option value="" disabled>{labels.choose}</option>
        {options.sectionOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
      <Select name="subjectId" label={labels.subject} required defaultValue="">
        <option value="" disabled>{labels.choose}</option>
        {options.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    </div>
  );
}
