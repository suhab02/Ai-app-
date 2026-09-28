import * as z from "zod";

/**
 * Self-service signup may only ever request STUDENT or PARENT — this is the
 * client-side half of the "no privileged self-registration" rule. The
 * server-side half (the only half that actually matters) lives in the
 * on_auth_user_created trigger in supabase/migrations/0002_rls.sql, which
 * silently downgrades anything else to STUDENT.
 */
export const SelfServiceRole = z.enum(["STUDENT", "PARENT"]);

export const SignupSchema = z.object({
  fullName: z.string().trim().min(2, { error: "Enter your full name." }),
  email: z.email({ error: "Enter a valid email address." }).trim(),
  password: z
    .string()
    .min(8, { error: "Password must be at least 8 characters." })
    .regex(/[a-zA-Z]/, { error: "Password needs at least one letter." })
    .regex(/[0-9]/, { error: "Password needs at least one number." }),
  requestedRole: SelfServiceRole,
});

export const LoginSchema = z.object({
  email: z.email({ error: "Enter a valid email address." }).trim(),
  password: z.string().min(1, { error: "Enter your password." }),
});

export type FormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string[]>;
    }
  | undefined;
