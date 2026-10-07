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

export type NoticeAudience = "ALL" | "TEACHERS" | "STUDENTS" | "PARENTS";

export type PaymentMethod = "CASH" | "BANK" | "BKASH" | "NAGAD" | "ROCKET" | "CARD" | "ONLINE" | "OTHER";

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIAL";

export type AssessmentKind =
  | "CLASS_TEST"
  | "QUIZ"
  | "MONTHLY"
  | "TERM"
  | "ANNUAL"
  | "ASSIGNMENT"
  | "PRACTICAL"
  | "CUSTOM";

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "LEAVE";

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

export type AttendanceRecordRow = {
  id: string;
  student_id: string;
  academic_year_id: string;
  class_id: string;
  section_id: string;
  attendance_date: string;
  status: AttendanceStatus;
  note: string | null;
  marked_by: string | null;
  created_at: string;
  updated_at: string;
};

export type HomeworkRow = {
  id: string;
  academic_year_id: string;
  class_id: string;
  section_id: string;
  subject_id: string;
  teacher_id: string | null;
  title: string;
  description: string | null;
  assigned_date: string;
  due_date: string;
  created_at: string;
  updated_at: string;
};

export type GradingScaleRow = { id: string; name: string; is_default: boolean; created_at: string };

export type GradingBandRow = {
  id: string;
  scale_id: string;
  letter: string;
  min_score: number;
  grade_point: number;
  is_pass: boolean;
};

export type AssessmentRow = {
  id: string;
  academic_year_id: string;
  class_id: string;
  section_id: string;
  subject_id: string;
  kind: AssessmentKind;
  name: string;
  term: string;
  max_marks: number;
  grading_scale_id: string;
  assessment_date: string;
  is_published: boolean;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AssessmentResultRow = {
  id: string;
  assessment_id: string;
  student_id: string;
  marks_obtained: number | null;
  is_absent: boolean;
  remarks: string | null;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TimetablePeriodRow = {
  id: string;
  period_no: number;
  label: string;
  start_time: string;
  end_time: string;
  is_break: boolean;
  created_at: string;
};

export type TimetableEntryRow = {
  id: string;
  academic_year_id: string;
  class_id: string;
  section_id: string;
  weekday: number;
  period_id: string;
  subject_id: string;
  teacher_id: string | null;
  room: string | null;
  created_at: string;
  updated_at: string;
};

export type FeeTypeRow = { id: string; code: string; name: string; name_bn: string | null; created_at: string };

export type InvoiceRow = {
  id: string;
  student_id: string;
  academic_year_id: string;
  fee_type_id: string;
  description: string | null;
  amount_due: number;
  due_date: string;
  voided_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentRow = {
  id: string;
  invoice_id: string;
  student_id: string;
  guardian_id: string | null;
  amount: number;
  paid_at: string;
  method: PaymentMethod;
  reference: string | null;
  status: PaymentStatus;
  collected_by: string | null;
  notes: string | null;
  receipt_no: string;
  created_at: string;
  updated_at: string;
};

export type NoticeRow = {
  id: string;
  title: string;
  body: string;
  audience: NoticeAudience;
  section_id: string | null;
  is_published: boolean;
  published_at: string | null;
  expires_at: string | null;
  is_pinned: boolean;
  is_public: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  audience: NoticeAudience;
  is_published: boolean;
  is_public: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type GalleryAlbumRow = {
  id: string;
  title: string;
  title_bn: string | null;
  description: string | null;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type GalleryPhotoRow = {
  id: string;
  album_id: string;
  storage_path: string;
  caption: string | null;
  caption_bn: string | null;
  sort_order: number;
  created_by: string | null;
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
      attendance_records: Table<
        AttendanceRecordRow,
        "student_id" | "academic_year_id" | "class_id" | "section_id" | "attendance_date" | "status"
      >;
      grading_scales: Table<GradingScaleRow, "name">;
      grading_scale_bands: Table<GradingBandRow, "scale_id" | "letter" | "min_score" | "grade_point">;
      assessments: Table<
        AssessmentRow,
        "academic_year_id" | "class_id" | "section_id" | "subject_id" | "kind" | "name" | "term" | "max_marks"
      >;
      assessment_results: Table<AssessmentResultRow, "assessment_id" | "student_id">;
      timetable_periods: Table<TimetablePeriodRow, "period_no" | "label" | "start_time" | "end_time">;
      timetable_entries: Table<
        TimetableEntryRow,
        "academic_year_id" | "class_id" | "section_id" | "weekday" | "period_id" | "subject_id"
      >;
      fee_types: Table<FeeTypeRow, "code" | "name">;
      invoices: Table<InvoiceRow, "student_id" | "academic_year_id" | "fee_type_id" | "amount_due" | "due_date">;
      payments: Table<PaymentRow, "invoice_id" | "amount" | "method">;
      notices: Table<NoticeRow, "title" | "body">;
      events: Table<EventRow, "title" | "starts_at">;
      gallery_albums: Table<GalleryAlbumRow, "title">;
      gallery_photos: Table<GalleryPhotoRow, "album_id" | "storage_path">;
      homework: Table<
        HomeworkRow,
        "academic_year_id" | "class_id" | "section_id" | "subject_id" | "title" | "due_date"
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
