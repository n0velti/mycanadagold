-- Accounting: payment cancel workflow + staff timeline (dev/prod same schema).

create table if not exists public.accounting_payment_cancellations (
  payment_key text primary key,
  system_key text not null,
  source_id bigint not null,
  store_name text,
  payment_date date,
  step text not null default 'cancel_requested',
  note text not null default '',
  timeline jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create index if not exists accounting_payment_cancellations_payment_date_idx
  on public.accounting_payment_cancellations (payment_date desc);

alter table public.accounting_payment_cancellations enable row level security;
alter table public.accounting_payment_cancellations force row level security;

revoke all on public.accounting_payment_cancellations from public, anon;
grant select, insert, update on table public.accounting_payment_cancellations
  to authenticated, service_role;

drop policy if exists accounting_payment_cancellations_select on public.accounting_payment_cancellations;
drop policy if exists accounting_payment_cancellations_insert on public.accounting_payment_cancellations;
drop policy if exists accounting_payment_cancellations_update on public.accounting_payment_cancellations;

create policy accounting_payment_cancellations_select
  on public.accounting_payment_cancellations
  for select
  to authenticated
  using ((select public.is_active_staff()));

create policy accounting_payment_cancellations_insert
  on public.accounting_payment_cancellations
  for insert
  to authenticated
  with check ((select public.is_active_staff()));

create policy accounting_payment_cancellations_update
  on public.accounting_payment_cancellations
  for update
  to authenticated
  using ((select public.is_active_staff()))
  with check ((select public.is_active_staff()));

notify pgrst, 'reload schema';
