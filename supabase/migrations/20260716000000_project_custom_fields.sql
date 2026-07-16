-- Adds per-project custom fields and per-record values for existing CTI Sign databases.

do $$ begin
  create type custom_field_type as enum ('text', 'date', 'number', 'email');
exception when duplicate_object then null; end $$;

create table if not exists project_custom_fields (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label      text not null,
  type       custom_field_type not null default 'text',
  required   boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists record_custom_values (
  id         uuid primary key default gen_random_uuid(),
  record_id  uuid not null references records(id) on delete cascade,
  field_id   uuid not null references project_custom_fields(id) on delete cascade,
  value      text,
  created_at timestamptz not null default now(),
  unique (record_id, field_id)
);

create index if not exists idx_project_custom_fields_project on project_custom_fields(project_id);
create index if not exists idx_record_custom_values_record on record_custom_values(record_id);

alter table project_custom_fields enable row level security;
alter table record_custom_values enable row level security;

drop policy if exists staff_all on project_custom_fields;
create policy staff_all on project_custom_fields for all to authenticated using (true) with check (true);

drop policy if exists staff_all on record_custom_values;
create policy staff_all on record_custom_values for all to authenticated using (true) with check (true);
