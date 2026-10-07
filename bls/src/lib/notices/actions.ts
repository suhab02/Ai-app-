"use server";

import * as z from "zod";
import { runStaff, type ActionResult } from "@/lib/server-actions";
import { isIsoDate } from "@/lib/school/date";

const checkbox = z.string().optional().transform((v) => v === "on" || v === "true");
const optionalText = z.string().trim().max(5000).optional().transform((v) => (v ? v : undefined));
const optionalUuid = z.string().optional().transform((v) => (v ? v : undefined)).pipe(z.uuid().optional());
const audience = z.enum(["ALL", "TEACHERS", "STUDENTS", "PARENTS"]);
const PATHS = ["/dashboard/notices"];

/** An <input type="date"> value means "the end of that day" in the school's timezone (Asia/Dhaka, UTC+6). */
const endOfDayDhaka = (date: string) => `${date}T23:59:59+06:00`;
/** An <input type="datetime-local"> value is local school time. */
const dhakaDateTime = (value: string) => `${value.length === 16 ? `${value}:00` : value}+06:00`;

const NoticeSchema = z.object({
  title: z.string().trim().min(1, { error: "Enter a title." }).max(200),
  body: z.string().trim().min(1, { error: "Write the notice." }).max(5000),
  audience,
  sectionId: optionalUuid,
  isPublished: checkbox,
  isPublic: checkbox,
  isPinned: checkbox,
  expiresOn: z.string().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || isIsoDate(v), { error: "Invalid expiry date." }),
});

// The database re-checks the rules that matter (a public notice must be for everyone and not
// section-targeted; audience matching on read), so a hand-built request can't bypass them.
export async function createNotice(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, NoticeSchema, PATHS, "Notice saved.", (i, db) =>
    db.from("notices").insert({
      title: i.title,
      body: i.body,
      audience: i.audience,
      section_id: i.sectionId ?? null,
      is_published: i.isPublished,
      is_public: i.isPublic,
      is_pinned: i.isPinned,
      expires_at: i.expiresOn ? endOfDayDhaka(i.expiresOn) : null,
    }),
  );
}

const ToggleSchema = z.object({ id: z.uuid(), publish: z.enum(["true", "false"]) });

export async function setNoticePublished(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, ToggleSchema, PATHS, "Notice updated.", (i, db) =>
    db.from("notices").update({ is_published: i.publish === "true" }).eq("id", i.id),
  );
}

export async function deleteNotice(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, z.object({ id: z.uuid() }), PATHS, "Notice deleted.", (i, db) =>
    db.from("notices").delete().eq("id", i.id),
  );
}

const EventSchema = z.object({
  title: z.string().trim().min(1, { error: "Enter a title." }).max(200),
  description: optionalText,
  startsAt: z.string().min(1, { error: "Choose a start time." }),
  endsAt: z.string().optional().transform((v) => (v ? v : undefined)),
  location: z.string().trim().max(200).optional().transform((v) => (v ? v : undefined)),
  audience,
  isPublished: checkbox,
  isPublic: checkbox,
});

export async function createEvent(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, EventSchema, PATHS, "Event saved.", (i, db) =>
    db.from("events").insert({
      title: i.title,
      description: i.description ?? null,
      starts_at: dhakaDateTime(i.startsAt),
      ends_at: i.endsAt ? dhakaDateTime(i.endsAt) : null,
      location: i.location ?? null,
      audience: i.audience,
      is_published: i.isPublished,
      is_public: i.isPublic,
    }),
  );
}

export async function setEventPublished(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, ToggleSchema, PATHS, "Event updated.", (i, db) =>
    db.from("events").update({ is_published: i.publish === "true" }).eq("id", i.id),
  );
}

export async function deleteEvent(_prev: ActionResult, formData: FormData) {
  return runStaff(formData, z.object({ id: z.uuid() }), PATHS, "Event deleted.", (i, db) =>
    db.from("events").delete().eq("id", i.id),
  );
}
