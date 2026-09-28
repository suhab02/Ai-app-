import { requireStaff } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { setUserRole, setUserStatus } from "@/lib/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import type { AccountStatus, UserRole } from "@/lib/supabase/types";

const STATUSES: AccountStatus[] = ["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"];
const ROLES: UserRole[] = ["SUPER_ADMIN", "ORGANIZER", "TEACHER", "STUDENT", "PARENT"];

const isStatus = (v: string | undefined): v is AccountStatus => !!v && (STATUSES as string[]).includes(v);
const isRole = (v: string | undefined): v is UserRole => !!v && (ROLES as string[]).includes(v);

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; role?: string }>;
}) {
  const actor = await requireStaff();
  const params = await searchParams;
  const d = getDictionary(await getLocale());
  const db = await createClient();

  let query = db.from("profiles").select("*").order("created_at", { ascending: false }).limit(200);
  if (isStatus(params.status)) query = query.eq("status", params.status);
  if (isRole(params.role)) query = query.eq("role", params.role);
  // Strip characters that have meaning in PostgREST's or() filter syntax.
  const q = params.q?.replace(/[^\p{L}\p{N}@._\- ]/gu, "").trim();
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,display_id.ilike.%${q}%`);

  const { data: users, error } = await query;
  if (error) throw new Error(error.message);

  // Only SUPER_ADMIN may hand out the admin-tier roles; the database enforces
  // this regardless, the UI just avoids offering choices that would fail.
  const assignable = actor.role === "SUPER_ADMIN" ? ROLES : ROLES.filter((r) => r !== "SUPER_ADMIN" && r !== "ORGANIZER");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-brand-navy">{d.admin.users.title}</h1>

      <Card>
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-4" method="get">
          <input
            name="q"
            defaultValue={params.q}
            placeholder={d.admin.users.searchPlaceholder}
            className="h-11 rounded-xl border border-slate-300 px-3.5 text-sm sm:col-span-2"
          />
          <Select name="status" defaultValue={params.status ?? ""}>
            <option value="">{d.admin.users.allStatuses}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{d.status[s]}</option>)}
          </Select>
          <Select name="role" defaultValue={params.role ?? ""}>
            <option value="">{d.admin.users.allRoles}</option>
            {ROLES.map((r) => <option key={r} value={r}>{d.roles[r]}</option>)}
          </Select>
          <button className="h-11 rounded-xl bg-brand-navy px-4 text-sm font-medium text-white sm:col-span-4 sm:w-40">
            {d.common.search}
          </button>
        </form>
      </Card>

      {!users?.length && <p className="text-sm text-slate-500">{d.admin.users.noUsers}</p>}

      <div className="flex flex-col gap-3">
        {users?.map((u) => (
          <Card key={u.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-brand-navy">{u.full_name ?? u.email}</p>
                <p className="text-xs text-slate-500">
                  {u.email} · <span className="font-mono">{u.display_id}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <Badge tone="navy">{d.roles[u.role]}</Badge>
                <Badge tone={u.status === "ACTIVE" ? "green" : u.status === "PENDING" ? "orange" : "red"}>
                  {d.status[u.status]}
                </Badge>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ActionForm action={setUserStatus} submitLabel={d.common.update} compact>
                <input type="hidden" name="profileId" value={u.id} />
                <div className="flex-1">
                  <Select name="status" defaultValue={u.status} aria-label={d.admin.users.allStatuses}>
                    {STATUSES.map((s) => <option key={s} value={s}>{d.status[s]}</option>)}
                  </Select>
                </div>
              </ActionForm>
              <ActionForm action={setUserRole} submitLabel={d.common.update} compact>
                <input type="hidden" name="profileId" value={u.id} />
                <div className="flex-1">
                  <Select name="role" defaultValue={u.role} aria-label={d.admin.users.allRoles}>
                    {(assignable.includes(u.role) ? assignable : [u.role, ...assignable]).map((r) => (
                      <option key={r} value={r}>{d.roles[r]}</option>
                    ))}
                  </Select>
                </div>
              </ActionForm>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
