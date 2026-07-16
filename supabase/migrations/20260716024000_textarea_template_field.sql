do $$ begin
  alter type field_type add value if not exists 'textarea';
exception when duplicate_object then null; end $$;
