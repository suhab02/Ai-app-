import * as z from "zod";

const Ids = z.object({ sectionId: z.uuid(), subjectId: z.uuid() });

/**
 * Forms send either a single "sectionId:subjectId" pair (teachers pick from
 * their own assignments) or the two ids separately (staff). Both reduce to the
 * same two validated ids; null means the input was missing or malformed.
 */
export function parseSectionSubject(input: {
  pair?: string;
  sectionId?: string;
  subjectId?: string;
}): { sectionId: string; subjectId: string } | null {
  const [pairSection, pairSubject] = input.pair?.split(":") ?? [];
  const parsed = Ids.safeParse({
    sectionId: input.pair ? pairSection : input.sectionId,
    subjectId: input.pair ? pairSubject : input.subjectId,
  });
  return parsed.success ? parsed.data : null;
}
