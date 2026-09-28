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
    expect(pass).toBeGreaterThan(50);
  }, 120_000);
});
