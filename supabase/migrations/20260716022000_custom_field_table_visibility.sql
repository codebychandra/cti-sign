alter table project_custom_fields
  add column if not exists show_in_table boolean not null default true;

update project_custom_fields
set show_in_table = true
where show_in_table is null;
