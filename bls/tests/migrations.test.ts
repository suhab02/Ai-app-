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
return { pass, failures };
}

describe("migrations + RLS (embedded Postgres)", () => {
  it("applies idempotently and enforces isolation", async () => {
    const { pass, failures } = await run();
    expect(failures).toEqual([]);
    expect(pass).toBeGreaterThan(125);
  }, 120_000);
});
