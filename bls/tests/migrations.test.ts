import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Applies every migration (twice, to prove idempotency) to an embedded
 * Postgres with stubbed Supabase auth/roles, then asserts RLS isolation.
 * Needs no Supabase project: `npm run test:migrations`.
 */
const MIG = join(process.cwd(), "supabase", "migrations");

async function run(): Promise<{ pass: number; failures: string[] }> {
const db = new PGlite();

let pass = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else failures.push(`${name} ${detail}`);
}

await db.exec(`
  create schema if not exists extensions;
  create schema if not exists auth;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;

  -- Minimal stand-in for Supabase Storage so the bucket + storage.objects policies really execute.
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
`);

// Apply every migration TWICE to prove idempotency.
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
for (let round = 1; round <= 2; round++) {
  for (const f of files) {
    let sql = readFileSync(`${MIG}/${f}`, "utf8");
    sql = sql.replace(/create extension if not exists pgcrypto with schema extensions;/, "");
    try {
      await db.exec(sql);
    } catch (e) {
      throw e;
    }
  }
}

// Users (the auth trigger creates the profiles)
const uid: Record<string, string> = {};
for (const n of ["admin", "organizer", "teacher", "student1", "student2", "parent1", "parent2", "teacher2"]) {
  const r = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`${n}@x.test`]);
  uid[n] = r.rows[0].id;
}
const roles: Record<string, string> = { admin: "SUPER_ADMIN", organizer: "ORGANIZER", teacher: "TEACHER", teacher2: "TEACHER",
  student1: "STUDENT", student2: "STUDENT", parent1: "PARENT", parent2: "PARENT" };
for (const [n, r] of Object.entries(roles)) {
  await db.query(`update public.profiles set role=$1, status='ACTIVE' where id=$2`, [r, uid[n]]);
}

// School data (as postgres = trusted)
type Row = { id: string };
const one = async (sql: string, p?: unknown[]) => (await db.query<Row>(sql, p)).rows[0];
const yr = await one(`insert into academic_years(name,start_date,end_date,is_current) values ('2025-2026','2025-01-01','2025-12-31',true) returning id`);
const cls = await one(`insert into classes(academic_year_id,name) values ($1,'Class 5') returning id`, [yr.id]);
const cls6 = await one(`insert into classes(academic_year_id,name) values ($1,'Class 6') returning id`, [yr.id]);
const secA = await one(`insert into sections(class_id,name) values ($1,'A') returning id`, [cls.id]);
const secB = await one(`insert into sections(class_id,name) values ($1,'B') returning id`, [cls.id]);
const sec6 = await one(`insert into sections(class_id,name) values ($1,'A') returning id`, [cls6.id]);
const sub = await one(`insert into subjects(code,name) values ('MATH','Math') returning id`);
const s1 = await one(`insert into students(profile_id,admission_number,full_name) values ($1,'A-1','Student One') returning id`, [uid.student1]);
const s2 = await one(`insert into students(profile_id,admission_number,full_name) values ($1,'A-2','Student Two') returning id`, [uid.student2]);
const g1 = await one(`insert into guardians(profile_id,full_name) values ($1,'Parent One') returning id`, [uid.parent1]);
const g2 = await one(`insert into guardians(profile_id,full_name) values ($1,'Parent Two') returning id`, [uid.parent2]);
const t1 = await one(`insert into teachers(profile_id,full_name) values ($1,'Teacher One') returning id`, [uid.teacher]);
await one(`insert into teachers(profile_id,full_name) values ($1,'Teacher Two') returning id`, [uid.teacher2]);
await db.query(`insert into student_enrollments(student_id,academic_year_id,class_id,section_id,roll_number) values ($1,$2,$3,$4,'1'),($5,$2,$3,$6,'1')`, [s1.id, yr.id, cls.id, secA.id, s2.id, secB.id]);
await db.query(`insert into student_guardians(student_id,guardian_id,relationship,is_primary) values ($1,$2,'FATHER',true),($3,$4,'MOTHER',true)`, [s1.id, g1.id, s2.id, g2.id]);
await db.query(`insert into teacher_assignments(teacher_id,academic_year_id,class_id,section_id,subject_id,is_class_teacher) values ($1,$2,$3,$4,$5,true)`, [t1.id, yr.id, cls.id, secA.id, sub.id]);

// Act as a user
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${user === "anon" ? "anon" : "authenticated"}`);
  await db.exec(`select set_config('request.jwt.claim.sub', '${user === "anon" ? "" : uid[user]}', false)`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.exec(`select set_config('request.jwt.claim.sub','',false)`); }
}
const names = async (t: string, col = "full_name") => (await db.query<{ n: string }>(`select ${col} as n from ${t} order by 1`)).rows.map((r) => r.n);
const tryErr = async (sql: string) => { try { await db.exec(sql); return null; } catch (e) { return (e as Error).message; } };
await as("parent1", async () => {
  check("parent1 sees only own child", JSON.stringify(await names("students")) === '["Student One"]', JSON.stringify(await names("students")));
  check("parent1 sees only own guardian row", JSON.stringify(await names("guardians")) === '["Parent One"]');
  check("parent1 sees only own child's enrollment", (await db.query(`select 1 from student_enrollments`)).rows.length === 1);
  check("parent1 sees only own guardian link", (await db.query(`select 1 from student_guardians`)).rows.length === 1);
  check("parent1 cannot see other teachers", (await db.query(`select 1 from teachers`)).rows.length === 0);
  check("parent1 sees teacher assignment of child's class", (await db.query(`select 1 from teacher_assignments`)).rows.length === 1);
});
await as("parent2", async () => {
  check("parent2 sees only own child", JSON.stringify(await names("students")) === '["Student Two"]');
  check("parent2 sees no teacher assignments (child in B)", (await db.query(`select 1 from teacher_assignments`)).rows.length === 0);
});
await as("student1", async () => {
  check("student1 sees only self", JSON.stringify(await names("students")) === '["Student One"]');
  check("student1 sees own guardian only", JSON.stringify(await names("guardians")) === '["Parent One"]');
  check("student1 sees own enrollment only", (await db.query(`select 1 from student_enrollments`)).rows.length === 1);
});
await as("student2", async () => {
  check("student2 cannot see student1", (await db.query(`select 1 from students where full_name='Student One'`)).rows.length === 0);
});
await as("teacher", async () => {
  check("teacher sees only assigned-class student", JSON.stringify(await names("students")) === '["Student One"]');
  check("teacher cannot see guardians", (await db.query(`select 1 from guardians`)).rows.length === 0);
  check("teacher sees only own teacher row", JSON.stringify(await names("teachers")) === '["Teacher One"]');
  check("teacher sees only class-A enrollment", (await db.query(`select 1 from student_enrollments`)).rows.length === 1);
});
await as("teacher2", async () => {
  check("unassigned teacher sees no students", (await db.query(`select 1 from students`)).rows.length === 0);
});
for (const admin of ["admin", "organizer"]) {
  await as(admin, async () => {
    check(`${admin} sees all students`, (await db.query(`select 1 from students`)).rows.length === 2);
    check(`${admin} sees all guardians`, (await db.query(`select 1 from guardians`)).rows.length === 2);
    check(`${admin} sees all teachers`, (await db.query(`select 1 from teachers`)).rows.length === 2);
  });
}
await as("student1", async () => {
  check("any user can read reference data", (await db.query(`select 1 from classes`)).rows.length === 2);
});
const anonErr = await as("anon", async () => tryErr(`select * from students`));
check("anon denied on students", !!anonErr, "anon read succeeded");
for (const u of ["teacher", "student1", "parent1"]) {
  await as(u, async () => {
    check(`${u} cannot insert student`, !!(await tryErr(`insert into students(admission_number,full_name) values ('X','X')`)));
    check(`${u} cannot insert academic year`, !!(await tryErr(`insert into academic_years(name,start_date,end_date) values ('Y','2030-01-01','2030-12-31')`)));
    check(`${u} cannot insert enrollment`, !!(await tryErr(`insert into student_enrollments(student_id,academic_year_id,class_id,section_id) values ('${s1.id}','${yr.id}','${cls.id}','${secA.id}')`)));
    let upd = 0;
    try { upd = (await db.query(`update students set full_name='hacked' returning 1`)).rows.length; } catch { upd = 0; }
    check(`${u} update on students affects 0 rows`, upd === 0, `updated ${upd}`);
    let del = 0;
    try { del = (await db.query(`delete from student_guardians returning 1`)).rows.length; } catch { del = 0; }
    check(`${u} delete on student_guardians affects 0 rows`, del === 0, `deleted ${del}`);
  });
}
await as("organizer", async () => {
  check("organizer can insert academic year", !(await tryErr(`insert into academic_years(name,start_date,end_date) values ('2026-2027','2026-01-01','2026-12-31')`)));
  check("organizer can insert subject", !(await tryErr(`insert into subjects(code,name) values ('ENG','English')`)));
});
// ---- Phase 3: attendance + homework ------------------------------------
const dstr = async (offset: number) =>
  (await db.query<{ d: string }>(`select to_char(public.school_today() + ${offset}, 'YYYY-MM-DD') as d`)).rows[0].d;
const today = await dstr(0);
const yesterday = await dstr(-1);
const twoDaysAgo = await dstr(-2);
const tomorrow = await dstr(1);
const t2 = await one(`select id from teachers where full_name='Teacher Two'`);
const count = async (sql: string) => (await db.query(sql)).rows.length;

await db.query(`insert into attendance_records(student_id,academic_year_id,class_id,section_id,attendance_date,status) values
  ($1,$3,$4,$5,'${yesterday}','PRESENT'), ($2,$3,$4,$6,'${yesterday}','ABSENT')`, [s1.id, s2.id, yr.id, cls.id, secA.id, secB.id]);

const att = (studentId: string, secId: string, date: string, status = "PRESENT", extra = "") =>
  `insert into attendance_records(student_id,academic_year_id,class_id,section_id,attendance_date,status${extra ? ",marked_by" : ""}) values ('${studentId}','${yr.id}','${cls.id}','${secId}','${date}','${status}'${extra ? `,'${extra}'` : ""})`;

await as("parent1", async () => check("parent1 sees only own child's attendance", (await count(`select 1 from attendance_records`)) === 1));
await as("parent2", async () => check("parent2 sees only own child's attendance", (await count(`select 1 from attendance_records where student_id='${s1.id}'`)) === 0));
await as("student1", async () => check("student1 sees only own attendance", (await count(`select 1 from attendance_records`)) === 1));
await as("student2", async () => check("student2 cannot see student1's attendance", (await count(`select 1 from attendance_records where student_id='${s1.id}'`)) === 0));
await as("teacher2", async () => check("unassigned teacher sees no attendance", (await count(`select 1 from attendance_records`)) === 0));
await as("organizer", async () => check("organizer sees all attendance", (await count(`select 1 from attendance_records`)) === 2));

await as("teacher", async () => {
  check("teacher sees only assigned section's attendance", (await count(`select 1 from attendance_records`)) === 1);
  check("teacher can mark own section (today)", !(await tryErr(att(s1.id, secA.id, today, "LATE"))));
  const mb = (await db.query<{ marked_by: string }>(`select marked_by from attendance_records where attendance_date='${today}'`)).rows[0];
  check("marked_by is the session user", mb?.marked_by === uid.teacher);
  check("forged marked_by is overwritten", !(await tryErr(att(s1.id, secA.id, twoDaysAgo, "PRESENT", uid.admin)))
    && (await db.query<{ marked_by: string }>(`select marked_by from attendance_records where attendance_date='${twoDaysAgo}'`)).rows[0]?.marked_by === uid.teacher);
  check("teacher cannot mark another section", !!(await tryErr(att(s2.id, secB.id, today))));
  check("future date rejected", !!(await tryErr(att(s1.id, secA.id, tomorrow))));
  check("duplicate day rejected", !!(await tryErr(att(s1.id, secA.id, today))));
  check("student not enrolled in that section rejected", !!(await tryErr(att(s2.id, secA.id, twoDaysAgo))));
  check("teacher can correct status", !(await tryErr(`update attendance_records set status='ABSENT', note='called home' where student_id='${s1.id}' and attendance_date='${today}'`)));
  check("date is immutable", !!(await tryErr(`update attendance_records set attendance_date='${yesterday}' where attendance_date='${today}'`)));
  check("student_id is immutable", !!(await tryErr(`update attendance_records set student_id='${s2.id}' where attendance_date='${today}'`)));
  const upsert = (studentId: string, secId: string, date: string, status: string) =>
    `insert into attendance_records(student_id,academic_year_id,class_id,section_id,attendance_date,status) values ('${studentId}','${yr.id}','${cls.id}','${secId}','${date}','${status}')
     on conflict (student_id, attendance_date) do update set student_id=excluded.student_id, academic_year_id=excluded.academic_year_id,
       class_id=excluded.class_id, section_id=excluded.section_id, attendance_date=excluded.attendance_date, status=excluded.status`;
  check("upsert (how the app saves) updates an existing day", !(await tryErr(upsert(s1.id, secA.id, today, "PRESENT")))
    && (await db.query<{ status: string }>(`select status from attendance_records where student_id='${s1.id}' and attendance_date='${today}'`)).rows[0]?.status === "PRESENT");
  check("upsert inserts a new day", !(await tryErr(upsert(s1.id, secA.id, twoDaysAgo, "ABSENT"))));
  check("upsert cannot smuggle a student into a section they are not enrolled in", !!(await tryErr(upsert(s2.id, secA.id, twoDaysAgo, "PRESENT"))));
  check("upsert cannot move a record to a section the teacher does not teach", !!(await tryErr(upsert(s1.id, secB.id, today, "PRESENT"))));
  check("teacher cannot delete attendance", (await db.query(`delete from attendance_records returning 1`)).rows.length === 0);
});
for (const u of ["student1", "parent1"]) {
  await as(u, async () => {
    check(`${u} cannot mark attendance`, !!(await tryErr(att(s1.id, secA.id, twoDaysAgo, "PRESENT"))));
    check(`${u} update affects 0 rows`, (await db.query(`update attendance_records set status='PRESENT' returning 1`)).rows.length === 0);
    check(`${u} delete affects 0 rows`, (await db.query(`delete from attendance_records returning 1`)).rows.length === 0);
  });
}
await as("organizer", async () => {
  check("organizer can delete attendance", (await db.query(`delete from attendance_records where attendance_date='${twoDaysAgo}' returning 1`)).rows.length === 1);
});

const hw = (teacherId: string | null, secId: string, subjectId: string, due: string, title = "Ch. 3 exercises") =>
  `insert into homework(academic_year_id,class_id,section_id,subject_id,teacher_id,title,due_date) values ('${yr.id}','${cls.id}','${secId}','${subjectId}',${teacherId ? `'${teacherId}'` : "null"},'${title}','${due}')`;
const sub2 = await one(`insert into subjects(code,name) values ('PHY','Physics') returning id`);

await as("teacher", async () => {
  check("teacher creates homework for assigned subject/section", !(await tryErr(hw(t1.id, secA.id, sub.id, tomorrow))));
  check("teacher cannot create homework for an unassigned subject", !!(await tryErr(hw(t1.id, secA.id, sub2.id, tomorrow))));
  check("teacher cannot create homework for an unassigned section", !!(await tryErr(hw(t1.id, secB.id, sub.id, tomorrow))));
  check("teacher cannot post as another teacher", !!(await tryErr(hw(t2.id, secA.id, sub.id, tomorrow))));
  check("due date before assigned date rejected", !!(await tryErr(hw(t1.id, secA.id, sub.id, twoDaysAgo))));
});
await as("student1", async () => check("student1 sees section homework", (await count(`select 1 from homework`)) === 1));
await as("parent1", async () => check("parent1 sees child's homework", (await count(`select 1 from homework`)) === 1));
await as("student2", async () => check("student2 (other section) sees no homework", (await count(`select 1 from homework`)) === 0));
await as("parent2", async () => check("parent2 (other section) sees no homework", (await count(`select 1 from homework`)) === 0));
await as("teacher2", async () => {
  check("unassigned teacher sees no homework", (await count(`select 1 from homework`)) === 0);
  check("unassigned teacher cannot delete it", (await db.query(`delete from homework returning 1`)).rows.length === 0);
});
await as("student1", async () => {
  check("student cannot create homework", !!(await tryErr(hw(null, secA.id, sub.id, tomorrow))));
  check("student cannot edit homework", (await db.query(`update homework set title='x' returning 1`)).rows.length === 0);
});
await as("organizer", async () => {
  check("organizer sees homework", (await count(`select 1 from homework`)) === 1);
  check("organizer can post homework without a teacher", !(await tryErr(hw(null, secA.id, sub.id, tomorrow, "Staff notice"))));
});
await as("teacher", async () => {
  check("teacher deletes own homework", (await db.query(`delete from homework where teacher_id='${t1.id}' returning 1`)).rows.length === 1);
});

// ---- Phase 4: assessments, results, grading -----------------------------
const r3 = await db.query<{ id: string }>(`insert into auth.users (email) values ('student3@x.test') returning id`);
uid.student3 = r3.rows[0].id;
await db.query(`update public.profiles set role='STUDENT', status='ACTIVE' where id=$1`, [uid.student3]);
const s3 = await one(`insert into students(profile_id,admission_number,full_name) values ($1,'A-3','Student Three') returning id`, [uid.student3]);
await db.query(`insert into student_enrollments(student_id,academic_year_id,class_id,section_id,roll_number) values ($1,$2,$3,$4,'7')`, [s3.id, yr.id, cls.id, secA.id]);

check("default grading scale has 7 bands", (await count(`select 1 from grading_scale_bands`)) === 7);
check("exactly one default scale", (await count(`select 1 from grading_scales where is_default`)) === 1);
check("a second default scale is rejected", !!(await tryErr(`insert into grading_scales(name,is_default) values ('X',true)`)));

const asmt = (secId: string, subjectId: string, name = "CT-1", max = 50) =>
  `insert into assessments(academic_year_id,class_id,section_id,subject_id,kind,name,term,max_marks) values ('${yr.id}','${cls.id}','${secId}','${subjectId}','CLASS_TEST','${name}','Term 1',${max})`;
let asmtId = "";
await as("teacher", async () => {
  check("teacher creates assessment for assigned subject/section", !(await tryErr(asmt(secA.id, sub.id))));
  check("teacher cannot create for an unassigned subject", !!(await tryErr(asmt(secA.id, sub2.id))));
  check("teacher cannot create for an unassigned section", !!(await tryErr(asmt(secB.id, sub.id))));
  asmtId = (await db.query<{ id: string }>(`select id from assessments where name='CT-1'`)).rows[0].id;
  const res = (studentId: string, marks: string, absent = false) =>
    `insert into assessment_results(assessment_id,student_id,marks_obtained,is_absent) values ('${asmtId}','${studentId}',${marks},${absent})`;
  check("teacher enters marks", !(await tryErr(res(s1.id, "45"))) && !(await tryErr(res(s3.id, "30"))));
  check("marks above max rejected", !!(await tryErr(`update assessment_results set marks_obtained=51 where student_id='${s1.id}'`)));
  check("negative marks rejected", !!(await tryErr(`update assessment_results set marks_obtained=-1 where student_id='${s1.id}'`)));
  check("student from another section rejected", !!(await tryErr(res(s2.id, "10"))));
  check("absent with marks rejected", !!(await tryErr(`update assessment_results set is_absent=true where student_id='${s3.id}'`)));
  check("absent without marks accepted", !(await tryErr(`update assessment_results set is_absent=true, marks_obtained=null where student_id='${s3.id}'`)));
  check("entered_by is the session user", (await db.query<{ entered_by: string }>(`select entered_by from assessment_results where student_id='${s1.id}'`)).rows[0]?.entered_by === uid.teacher);
});
for (const u of ["student1", "parent1", "student2", "parent2", "student3", "teacher2"]) {
  await as(u, async () => {
    check(`${u} sees no unpublished assessment`, (await count(`select 1 from assessments`)) === 0);
    check(`${u} sees no unpublished results`, (await count(`select 1 from assessment_results`)) === 0);
  });
}
await as("organizer", async () => check("organizer sees assessment and results", (await count(`select 1 from assessments`)) === 1 && (await count(`select 1 from assessment_results`)) === 2));
await as("student1", async () => {
  check("student cannot create assessment", !!(await tryErr(asmt(secA.id, sub.id, "Hack"))));
  check("student cannot enter marks", !!(await tryErr(`insert into assessment_results(assessment_id,student_id,marks_obtained) values ('${asmtId}','${s1.id}',50)`)));
  check("student cannot edit grading bands", (await db.query(`update grading_scale_bands set grade_point=9 returning 1`)).rows.length === 0);
});
await as("teacher", async () => check("teacher publishes", !(await tryErr(`update assessments set is_published=true where id='${asmtId}'`))));
await as("student1", async () => {
  check("student1 sees published assessment", (await count(`select 1 from assessments`)) === 1);
  check("student1 sees ONLY own result (not classmate's)", (await count(`select 1 from assessment_results`)) === 1
    && (await count(`select 1 from assessment_results where student_id='${s3.id}'`)) === 0);
});
await as("student3", async () => check("student3 sees only own result", (await count(`select 1 from assessment_results where student_id='${s3.id}'`)) === 1 && (await count(`select 1 from assessment_results`)) === 1));
await as("parent1", async () => check("parent1 sees only their child's result", (await count(`select 1 from assessment_results`)) === 1 && (await count(`select 1 from assessment_results where student_id='${s1.id}'`)) === 1));
await as("student2", async () => check("other-section student still sees nothing", (await count(`select 1 from assessments`)) === 0 && (await count(`select 1 from assessment_results`)) === 0));
await as("parent2", async () => check("other-section parent still sees nothing", (await count(`select 1 from assessment_results`)) === 0));
await as("teacher", async () => {
  check("teacher cannot change marks after publish", !!(await tryErr(`update assessment_results set marks_obtained=50 where student_id='${s1.id}'`)));
  check("teacher cannot edit a published assessment", !!(await tryErr(`update assessments set name='Changed' where id='${asmtId}'`)));
  check("teacher cannot unpublish", !!(await tryErr(`update assessments set is_published=false where id='${asmtId}'`)));
  check("teacher cannot delete a published assessment", (await db.query(`delete from assessments returning 1`).catch(() => ({ rows: [] }))).rows.length === 0);
});
await as("organizer", async () => {
  check("staff can correct marks after publish", !(await tryErr(`update assessment_results set marks_obtained=48 where student_id='${s1.id}'`)));
  check("max_marks cannot drop below entered marks", !!(await tryErr(`update assessments set max_marks=40 where id='${asmtId}'`)));
  check("staff can unpublish", !(await tryErr(`update assessments set is_published=false where id='${asmtId}'`)));
});
await as("student1", async () => check("unpublished again hides marks from student", (await count(`select 1 from assessment_results`)) === 0));

// ---- Phase 5: timetable --------------------------------------------------
const p1 = await one(`insert into timetable_periods(period_no,label,start_time,end_time) values (1,'Period 1','09:00','09:45') returning id`);
const p2 = await one(`insert into timetable_periods(period_no,label,start_time,end_time) values (2,'Period 2','09:50','10:35') returning id`);
const pBreak = await one(`insert into timetable_periods(period_no,label,start_time,end_time,is_break) values (3,'Recess','10:35','11:00',true) returning id`);
const t3 = await one(`insert into teachers(full_name) values ('Teacher Three') returning id`);
await db.query(`insert into teacher_assignments(teacher_id,academic_year_id,class_id,section_id,subject_id) values ($1,$2,$3,$4,$5),($1,$2,$3,$6,$5)`, [t3.id, yr.id, cls.id, secA.id, sub.id, secB.id]);

const tt = (secId: string, weekday: number, periodId: string, subjectId: string, teacherId: string | null) =>
  `insert into timetable_entries(academic_year_id,class_id,section_id,weekday,period_id,subject_id,teacher_id) values ('${yr.id}','${cls.id}','${secId}',${weekday},'${periodId}','${subjectId}',${teacherId ? `'${teacherId}'` : "null"})`;

check("period times must be ordered", !!(await tryErr(`insert into timetable_periods(period_no,label,start_time,end_time) values (9,'Bad','10:00','09:00')`)));
await as("organizer", async () => {
  check("staff schedules a lesson (teacher is assigned that subject)", !(await tryErr(tt(secA.id, 0, p1.id, sub.id, t1.id))));
  check("a teacher not assigned that subject is rejected", !!(await tryErr(tt(secA.id, 0, p2.id, sub2.id, t1.id))));
  check("a teacher not assigned to that section is rejected", !!(await tryErr(tt(secB.id, 0, p1.id, sub.id, t1.id))));
  check("lessons can't go in a break period", !!(await tryErr(tt(secA.id, 0, pBreak.id, sub.id, null))));
  check("a section has one lesson per slot", !!(await tryErr(tt(secA.id, 0, p1.id, sub.id, null))));
  check("weekday must be 0-6", !!(await tryErr(tt(secA.id, 7, p2.id, sub.id, null))));
  check("a lesson with no teacher yet is allowed", !(await tryErr(tt(secA.id, 1, p1.id, sub.id, null))));
  check("teacher3 scheduled in section A", !(await tryErr(tt(secA.id, 2, p1.id, sub.id, t3.id))));
  check("teacher cannot be double-booked in another section at the same time", !!(await tryErr(tt(secB.id, 2, p1.id, sub.id, t3.id))));
  check("same teacher, different slot is fine", !(await tryErr(tt(secB.id, 2, p2.id, sub.id, t3.id))));
  check("staff can reschedule within the rules", !(await tryErr(`update timetable_entries set room='101' where section_id='${secA.id}' and weekday=0 and period_id='${p1.id}'`)));
});
await as("student1", async () => {
  check("student1 sees their section's timetable only", (await count(`select 1 from timetable_entries`)) === 3 && (await count(`select 1 from timetable_entries where section_id='${secB.id}'`)) === 0);
  check("anyone can read periods", (await count(`select 1 from timetable_periods`)) === 3);
});
await as("parent1", async () => check("parent1 sees their child's section only", (await count(`select 1 from timetable_entries where section_id='${secB.id}'`)) === 0 && (await count(`select 1 from timetable_entries`)) === 3));
await as("student2", async () => check("student2 sees only section B", (await count(`select 1 from timetable_entries`)) === 1 && (await count(`select 1 from timetable_entries where section_id='${secA.id}'`)) === 0));
await as("teacher", async () => check("assigned teacher sees section A's timetable", (await count(`select 1 from timetable_entries`)) === 3));
await as("teacher2", async () => check("unassigned teacher sees no timetable", (await count(`select 1 from timetable_entries`)) === 0));
for (const u of ["teacher", "student1", "parent1"]) {
  await as(u, async () => {
    check(`${u} cannot schedule lessons`, !!(await tryErr(tt(secA.id, 3, p1.id, sub.id, null))));
    check(`${u} cannot change periods`, (await db.query(`update timetable_periods set label='x' returning 1`)).rows.length === 0);
    check(`${u} cannot delete lessons`, (await db.query(`delete from timetable_entries returning 1`)).rows.length === 0);
  });
}

// ---- Phase 6: fees, payments, receipts ----------------------------------
const ft = await one(`insert into fee_types(code,name) values ('TUITION','Tuition') returning id`);
const invoiceSql = (studentId: string, amount: number, desc = "Tuition") =>
  `insert into invoices(student_id,academic_year_id,fee_type_id,amount_due,due_date,description) values ('${studentId}','${yr.id}','${ft.id}',${amount},'${tomorrow}','${desc}') returning id`;
const pay = (invId: string, amount: number, status = "PAID", extra = "") =>
  `insert into payments(invoice_id,amount,method,status${extra ? ",guardian_id,receipt_no" : ""}) values ('${invId}',${amount},'CASH','${status}'${extra ? extra : ""}) returning receipt_no`;

let inv1 = "";
let inv2 = "";
let payId2 = "";
await as("organizer", async () => {
  inv1 = (await db.query<{ id: string }>(invoiceSql(s1.id, 2000, "Jan tuition"))).rows[0].id;
  inv2 = (await db.query<{ id: string }>(invoiceSql(s2.id, 1500))).rows[0].id;
  check("created_by is the session user", (await db.query<{ created_by: string }>(`select created_by from invoices where id='${inv1}'`)).rows[0].created_by === uid.organizer);
  check("zero/negative invoice rejected", !!(await tryErr(invoiceSql(s1.id, 0))) && !!(await tryErr(invoiceSql(s1.id, -5))));

  const first = (await db.query<{ receipt_no: string }>(pay(inv1, 1200, "PAID", `,null,'FORGED-1'`))).rows[0].receipt_no;
  check("receipt number is server-generated (forged value ignored)", /^BLS-RCPT-\d{4}-000001$/.test(first), first);
  const second = (await db.query<{ receipt_no: string }>(pay(inv1, 800))).rows[0].receipt_no;
  check("receipt numbers increment", /-000002$/.test(second), second);
  check("student_id is derived from the invoice", (await db.query<{ ok: boolean }>(`select bool_and(student_id='${s1.id}') as ok from payments where invoice_id='${inv1}'`)).rows[0].ok);
  check("collected_by is the session user", (await db.query<{ ok: boolean }>(`select bool_and(collected_by='${uid.organizer}') as ok from payments`)).rows[0].ok);
  check("overpayment rejected (invoice already fully paid)", !!(await tryErr(pay(inv1, 1))));

  check("a PENDING payment doesn't count, so it is allowed", !(await tryErr(pay(inv1, 500, "PENDING"))));
  const pendingId = (await db.query<{ id: string }>(`select id from payments where status='PENDING'`)).rows[0].id;
  check("PENDING cannot become PAID if it would overpay", !!(await tryErr(`update payments set status='PAID' where id='${pendingId}'`)));
  check("PENDING can become FAILED", !(await tryErr(`update payments set status='FAILED' where id='${pendingId}'`)));
  check("FAILED is terminal", !!(await tryErr(`update payments set status='PAID' where id='${pendingId}'`)));

  payId2 = (await db.query<{ id: string }>(`select id from payments where invoice_id='${inv1}' and amount=800`)).rows[0].id;
  check("amount is immutable", !!(await tryErr(`update payments set amount=1 where id='${payId2}'`)));
  check("receipt_no is immutable", !!(await tryErr(`update payments set receipt_no='X' where id='${payId2}'`)));
  check("invoice_id is immutable", !!(await tryErr(`update payments set invoice_id='${inv2}' where id='${payId2}'`)));
  check("notes can be edited", !(await tryErr(`update payments set notes='cheque 123' where id='${payId2}'`)));
  check("amount_due cannot drop below what is paid", !!(await tryErr(`update invoices set amount_due=1500 where id='${inv1}'`)));
  check("an invoice with payments cannot be voided", !!(await tryErr(`update invoices set voided_at=now() where id='${inv1}'`)));

  check("refund keeps the row (PAID -> REFUNDED)", !(await tryErr(`update payments set status='REFUNDED' where id='${payId2}'`)));
  check("REFUNDED is terminal", !!(await tryErr(`update payments set status='PAID' where id='${payId2}'`)));
  check("a refund frees the balance for a new payment", !(await tryErr(pay(inv1, 800))));
  check("history preserved: refunded payment still exists", (await count(`select 1 from payments where status='REFUNDED'`)) === 1);

  check("a guardian not linked to the student is rejected", !!(await tryErr(pay(inv2, 500, "PAID", `,'${g1.id}',DEFAULT`))));
  check("the student's own guardian is accepted", !(await tryErr(pay(inv2, 500, "PAID", `,'${g2.id}',DEFAULT`))));
  check("a future paid_at is rejected", !!(await tryErr(`insert into payments(invoice_id,amount,method,paid_at) values ('${inv2}',10,'CASH', now() + interval '1 day')`)));
  check("payments cannot be deleted", !!(await tryErr(`delete from payments`)));
  check("invoices cannot be deleted", !!(await tryErr(`delete from invoices`)));

  const inv3 = (await db.query<{ id: string }>(invoiceSql(s1.id, 100, "Mistaken"))).rows[0].id;
  check("an unpaid invoice can be voided", !(await tryErr(`update invoices set voided_at=now() where id='${inv3}'`)));
  check("no payment on a voided invoice", !!(await tryErr(pay(inv3, 10))));
  check("a voided invoice cannot be reinstated", !!(await tryErr(`update invoices set voided_at=null where id='${inv3}'`)));
});

for (const u of ["student1", "parent1"]) {
  await as(u, async () => {
    check(`${u} sees only their own invoices/payments`, (await count(`select 1 from invoices where student_id='${s2.id}'`)) === 0 && (await count(`select 1 from payments where student_id='${s2.id}'`)) === 0 && (await count(`select 1 from payments`)) >= 3);
  });
}
for (const u of ["student2", "parent2"]) {
  await as(u, async () => check(`${u} sees only their own invoices`, (await count(`select 1 from invoices where student_id='${s1.id}'`)) === 0 && (await count(`select 1 from invoices`)) === 1));
}
for (const u of ["teacher", "teacher2", "student3"]) {
  await as(u, async () => check(`${u} sees no fee data`, (await count(`select 1 from invoices`)) === 0 && (await count(`select 1 from payments`)) === 0));
}
for (const u of ["student1", "parent1", "teacher"]) {
  await as(u, async () => {
    check(`${u} cannot create invoices`, !!(await tryErr(invoiceSql(s1.id, 50))));
    check(`${u} cannot record payments`, !!(await tryErr(pay(inv1, 1))));
    check(`${u} cannot edit payments`, (await db.query(`update payments set notes='x' returning 1`)).rows.length === 0);
  });
}
await as("student1", async () => {
  check("fee types are readable but not writable", (await count(`select 1 from fee_types`)) === 1 && !!(await tryErr(`insert into fee_types(code,name) values ('X','X')`)));
});
for (const u of ["anon", "student1"]) {
  await as(u, async () => {
    check(`${u} cannot call next_receipt_no()`, !!(await tryErr(`select public.next_receipt_no()`)));
    check(`${u} cannot call generate_display_id()`, !!(await tryErr(`select public.generate_display_id('STUDENT')`)));
    check(`${u} cannot call invoice_paid_total()`, !!(await tryErr(`select public.invoice_paid_total('${inv1}')`)));
  });
}
check("anon cannot read invoices", !!(await as("anon", () => tryErr(`select * from invoices`))));

// ---- Phase 7: notices, events, gallery, storage -----------------------------
const noticeSql = (title: string, audience: string, opts: { section?: string; published?: boolean; isPublic?: boolean; publishedAt?: string; expiresAt?: string } = {}) =>
  `insert into notices(title,body,audience,section_id,is_published,is_public,published_at,expires_at) values ('${title}','body','${audience}',${opts.section ? `'${opts.section}'` : "null"},${opts.published ?? true},${opts.isPublic ?? false},${opts.publishedAt ?? "null"},${opts.expiresAt ?? "null"})`;
await as("organizer", async () => {
  check("notice: All", !(await tryErr(noticeSql("All", "ALL"))));
  check("notice: Students", !(await tryErr(noticeSql("Students", "STUDENTS"))));
  check("notice: Parents", !(await tryErr(noticeSql("Parents", "PARENTS"))));
  check("notice: Teachers", !(await tryErr(noticeSql("Teachers", "TEACHERS"))));
  check("notice: Draft", !(await tryErr(noticeSql("Draft", "ALL", { published: false }))));
  check("notice: Expired", !(await tryErr(noticeSql("Expired", "ALL", { publishedAt: "now() - interval '2 hours'", expiresAt: "now() - interval '1 hour'" }))));
  check("notice: Scheduled (future)", !(await tryErr(noticeSql("Scheduled", "ALL", { publishedAt: "now() + interval '1 day'" }))));
  check("notice: SectionA", !(await tryErr(noticeSql("SectionA", "ALL", { section: secA.id }))));
  check("notice: Public", !(await tryErr(noticeSql("Public", "ALL", { isPublic: true }))));
  check("a public notice must be for everyone", !!(await tryErr(noticeSql("Bad1", "STUDENTS", { isPublic: true }))));
  check("a public notice cannot target a section", !!(await tryErr(noticeSql("Bad2", "ALL", { section: secA.id, isPublic: true }))));
  check("publishing stamps published_at", (await db.query<{ ok: boolean }>(`select published_at is not null as ok from notices where title='All'`)).rows[0].ok);
});
const titles = async () => (await db.query<{ title: string }>(`select title from notices order by title`)).rows.map((r) => r.title).join(",");
await as("student1", async () => check("student in 5-A sees the right notices", (await titles()) === "All,Public,SectionA,Students", await titles()));
await as("student2", async () => check("student in 5-B does not see 5-A's notice", (await titles()) === "All,Public,Students", await titles()));
await as("parent1", async () => check("guardian sees parent + section notices", (await titles()) === "All,Parents,Public,SectionA", await titles()));
await as("parent2", async () => check("other guardian does not see 5-A's notice", (await titles()) === "All,Parents,Public", await titles()));
await as("teacher", async () => check("teacher of 5-A sees teacher + section notices", (await titles()) === "All,Public,SectionA,Teachers", await titles()));
await as("teacher2", async () => check("unassigned teacher does not see 5-A's notice", (await titles()) === "All,Public,Teachers", await titles()));
await as("organizer", async () => check("staff see everything incl. drafts, expired and scheduled", (await count(`select 1 from notices`)) === 9));
await as("anon", async () => check("anonymous visitors see ONLY the public, published, current notice", (await titles()) === "Public", await titles()));
for (const u of ["student1", "parent1", "teacher", "anon"]) {
  await as(u, async () => {
    check(`${u} cannot write notices`, !!(await tryErr(noticeSql("Hack", "ALL"))));
    check(`${u} cannot edit notices`, (await db.query(`update notices set title='x' returning 1`).catch(() => ({ rows: [] }))).rows.length === 0);
  });
}

await as("organizer", async () => {
  check("event: public sports day", !(await tryErr(`insert into events(title,starts_at,is_published,is_public) values ('Sports Day', now() + interval '10 days', true, true)`)));
  check("event: teachers-only meeting", !(await tryErr(`insert into events(title,starts_at,audience,is_published) values ('Staff meeting', now() + interval '3 days', 'TEACHERS', true)`)));
  check("event: draft", !(await tryErr(`insert into events(title,starts_at) values ('Draft event', now() + interval '5 days')`)));
  check("a public event must be for everyone", !!(await tryErr(`insert into events(title,starts_at,audience,is_published,is_public) values ('Bad', now(), 'TEACHERS', true, true)`)));
  check("event end cannot precede start", !!(await tryErr(`insert into events(title,starts_at,ends_at) values ('Bad', now(), now() - interval '1 hour')`)));
});
await as("student1", async () => check("student sees only the published ALL event", (await count(`select 1 from events`)) === 1));
await as("teacher", async () => check("teacher also sees the teachers-only event", (await count(`select 1 from events`)) === 2));
await as("anon", async () => check("anonymous visitors see only the public event", (await count(`select 1 from events`)) === 1));
await as("organizer", async () => check("staff see all events", (await count(`select 1 from events`)) === 3));

const albumPub = await one(`insert into gallery_albums(title,is_published) values ('Annual Day', true) returning id`);
const albumDraft = await one(`insert into gallery_albums(title,is_published) values ('Unreleased', false) returning id`);
const photoSql = (albumId: string, path?: string) =>
  `insert into gallery_photos(album_id,storage_path) values ('${albumId}', ${path ? `'${path}'` : `'albums/${albumId}/' || gen_random_uuid() || '.jpg'`})`;
await as("organizer", async () => {
  check("staff add a photo to a published album", !(await tryErr(photoSql(albumPub.id))));
  check("staff add a photo to a draft album", !(await tryErr(photoSql(albumDraft.id))));
  check("path traversal rejected", !!(await tryErr(photoSql(albumPub.id, "albums/../../etc/passwd"))));
  check("non-image extension rejected", !!(await tryErr(photoSql(albumPub.id, `albums/${albumPub.id}/${albumPub.id}.exe`))));
  check("path outside albums/ rejected", !!(await tryErr(photoSql(albumPub.id, `other/${albumPub.id}/${albumPub.id}.jpg`))));
});
for (const u of ["anon", "student1", "parent2"]) {
  await as(u, async () => check(`${u} sees only the published album and its photo`, (await count(`select 1 from gallery_albums`)) === 1 && (await count(`select 1 from gallery_photos`)) === 1));
}
await as("organizer", async () => check("staff see drafts too", (await count(`select 1 from gallery_albums`)) === 2 && (await count(`select 1 from gallery_photos`)) === 2));
for (const u of ["anon", "student1", "teacher"]) {
  await as(u, async () => check(`${u} cannot write gallery rows`, !!(await tryErr(`insert into gallery_albums(title) values ('x')`)) && !!(await tryErr(photoSql(albumPub.id)))));
}

check("gallery bucket: public, 5 MB, images only", (await count(`select 1 from storage.buckets where id='gallery-public' and public and file_size_limit=5242880 and allowed_mime_types = array['image/jpeg','image/png','image/webp']`)) === 1);
check("documents bucket is PRIVATE", (await count(`select 1 from storage.buckets where id='student-documents' and not public`)) === 1);
const objectSql = (bucket: string, name: string) => `insert into storage.objects(bucket_id,name) values ('${bucket}','${name}')`;
const galleryName = `albums/${albumPub.id}/${albumPub.id}.png`;
await as("organizer", async () => {
  check("staff upload a gallery image", !(await tryErr(objectSql("gallery-public", galleryName))));
  check("gallery rejects odd names", !!(await tryErr(objectSql("gallery-public", "albums/../x.jpg"))) && !!(await tryErr(objectSql("gallery-public", `albums/${albumPub.id}/${albumPub.id}.gif`))));
  check("staff upload a student document", !(await tryErr(objectSql("student-documents", `${s1.id}/birth-certificate.pdf`))));
  check("documents must live in a student's folder", !!(await tryErr(objectSql("student-documents", "loose/file.pdf"))));
});
for (const u of ["student1", "parent1", "teacher", "anon"]) {
  await as(u, async () => {
    check(`${u} cannot upload to the gallery`, !!(await tryErr(objectSql("gallery-public", `albums/${albumPub.id}/${albumDraft.id}.jpg`))));
    check(`${u} cannot upload documents`, !!(await tryErr(objectSql("student-documents", `${s1.id}/x.pdf`))));
  });
}
await as("student1", async () => check("student reads their OWN documents", (await count(`select 1 from storage.objects where bucket_id='student-documents'`)) === 1));
await as("parent1", async () => check("guardian reads their child's documents", (await count(`select 1 from storage.objects where bucket_id='student-documents'`)) === 1));
for (const u of ["student2", "parent2", "teacher", "teacher2", "anon"]) {
  await as(u, async () => check(`${u} cannot see another student's documents`, (await count(`select 1 from storage.objects where bucket_id='student-documents'`)) === 0));
}
await as("student1", async () => check("student cannot delete documents", (await db.query(`delete from storage.objects where bucket_id='student-documents' returning 1`)).rows.length === 0));
await as("organizer", async () => check("staff can delete documents", (await db.query(`delete from storage.objects where bucket_id='student-documents' returning 1`)).rows.length === 1));

// ---- Phase 8: admissions + site content ------------------------------------
// Literal dates, exactly as the real form posts them: an anonymous caller may not call school_today() itself.
const dobOf = async (expr: string) => `'${(await db.query<{ d: string }>(`select to_char(${expr}, 'YYYY-MM-DD') as d`)).rows[0].d}'`;
const dob8 = await dobOf("(public.school_today() - interval '8 years')");
const dob40 = await dobOf("(public.school_today() - interval '40 years')");
const dobTomorrow = await dobOf("(public.school_today() + 1)");
const applySql = (over: Record<string, string> = {}, returning = "") => {
  const f: Record<string, string> = {
    applicant_name: "'Little Applicant'",
    date_of_birth: dob8,
    desired_class: "'Class 3'",
    guardian_name: "'Proud Guardian'",
    guardian_phone: "'+880 1700-000000'",
    ...over,
  };
  return `insert into admission_applications(${Object.keys(f).join(",")}) values (${Object.values(f).join(",")}) ${returning}`;
};

await as("anon", async () => {
  check("a visitor can submit an application", !(await tryErr(applySql())));
  check("a visitor cannot choose the status", !!(await tryErr(applySql({ status: "'ACCEPTED'" }))));
  check("a visitor cannot set reviewer fields", !!(await tryErr(applySql({ reviewed_by: `'${uid.admin}'` }))) && !!(await tryErr(applySql({ review_notes: "'approved'" }))));
  check("a visitor cannot read back what they submitted", !!(await tryErr(applySql({}, "returning id"))));
  check("a visitor cannot read applications", !!(await tryErr(`select * from admission_applications`)));
  check("a visitor cannot update or delete", !!(await tryErr(`update admission_applications set status='ACCEPTED'`)) && !!(await tryErr(`delete from admission_applications`)));
  check("bad phone rejected", !!(await tryErr(applySql({ guardian_phone: "'call me maybe'" }))));
  check("bad email rejected", !!(await tryErr(applySql({ guardian_email: "'not-an-email'" }))));
  check("a good email is accepted", !(await tryErr(applySql({ guardian_email: "'parent@example.com'" }))));
  check("oversized message rejected", !!(await tryErr(applySql({ message: "repeat('x', 2001)" }))));
  check("future birth date rejected", !!(await tryErr(applySql({ date_of_birth: dobTomorrow }))));
  check("implausible birth date rejected", !!(await tryErr(applySql({ date_of_birth: dob40 }))));
  check("blank name rejected", !!(await tryErr(applySql({ applicant_name: "' '" }))));
});
await as("student1", async () => {
  check("a signed-in family can also apply", !(await tryErr(applySql({ applicant_name: "'Sibling'" }))));
  check("but cannot read applications", (await count(`select 1 from admission_applications`)) === 0);
  check("or change them", (await db.query(`update admission_applications set status='ACCEPTED' returning 1`)).rows.length === 0);
  check("or forge a status on submit", !!(await tryErr(applySql({ applicant_name: "'Sneaky'", status: "'ACCEPTED'" }))));
});
await as("teacher", async () => check("a teacher cannot read applications", (await count(`select 1 from admission_applications`)) === 0));
await as("organizer", async () => {
  check("staff read all applications", (await count(`select 1 from admission_applications`)) === 3);
  check("staff move an application along", !(await tryErr(`update admission_applications set status='UNDER_REVIEW', review_notes='called parent' where applicant_name='Sibling'`)));
  check("reviewer + time are stamped from the session", (await count(`select 1 from admission_applications where applicant_name='Sibling' and reviewed_by='${uid.organizer}' and reviewed_at is not null`)) === 1);
  check("a forged reviewer is overwritten", !(await tryErr(`update admission_applications set status='ACCEPTED', reviewed_by='${uid.admin}' where applicant_name='Sibling'`))
    && (await count(`select 1 from admission_applications where applicant_name='Sibling' and reviewed_by='${uid.organizer}'`)) === 1);
  check("applications cannot be deleted, even by staff", !!(await tryErr(`delete from admission_applications`)));
});

check("starter site content is installed", (await count(`select 1 from site_content`)) === 4);
await as("anon", async () => {
  check("visitors can read site content", (await count(`select 1 from site_content`)) === 4);
  check("visitors cannot edit site content", !!(await tryErr(`insert into site_content(key) values ('hack')`)) && (await db.query(`update site_content set body_en='defaced' returning 1`).catch(() => ({ rows: [] }))).rows.length === 0);
});
await as("teacher", async () => check("a teacher cannot edit site content", (await db.query(`update site_content set body_en='x' returning 1`)).rows.length === 0));
await as("organizer", async () => {
  check("staff edit a block", !(await tryErr(`update site_content set body_en='New welcome text' where key='home_hero'`)));
  check("updated_by is stamped from the session", (await count(`select 1 from site_content where key='home_hero' and updated_by='${uid.organizer}'`)) === 1);
  check("staff add a block", !(await tryErr(`insert into site_content(key,title_en) values ('principal_message','Principal')`)));
  check("a malformed key is rejected", !!(await tryErr(`insert into site_content(key) values ('Bad Key!')`)));
  check("site content cannot be deleted", !!(await tryErr(`delete from site_content`)));
});

check("cannot link student record to TEACHER profile", !!(await tryErr(`insert into students(profile_id,admission_number,full_name) values ('${uid.teacher2}','Z-1','Z')`)));
check("cannot link guardian record to STUDENT profile", !!(await tryErr(`insert into guardians(profile_id,full_name) values ('${uid.student1}','Z')`)));
check("unlinked student record allowed", !(await tryErr(`insert into students(admission_number,full_name) values ('U-1','Unlinked')`)));
check("second ACTIVE enrollment same year rejected", !!(await tryErr(`insert into student_enrollments(student_id,academic_year_id,class_id,section_id) values ('${s1.id}','${yr.id}','${cls.id}','${secB.id}')`)));
check("section from another class rejected", !!(await tryErr(`insert into student_enrollments(student_id,academic_year_id,class_id,section_id,status) values ('${s1.id}','${yr.id}','${cls.id}','${sec6.id}','COMPLETED')`)));
check("duplicate roll number in same section rejected", !!(await tryErr(`insert into student_enrollments(student_id,academic_year_id,class_id,section_id,roll_number) values ((select id from students where admission_number='U-1'),'${yr.id}','${cls.id}','${secA.id}','1')`)));
check("second primary guardian rejected", !!(await tryErr(`insert into student_guardians(student_id,guardian_id,relationship,is_primary) values ('${s1.id}','${g2.id}','MOTHER',true)`)));
check("second class teacher rejected", !!(await tryErr(`insert into teacher_assignments(teacher_id,academic_year_id,class_id,section_id,subject_id,is_class_teacher) values ((select id from teachers where full_name='Teacher Two'),'${yr.id}','${cls.id}','${secA.id}','${sub.id}',true)`)));
check("two current academic years rejected", !!(await tryErr(`insert into academic_years(name,start_date,end_date,is_current) values ('dup','2027-01-01','2027-12-31',true)`)));
check("history kept: completing old enrollment then enrolling again works", !(await tryErr(`
  update student_enrollments set status='COMPLETED', end_date=current_date where student_id='${s1.id}';
  insert into student_enrollments(student_id,academic_year_id,class_id,section_id,roll_number) values ('${s1.id}','${yr.id}','${cls.id}','${secB.id}','9');`)));
check("history rows preserved (2 enrollments for student1)", (await db.query(`select 1 from student_enrollments where student_id=$1`, [s1.id])).rows.length === 2);
await as("student1", async () => {
  check("student cannot self-promote", !!(await tryErr(`update profiles set role='TEACHER' where id='${uid.student1}'`)));
  check("student sees only own profile", (await db.query(`select 1 from profiles`)).rows.length === 1);
});
await as("organizer", async () => {
  check("organizer cannot grant SUPER_ADMIN", !!(await tryErr(`update profiles set role='SUPER_ADMIN' where id='${uid.student2}'`)));
  check("organizer can suspend", !(await tryErr(`update profiles set status='SUSPENDED' where id='${uid.student2}'`)));
});
// ---- Project-wide invariants (inspect the catalog, so a future phase can't quietly regress them) ----
const catalog = async (sql: string) => (await db.query<{ n: string }>(sql)).rows.map((r) => r.n).sort();

check("EVERY public table has row level security enabled",
  JSON.stringify(await catalog(`select c.relname as n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relkind='r' and not c.relrowsecurity`)) === "[]",
  JSON.stringify(await catalog(`select c.relname as n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relkind='r' and not c.relrowsecurity`)));

const anonTables = await catalog(`select table_name || ':' || privilege_type as n from information_schema.role_table_grants where grantee='anon' and table_schema='public'`);
check("anon holds table privileges ONLY for the intended public reads",
  JSON.stringify(anonTables) === JSON.stringify(["events:SELECT", "gallery_albums:SELECT", "gallery_photos:SELECT", "notices:SELECT", "site_content:SELECT"]), JSON.stringify(anonTables));

const anonInsertCols = await catalog(`select table_name || '.' || column_name as n from information_schema.column_privileges where grantee='anon' and table_schema='public' and privilege_type='INSERT'`);
check("anon may INSERT only the admission form's own columns", anonInsertCols.length === 11 && anonInsertCols.every((c) => c.startsWith("admission_applications."))
  && !anonInsertCols.some((c) => /status|review|reviewed/.test(c)), JSON.stringify(anonInsertCols));

check("anon can UPDATE and DELETE nothing in public", (await count(`select 1 from information_schema.role_table_grants where grantee='anon' and table_schema='public' and privilege_type in ('UPDATE','DELETE','INSERT','TRUNCATE')`)) === 0);

const anonFns = await catalog(`select p.proname as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and has_function_privilege('anon', p.oid, 'EXECUTE')`);
check("the ONLY public function anon may call is album_is_published", JSON.stringify(anonFns) === JSON.stringify(["album_is_published"]), JSON.stringify(anonFns));

for (const fn of ["next_receipt_no()", "invoice_paid_total(uuid, uuid)", "generate_display_id(public.user_role)"]) {
  check(`signed-in users cannot call ${fn}`, (await db.query<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') as ok`)).rows[0].ok === false);
}

for (const table of ["payments", "invoices", "admission_applications", "site_content"]) {
  check(`nobody (signed-in included) may DELETE from ${table}`, (await db.query<{ ok: boolean }>(`select has_table_privilege('authenticated', 'public.${table}', 'DELETE') as ok`)).rows[0].ok === false);
}
check("signed-in users cannot DELETE profiles", (await db.query<{ ok: boolean }>(`select has_table_privilege('authenticated', 'public.profiles', 'DELETE') as ok`)).rows[0].ok === false);

return { pass, failures };
}

describe("migrations + RLS (embedded Postgres)", () => {
  it("applies idempotently and enforces isolation", async () => {
    const { pass, failures } = await run();
    expect(failures).toEqual([]);
    expect(pass).toBeGreaterThan(335);
  }, 120_000);
});
