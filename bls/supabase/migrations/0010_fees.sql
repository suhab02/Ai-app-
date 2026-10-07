-- Bright Learning School — Phase 6: fees, payments, receipts
-- Depends on 0001–0009. Idempotent.
--
-- This is a LEDGER, so the database — not the app — enforces:
--   * money is numeric(12,2), never float
--   * a payment can never push an invoice past its amount (the invoice row is
--     locked FOR UPDATE, so two cashiers collecting at once cannot overpay)
--   * payments are never deleted (no DELETE policy or grant); mistakes are
--     corrected by moving a payment to REFUNDED, which keeps the history
--   * amount / invoice / student / receipt_no / collected_by cannot be edited
--   * receipt numbers and collected_by come from the server, never the client
-- Only PAID and PARTIAL payments count toward an invoice's balance.

do $$ begin
  create type public.payment_method as enum ('CASH', 'BANK', 'BKASH', 'NAGAD', 'ROCKET', 'CARD', 'ONLINE', 'OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIAL');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Fee types
-- ---------------------------------------------------------------------------
create table if not exists public.fee_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(btrim(code)) > 0),
  name text not null check (length(btrim(name)) > 0),
  name_bn text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Receipt numbers: BLS-RCPT-<year>-<6 digits>, one counter row per year.
-- The upsert takes the row lock, so concurrent payments get distinct numbers,
-- and the increment rolls back with the payment (no gaps from failed inserts).
-- ---------------------------------------------------------------------------
create table if not exists public.receipt_counters (
  year integer primary key,
  next_value integer not null default 1
);

create or replace function public.next_receipt_no()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from public.school_today());
  v_n integer;
begin
  insert into public.receipt_counters (year, next_value) values (v_year, 2)
  on conflict (year) do update set next_value = public.receipt_counters.next_value + 1
  returning next_value - 1 into v_n;

  return format('BLS-RCPT-%s-%s', v_year, lpad(v_n::text, 6, '0'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  fee_type_id uuid not null references public.fee_types (id) on delete restrict,
  description text,
  amount_due numeric(12, 2) not null check (amount_due > 0),
  due_date date not null,
  -- Wrongly raised invoices are voided, not deleted.
  voided_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoices_student_idx on public.invoices (student_id, due_date);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  guardian_id uuid references public.guardians (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method public.payment_method not null,
  reference text,
  status public.payment_status not null default 'PAID',
  collected_by uuid references public.profiles (id) on delete set null,
  notes text,
  receipt_no text not null unique default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_invoice_idx on public.payments (invoice_id);
create index if not exists payments_student_idx on public.payments (student_id, paid_at desc);

-- ---------------------------------------------------------------------------
-- Helper: what has actually been paid on an invoice (PAID + PARTIAL only).
-- ---------------------------------------------------------------------------
create or replace function public.invoice_paid_total(p_invoice_id uuid, p_except_payment uuid default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)
  from public.payments
  where invoice_id = p_invoice_id
    and status in ('PAID', 'PARTIAL')
    and id is distinct from p_except_payment;
$$;

-- ---------------------------------------------------------------------------
-- Invoice integrity
-- ---------------------------------------------------------------------------
create or replace function public.validate_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.voided_at := null;
    return new;
  end if;

  v_paid := public.invoice_paid_total(old.id);

  if new.student_id is distinct from old.student_id
     or new.academic_year_id is distinct from old.academic_year_id
     or new.fee_type_id is distinct from old.fee_type_id then
    if exists (select 1 from public.payments where invoice_id = old.id) then
      raise exception 'student, year and fee type cannot change once payments exist';
    end if;
  end if;

  if new.amount_due < v_paid then
    raise exception 'amount due (%) cannot be lower than what is already paid (%)', new.amount_due, v_paid;
  end if;

  if old.voided_at is not null and new.voided_at is null then
    raise exception 'a voided invoice cannot be reinstated';
  end if;
  if new.voided_at is not null and old.voided_at is null and v_paid > 0 then
    raise exception 'an invoice with payments cannot be voided; refund the payments first';
  end if;

  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists invoices_validate on public.invoices;
create trigger invoices_validate before insert or update on public.invoices
  for each row execute function public.validate_invoice();

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Payment integrity (the heart of the ledger)
-- ---------------------------------------------------------------------------
create or replace function public.validate_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invoices%rowtype;
  v_paid numeric;
begin
  -- Serialise every payment on this invoice: this lock is what makes the
  -- overpayment check safe under concurrency.
  select * into inv from public.invoices
  where id = (case when tg_op = 'INSERT' then new.invoice_id else old.invoice_id end)
  for update;

  if inv.id is null then
    raise exception 'invoice not found';
  end if;

  if tg_op = 'UPDATE' then
    if new.invoice_id is distinct from old.invoice_id
       or new.student_id is distinct from old.student_id
       or new.guardian_id is distinct from old.guardian_id
       or new.amount is distinct from old.amount
       or new.paid_at is distinct from old.paid_at
       or new.method is distinct from old.method
       or new.receipt_no is distinct from old.receipt_no
       or new.collected_by is distinct from old.collected_by then
      raise exception 'only status, reference and notes can be changed on a payment';
    end if;

    if new.status is distinct from old.status then
      if not (
        (old.status = 'PENDING' and new.status in ('PAID', 'PARTIAL', 'FAILED'))
        or (old.status in ('PAID', 'PARTIAL') and new.status = 'REFUNDED')
      ) then
        raise exception 'a % payment cannot become %', old.status, new.status;
      end if;
    end if;
  else
    if inv.voided_at is not null then
      raise exception 'cannot record a payment on a voided invoice';
    end if;

    new.student_id := inv.student_id;
    new.collected_by := coalesce(auth.uid(), new.collected_by);
    new.receipt_no := public.next_receipt_no();

    if new.paid_at > now() + interval '5 minutes' then
      raise exception 'paid_at cannot be in the future';
    end if;

    if new.guardian_id is not null and not exists (
      select 1 from public.student_guardians sg
      where sg.guardian_id = new.guardian_id and sg.student_id = new.student_id
    ) then
      raise exception 'that guardian is not linked to this student';
    end if;
  end if;

  -- Any row that will count toward the balance must fit within the invoice.
  if new.status in ('PAID', 'PARTIAL') then
    v_paid := public.invoice_paid_total(inv.id, case when tg_op = 'UPDATE' then new.id else null end);
    if v_paid + new.amount > inv.amount_due then
      raise exception 'payment of % would exceed the invoice (due %, already paid %)', new.amount, inv.amount_due, v_paid;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists payments_validate on public.payments;
create trigger payments_validate before insert or update on public.payments
  for each row execute function public.validate_payment();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Fee data is sensitive: staff, the student, and a linked guardian only.
-- ---------------------------------------------------------------------------
alter table public.fee_types enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.receipt_counters enable row level security;

drop policy if exists fee_types_select on public.fee_types;
create policy fee_types_select on public.fee_types for select to authenticated using (true);
drop policy if exists fee_types_staff_write on public.fee_types;
create policy fee_types_staff_write on public.fee_types
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (public.is_staff() or public.owns_student(student_id) or public.is_guardian_of_student(student_id));
drop policy if exists invoices_staff_insert on public.invoices;
create policy invoices_staff_insert on public.invoices for insert to authenticated with check (public.is_staff());
drop policy if exists invoices_staff_update on public.invoices;
create policy invoices_staff_update on public.invoices
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (public.is_staff() or public.owns_student(student_id) or public.is_guardian_of_student(student_id));
drop policy if exists payments_staff_insert on public.payments;
create policy payments_staff_insert on public.payments for insert to authenticated with check (public.is_staff());
drop policy if exists payments_staff_update on public.payments;
create policy payments_staff_update on public.payments
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- receipt_counters: no policies, no grants — only next_receipt_no() (definer) touches it.

-- Deliberately NO delete grant or policy on invoices or payments.
grant select, insert, update, delete on public.fee_types to authenticated;
grant select, insert, update on public.invoices, public.payments to authenticated;

-- ---------------------------------------------------------------------------
-- Internal functions must not be callable through the public API.
-- Postgres (and Supabase's default privileges) make new functions executable by
-- everyone, which would let any anonymous caller burn receipt numbers or probe
-- an invoice's paid total via /rest/v1/rpc/... Triggers run these as their owner
-- (SECURITY DEFINER), so revoking from API roles breaks nothing.
-- This also closes the same hole for Phase 1's generate_display_id().
-- ---------------------------------------------------------------------------
revoke execute on function public.next_receipt_no() from public, anon, authenticated;
revoke execute on function public.invoice_paid_total(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.generate_display_id(public.user_role) from public, anon, authenticated;
