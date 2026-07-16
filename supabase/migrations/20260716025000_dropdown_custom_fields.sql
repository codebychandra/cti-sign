do $$ begin
  alter type custom_field_type add value if not exists 'single_dropdown';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type custom_field_type add value if not exists 'multi_dropdown';
exception when duplicate_object then null; end $$;

alter table project_custom_fields
  add column if not exists options jsonb not null default '[]'::jsonb;

update project_custom_fields
set options = '[]'::jsonb
where options is null;
