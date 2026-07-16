-- ============================================================================
-- CTI Sign — database schema
-- Run this in Supabase → SQL Editor (or via `supabase db push`).
-- ----------------------------------------------------------------------------
-- Model:
--   projects ──< forms ──< form_fields          (a form = a template PDF + field map)
--        └────< project_custom_fields ──< record_custom_values
--                  └────< records ──< record_values   (a record = one signing instance)
--
-- Access model:
--   * CTI staff authenticate via Supabase Auth and manage everything (RLS below).
--   * Signers are anonymous. They NEVER touch these tables directly — the app's
--     Edge Functions (signing-session / submit-signature) run with the service
--     role and are gated by a per-record unguessable token.
-- ============================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists "pgcrypto";

-- Enums ---------------------------------------------------------------------
do $$ begin
  create type record_status as enum ('draft', 'sent', 'viewed', 'completed', 'declined');
exception when duplicate_object then null; end $$;

do $$ begin
  create type field_type as enum ('signature', 'initials', 'text', 'date', 'name', 'email');
exception when duplicate_object then null; end $$;

do $$ begin
  create type custom_field_type as enum ('text', 'date', 'number', 'email');
exception when duplicate_object then null; end $$;

-- Tables --------------------------------------------------------------------
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text default '',
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists forms (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  name          text not null,
  -- path within the private `templates` storage bucket
  template_path text,
  page_count    int default 1,
  created_at    timestamptz not null default now()
);

create table if not exists form_fields (
  id           uuid primary key default gen_random_uuid(),
  form_id      uuid not null references forms(id) on delete cascade,
  type         field_type not null default 'signature',
  label        text default '',
  page         int not null default 0,          -- 0-indexed
  -- normalized geometry (0..1) relative to the page, so it scales at any zoom
  x            double precision not null,
  y            double precision not null,
  width        double precision not null,
  height       double precision not null,
  required     boolean not null default true,
  sort_order   int not null default 0
);

create table if not exists project_custom_fields (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label      text not null,
  type       custom_field_type not null default 'text',
  required   boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists records (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references forms(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  signer_name     text not null,
  signer_email    text not null,
  status          record_status not null default 'draft',
  token           text not null unique default encode(gen_random_bytes(24), 'hex'),
  signed_pdf_path text,                          -- path within `signed` bucket
  onedrive_url    text,                           -- web link to the OneDrive/SharePoint copy
  message         text default '',               -- optional note shown to signer
  sent_at         timestamptz,
  viewed_at       timestamptz,
  completed_at    timestamptz,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create table if not exists record_values (
  id         uuid primary key default gen_random_uuid(),
  record_id  uuid not null references records(id) on delete cascade,
  field_id   uuid not null references form_fields(id) on delete cascade,
  value      text,                               -- text, ISO date, or data-url for signatures
  created_at timestamptz not null default now(),
  unique (record_id, field_id)
);

create table if not exists record_custom_values (
  id         uuid primary key default gen_random_uuid(),
  record_id  uuid not null references records(id) on delete cascade,
  field_id   uuid not null references project_custom_fields(id) on delete cascade,
  value      text,
  created_at timestamptz not null default now(),
  unique (record_id, field_id)
);

create index if not exists idx_forms_project on forms(project_id);
create index if not exists idx_fields_form on form_fields(form_id);
create index if not exists idx_project_custom_fields_project on project_custom_fields(project_id);
create index if not exists idx_records_form on records(form_id);
create index if not exists idx_records_project on records(project_id);
create index if not exists idx_records_token on records(token);
create index if not exists idx_values_record on record_values(record_id);
create index if not exists idx_record_custom_values_record on record_custom_values(record_id);

-- Row Level Security --------------------------------------------------------
alter table projects             enable row level security;
alter table forms                enable row level security;
alter table form_fields          enable row level security;
alter table project_custom_fields enable row level security;
alter table records              enable row level security;
alter table record_values        enable row level security;
alter table record_custom_values enable row level security;

-- Single-org model: any authenticated CTI staff member can manage all data.
-- (Tighten to per-owner later by swapping `true` for owner checks.)
do $$
declare t text;
begin
  foreach t in array array['projects','forms','form_fields','project_custom_fields','records','record_values','record_custom_values']
  loop
    execute format('drop policy if exists staff_all on %I', t);
    execute format(
      'create policy staff_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Anonymous users get NO direct table access. Signer flows go through the
-- Edge Functions using the service role.

-- Storage buckets -----------------------------------------------------------
-- Both private. Create via dashboard if this insert is blocked by policy.
insert into storage.buckets (id, name, public)
  values ('templates', 'templates', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('signed', 'signed', false)
  on conflict (id) do nothing;

-- Authenticated staff may read/write both buckets.
drop policy if exists staff_read_templates on storage.objects;
create policy staff_read_templates on storage.objects for select to authenticated
  using (bucket_id in ('templates','signed'));
drop policy if exists staff_write_templates on storage.objects;
create policy staff_write_templates on storage.objects for insert to authenticated
  with check (bucket_id in ('templates','signed'));
drop policy if exists staff_update_templates on storage.objects;
create policy staff_update_templates on storage.objects for update to authenticated
  using (bucket_id in ('templates','signed'));
