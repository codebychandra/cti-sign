do $$ begin
  alter type field_type add value if not exists 'signed_date';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type field_type add value if not exists 'number';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type custom_field_type add value if not exists 'auto_number';
exception when duplicate_object then null; end $$;

alter table project_custom_fields
  add column if not exists auto_prefix text,
  add column if not exists auto_start integer not null default 1;

update project_custom_fields
set auto_start = 1
where auto_start is null;
