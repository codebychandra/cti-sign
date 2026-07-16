do $$ begin
  create type project_type as enum ('sent_signature', 'auto_populate');
exception when duplicate_object then null; end $$;

do $$ begin
  alter type record_status add value if not exists 'submitted';
exception when duplicate_object then null; end $$;

alter table projects
  add column if not exists project_type project_type not null default 'sent_signature';

alter table records
  add column if not exists submitted_at timestamptz;

alter table form_fields
  add column if not exists custom_field_id uuid references project_custom_fields(id) on delete set null;

create index if not exists idx_fields_custom_field on form_fields(custom_field_id);
