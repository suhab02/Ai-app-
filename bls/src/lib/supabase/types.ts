/**
 * Hand-written mirror of supabase/migrations/*.sql for Phase 1.
 * Once the Supabase CLI is linked to a real project, replace this file with
 * the generated output of `supabase gen types typescript` (see
 * docs/database.md) so it can never drift from the real schema again.
 */

export type UserRole =
  | "SUPER_ADMIN"
  | "ORGANIZER"
  | "TEACHER"
  | "STUDENT"
  | "PARENT";

export type AccountStatus =
  | "PENDING"
  | "ACTIVE"
  | "INACTIVE"
  | "SUSPENDED"
  | "ARCHIVED";

export type EnrollmentStatus = "ACTIVE" | "COMPLETED" | "WITHDRAWN" | "TRANSFERRED";

export type GuardianRelationship =
  | "FATHER"
  | "MOTHER"
  | "GRANDFATHER"
  | "GRANDMOTHER"
  | "UNCLE"
  | "AUNT"
  | "SIBLING"
  | "LEGAL_GUARDIAN"
  | "OTHER";

export type Gender = "MALE" | "FEMALE" | "OTHER";

export type ProfileRow = {
  id: string;
  display_id: string;
  role: UserRole;
  status: AccountStatus;
  full_name: string | null;
  full_name_bn: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type AcademicYearRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  created_at: string;
  updated_at: string;
};

export type ClassRow = {
  id: string;
  academic_year_id: string;
  name: string;
  name_bn: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
};

export type SectionRow = {
  id: string;
  class_id: string;
  name: string;
  name_bn: string | null;
  capacity: number | null;
  created_at: string;
  updated_at: string;
};

export type SubjectRow = {
  id: string;
  code: string;
  name: string;
  name_bn: string | null;
  created_at: string;
  updated_at: string;
};

export type StudentRow = {
  id: string;
  profile_id: string | null;
  admission_number: string;
  full_name: string;
  full_name_bn: string | null;
  photo_url: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  blood_group: string | null;
  nationality: string | null;
  phone: string | null;
  address: string | null;
  admission_date: string;
  previous_school: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type GuardianRow = {
  id: string;
  profile_id: string | null;
  full_name: string;
  full_name_bn: string | null;
  photo_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  occupation: string | null;
  workplace: string | null;
  is_emergency_contact: boolean;
  created_at: string;
  updated_at: string;
};

export type TeacherRow = {
  id: string;
  profile_id: string | null;
  full_name: string;
  full_name_bn: string | null;
  photo_url: string | null;
  email: string | null;
  phone: string | null;
  joining_date: string | null;
  designation: string | null;
  department: string | null;
  qualifications: string | null;
  experience_years: number | null;
  address: string | null;
  created_at: string;
  updated_at: string;
};

export type StudentEnrollmentRow = {
  id: string;
  student_id: string;
  academic_year_id: string;
  class_id: string;
  section_id: string;
  roll_number: string | null;
  status: EnrollmentStatus;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

export type StudentGuardianRow = {
  id: string;
  student_id: string;
  guardian_id: string;
  relationship: GuardianRelationship;
  is_primary: boolean;
  can_pick_up: boolean;
  receives_notifications: boolean;
  created_at: string;
};

export type TeacherAssignmentRow = {
  id: string;
  teacher_id: string;
  academic_year_id: string;
  class_id: string;
  section_id: string;
  subject_id: string;
  is_class_teacher: boolean;
  created_at: string;
};

type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow, "id">;
      academic_years: Table<AcademicYearRow, "name" | "start_date" | "end_date">;
      classes: Table<ClassRow, "academic_year_id" | "name">;
      sections: Table<SectionRow, "class_id" | "name">;
      subjects: Table<SubjectRow, "code" | "name">;
      students: Table<StudentRow, "admission_number" | "full_name">;
      guardians: Table<GuardianRow, "full_name">;
      teachers: Table<TeacherRow, "full_name">;
      student_enrollments: Table<
        StudentEnrollmentRow,
        "student_id" | "academic_year_id" | "class_id" | "section_id"
      >;
      student_guardians: Table<StudentGuardianRow, "student_id" | "guardian_id" | "relationship">;
      teacher_assignments: Table<
        TeacherAssignmentRow,
        "teacher_id" | "academic_year_id" | "class_id" | "section_id" | "subject_id"
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
