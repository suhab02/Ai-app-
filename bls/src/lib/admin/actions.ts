"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { requireStaff } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok?: string; error?: string } | undefined;

// Every action: (1) requireStaff() re-checks the caller server-side,
// (2) Zod validates the input, (3) Postgres RLS/triggers are the final gate.
// A forged form post from a non-staff account fails at (1) and again at (3).

const text = z.string().trim().min(1, { error: "Required." });
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));
const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));
const uuid = z.uuid({ error: "Invalid selection." });
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "That value already exists.";
  if (error.code === "23503") return "A referenced record does not exist.";
  if (error.code === "42501") return "You are not allowed to do that.";
  return error.message;
}

async function run<S extends z.ZodType>(
  formData: FormData,
  schema: S,
  paths: string[],
  message: string,
  op: (
    input: z.output<S>,
    db: Awaited<ReturnType<typeof createClient>>,
  ) => PromiseLike<{ error: { code?: string; message: string } | null }>,
): Promise<ActionResult> {
  await requireStaff();

  const parsed = schema.safeParse(fields(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }

  const db = await createClient();
  const { error } = await op(parsed.data, db);
  if (error) return { error: friendly(error) };

  for (const path of paths) revalidatePath(path);
  return { ok: message };
}

// ---------------------------------------------------------------- users

const StatusSchema = z.object({
  profileId: uuid,
  status: z.enum(["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]),
});

export async function setUserStatus(_prev: ActionResult, formData: FormData) {
  return run(formData, StatusSchema, ["/dashboard/admin/users"], "Status updated.", (i, db) =>
    db.from("profiles").update({ status: i.status }).eq("id", i.profileId),
  );
}

const RoleSchema = z.object({
  profileId: uuid,
  role: z.enum(["SUPER_ADMIN", "ORGANIZER", "TEACHER", "STUDENT", "PARENT"]),
});

// The enforce_profile_update trigger is the real gate: an ORGANIZER who
// forges SUPER_ADMIN/ORGANIZER here is rejected by the database.
export async function setUserRole(_prev: ActionResult, formData: FormData) {
  return run(formData, RoleSchema, ["/dashboard/admin/users"], "Role updated.", (i, db) =>
    db.from("profiles").update({ role: i.role }).eq("id", i.profileId),
  );
}

// ------------------------------------------------------------- academic

const YearSchema = z.object({
  name: text,
  startDate: text,
  endDate: text,
  isCurrent: checkbox,
});

export async function createAcademicYear(_prev: ActionResult, formData: FormData) {
  return run(formData, YearSchema, ["/dashboard/admin/academic"], "Academic year created.", async (i, db) => {
    if (i.isCurrent) {
      const cleared = await db.from("academic_years").update({ is_current: false }).eq("is_current", true);
      if (cleared.error) return cleared;
    }
    return db.from("academic_years").insert({
      name: i.name,
      start_date: i.startDate,
      end_date: i.endDate,
      is_current: i.isCurrent,
    });
  });
}

const ClassSchema = z.object({
  academicYearId: uuid,
  name: text,
  nameBn: optionalText,
  orderIndex: z.coerce.number().int().min(0).default(0),
});

export async function createClass(_prev: ActionResult, formData: FormData) {
  return run(formData, ClassSchema, ["/dashboard/admin/academic"], "Class created.", (i, db) =>
    db.from("classes").insert({
      academic_year_id: i.academicYearId,
      name: i.name,
      name_bn: i.nameBn ?? null,
      order_index: i.orderIndex,
    }),
  );
}

const SectionSchema = z.object({
  classId: uuid,
  name: text,
  nameBn: optionalText,
  capacity: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .pipe(z.number().int().positive().optional()),
});

export async function createSection(_prev: ActionResult, formData: FormData) {
  return run(formData, SectionSchema, ["/dashboard/admin/academic"], "Section created.", (i, db) =>
    db.from("sections").insert({
      class_id: i.classId,
      name: i.name,
      name_bn: i.nameBn ?? null,
      capacity: i.capacity ?? null,
    }),
  );
}

const SubjectSchema = z.object({ code: text.transform((v) => v.toUpperCase()), name: text, nameBn: optionalText });

export async function createSubject(_prev: ActionResult, formData: FormData) {
  return run(formData, SubjectSchema, ["/dashboard/admin/academic"], "Subject created.", (i, db) =>
    db.from("subjects").insert({ code: i.code, name: i.name, name_bn: i.nameBn ?? null }),
  );
}

// --------------------------------------------------------------- people

const StudentSchema = z.object({
  admissionNumber: text,
  fullName: text,
  fullNameBn: optionalText,
  dateOfBirth: optionalDate,
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().or(z.literal("").transform(() => undefined)),
  phone: optionalText,
  address: optionalText,
});

export async function createStudent(_prev: ActionResult, formData: FormData) {
  return run(formData, StudentSchema, ["/dashboard/admin/people"], "Student created.", (i, db) =>
    db.from("students").insert({
      admission_number: i.admissionNumber,
      full_name: i.fullName,
      full_name_bn: i.fullNameBn ?? null,
      date_of_birth: i.dateOfBirth ?? null,
      gender: i.gender ?? null,
      phone: i.phone ?? null,
      address: i.address ?? null,
    }),
  );
}

const GuardianSchema = z.object({
  fullName: text,
  fullNameBn: optionalText,
  phone: optionalText,
  email: optionalText,
  occupation: optionalText,
});

export async function createGuardian(_prev: ActionResult, formData: FormData) {
  return run(formData, GuardianSchema, ["/dashboard/admin/people"], "Guardian created.", (i, db) =>
    db.from("guardians").insert({
      full_name: i.fullName,
      full_name_bn: i.fullNameBn ?? null,
      phone: i.phone ?? null,
      email: i.email ?? null,
      occupation: i.occupation ?? null,
    }),
  );
}

const TeacherSchema = z.object({
  fullName: text,
  fullNameBn: optionalText,
  email: optionalText,
  phone: optionalText,
  designation: optionalText,
  department: optionalText,
});

export async function createTeacher(_prev: ActionResult, formData: FormData) {
  return run(formData, TeacherSchema, ["/dashboard/admin/people"], "Teacher created.", (i, db) =>
    db.from("teachers").insert({
      full_name: i.fullName,
      full_name_bn: i.fullNameBn ?? null,
      email: i.email ?? null,
      phone: i.phone ?? null,
      designation: i.designation ?? null,
      department: i.department ?? null,
    }),
  );
}

const LinkSchema = z.object({
  kind: z.enum(["students", "guardians", "teachers"]),
  recordId: uuid,
  email: z.email({ error: "Enter the account's email." }).trim(),
});

const ROLE_FOR_KIND = { students: "STUDENT", guardians: "PARENT", teachers: "TEACHER" } as const;

// Links an existing account (matched by email) to a school record. The
// enforce_profile_role trigger re-checks the role in the database.
export async function linkAccount(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireStaff();
  const parsed = LinkSchema.safeParse(fields(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join("; ") };

  const { kind, recordId, email } = parsed.data;
  const db = await createClient();

  const { data: profile, error: lookupError } = await db
    .from("profiles")
    .select("id, role")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (lookupError) return { error: friendly(lookupError) };
  if (!profile) return { error: "No account with that email." };
  if (profile.role !== ROLE_FOR_KIND[kind]) {
    return { error: `That account's role is ${profile.role}, expected ${ROLE_FOR_KIND[kind]}.` };
  }

  const { error } = await db.from(kind).update({ profile_id: profile.id }).eq("id", recordId);
  if (error) return { error: friendly(error) };

  revalidatePath("/dashboard/admin/people");
  return { ok: "Account linked." };
}

// -------------------------------------------------------- relationships

type Db = Awaited<ReturnType<typeof createClient>>;

// The form picks one section; the class and academic year are derived from it,
// so an inconsistent year/class/section combination cannot be submitted.
type DbError = { code?: string; message: string };
type ResolvedSection =
  | { ok: true; sectionId: string; classId: string; academicYearId: string }
  | { ok: false; error: DbError };

async function resolveSection(db: Db, sectionId: string): Promise<ResolvedSection> {
  const { data: section, error } = await db.from("sections").select("id, class_id").eq("id", sectionId).maybeSingle();
  if (error) return { ok: false, error };
  if (!section) return { ok: false, error: { message: "Section not found." } };
  const { data: cls, error: classError } = await db
    .from("classes")
    .select("id, academic_year_id")
    .eq("id", section.class_id)
    .maybeSingle();
  if (classError) return { ok: false, error: classError };
  if (!cls) return { ok: false, error: { message: "Class not found." } };
  return { ok: true, sectionId: section.id, classId: cls.id, academicYearId: cls.academic_year_id };
}

const EnrollSchema = z.object({ studentId: uuid, sectionId: uuid, rollNumber: optionalText });

export async function enrollStudent(_prev: ActionResult, formData: FormData) {
  return run(formData, EnrollSchema, ["/dashboard/admin/relationships"], "Student enrolled.", async (i, db) => {
    const target = await resolveSection(db, i.sectionId);
    if (!target.ok) return { error: target.error };
    return db.from("student_enrollments").insert({
      student_id: i.studentId,
      academic_year_id: target.academicYearId,
      class_id: target.classId,
      section_id: target.sectionId,
      roll_number: i.rollNumber ?? null,
    });
  });
}

const GuardianLinkSchema = z.object({
  studentId: uuid,
  guardianId: uuid,
  relationship: z.enum([
    "FATHER",
    "MOTHER",
    "GRANDFATHER",
    "GRANDMOTHER",
    "UNCLE",
    "AUNT",
    "SIBLING",
    "LEGAL_GUARDIAN",
    "OTHER",
  ]),
  isPrimary: checkbox,
  canPickUp: checkbox,
  receivesNotifications: checkbox,
});

export async function linkGuardian(_prev: ActionResult, formData: FormData) {
  return run(formData, GuardianLinkSchema, ["/dashboard/admin/relationships"], "Guardian linked.", (i, db) =>
    db.from("student_guardians").insert({
      student_id: i.studentId,
      guardian_id: i.guardianId,
      relationship: i.relationship,
      is_primary: i.isPrimary,
      can_pick_up: i.canPickUp,
      receives_notifications: i.receivesNotifications,
    }),
  );
}

const AssignSchema = z.object({ teacherId: uuid, sectionId: uuid, subjectId: uuid, isClassTeacher: checkbox });

export async function assignTeacher(_prev: ActionResult, formData: FormData) {
  return run(formData, AssignSchema, ["/dashboard/admin/relationships"], "Teacher assigned.", async (i, db) => {
    const target = await resolveSection(db, i.sectionId);
    if (!target.ok) return { error: target.error };
    return db.from("teacher_assignments").insert({
      teacher_id: i.teacherId,
      academic_year_id: target.academicYearId,
      class_id: target.classId,
      section_id: target.sectionId,
      subject_id: i.subjectId,
      is_class_teacher: i.isClassTeacher,
    });
  });
}
