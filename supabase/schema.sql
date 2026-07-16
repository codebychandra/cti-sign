-- ============================================================================
-- CTI Sign — database schema
-- Run this in Supabase → SQL Editor (or via `supabase db push`).
-- ----------------------------------------------------------------------------
-- Model:
--   projects ──< forms ──< form_fields          (a form = a template PDF + field map)
--        └────< project_custom_fields ──< record_custom_values
--                  └────< records ──< record_values   (a record = one signing instance)
-- ============================================================================

create extension if not exists "pgcrypto";

do $$ begin
  create type record_status as enum ('draft', 'sent', 'viewed', 'submitted', 'completed', 'declined');
exception when duplicate_object then null; end $$;

do $$ begin
  alter type record_status add value if not exists 'submitted';
exception when duplicate_object then null; end $$;

do $$ begin
  create type field_type as enum ('signature', 'initials', 'text', 'date', 'signed_date', 'number', 'email');
exception when duplicate_object then null; end $$;

do $$ begin
  alter type field_type add value if not exists 'signed_date';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type field_type add value if not exists 'number';
exception when duplicate_object then null; end $$;

do $$ begin
  create type custom_field_type as enum ('text', 'date', 'number', 'email', 'auto_number');
exception when duplicate_object then null; end $$;

do $$ begin
  alter type custom_field_type add value if not exists 'auto_number';
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_type as enum ('sent_signature', 'auto_populate');
exception when duplicate_object then null; end $$;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  project_type project_type not null default 'sent_signature',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists forms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  template_path text,
  page_count int default 1,
  created_at timestamptz not null default now()
);

create table if not exists project_custom_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null,
  type custom_field_type not null default 'text',
  required boolean not null default false,
  show_in_table boolean not null default true,
  auto_prefix text,
  auto_start integer not null default 1,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id) on delete cascade,
  type field_type not null default 'signature',
  label text default '',
  custom_field_id uuid references project_custom_fields(id) on delete set null,
  page int not null default 0,
  x double precision not null,
  y double precision not null,
  width double precision not null,
  height double precision not null,
  text_align text not null default 'left',
  font_size int not null default 11,
  required boolean not null default true,
  sort_order int not null default 0
);

create table if not exists records (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  signer_name text not null,
  signer_email text not null,
  status record_status not null default 'draft',
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  signed_pdf_path text,
  signed_pdf_data text,
  onedrive_url text,
  message text default '',
  sent_at timestamptz,
  viewed_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists record_values (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references records(id) on delete cascade,
  field_id uuid not null references form_fields(id) on delete cascade,
  value text,
  created_at timestamptz not null default now(),
  unique (record_id, field_id)
);

create table if not exists record_custom_values (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references records(id) on delete cascade,
  field_id uuid not null references project_custom_fields(id) on delete cascade,
  value text,
  created_at timestamptz not null default now(),
  unique (record_id, field_id)
);

create index if not exists idx_forms_project on forms(project_id);
create index if not exists idx_fields_form on form_fields(form_id);
create index if not exists idx_fields_custom_field on form_fields(custom_field_id);
create index if not exists idx_project_custom_fields_project on project_custom_fields(project_id);
create index if not exists idx_records_form on records(form_id);
create index if not exists idx_records_project on records(project_id);
create index if not exists idx_records_token on records(token);
create index if not exists idx_values_record on record_values(record_id);
create index if not exists idx_record_custom_values_record on record_custom_values(record_id);

alter table projects enable row level security;
alter table forms enable row level security;
alter table form_fields enable row level security;
alter table project_custom_fields enable row level security;
alter table records enable row level security;
alter table record_values enable row level security;
alter table record_custom_values enable row level security;

do $$
declare t text;
begin
  foreach t in array array['projects','forms','form_fields','project_custom_fields','records','record_values','record_custom_values']
  loop
    execute format('drop policy if exists staff_all on %I', t);
    execute format('create policy staff_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

insert into storage.buckets (id, name, public) values ('templates', 'templates', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('signed', 'signed', false) on conflict (id) do nothing;

drop policy if exists staff_read_templates on storage.objects;
create policy staff_read_templates on storage.objects for select to authenticated using (bucket_id in ('templates','signed'));
drop policy if exists staff_write_templates on storage.objects;
create policy staff_write_templates on storage.objects for insert to authenticated with check (bucket_id in ('templates','signed'));
drop policy if exists staff_update_templates on storage.objects;
create policy staff_update_templates on storage.objects for update to authenticated using (bucket_id in ('templates','signed'));
