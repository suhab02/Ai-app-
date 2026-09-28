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

export interface ProfileRow {
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
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & { id: string };
        Update: Partial<ProfileRow>;
      };
    };
  };
}
