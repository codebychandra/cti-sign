alter table records
  add column if not exists signed_pdf_data text;

create or replace function get_signing_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r records%rowtype;
  f forms%rowtype;
  fields_json jsonb;
  custom_values_json jsonb;
begin
  select * into r from records where token = p_token;
  if not found then
    return jsonb_build_object('error', 'Invalid or expired signing link');
  end if;

  select * into f from forms where id = r.form_id;
  if not found or f.template_path is null then
    return jsonb_build_object('error', 'Document not ready');
  end if;

  if r.status = 'sent' then
    update records
    set status = 'viewed', viewed_at = coalesce(viewed_at, now())
    where id = r.id;
    r.status = 'viewed';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ff) order by ff.sort_order), '[]'::jsonb)
    into fields_json
  from form_fields ff
  where ff.form_id = f.id;

  select coalesce(jsonb_object_agg(rcv.field_id, rcv.value), '{}'::jsonb)
    into custom_values_json
  from record_custom_values rcv
  where rcv.record_id = r.id;

  return jsonb_build_object(
    'record', jsonb_build_object(
      'signer_name', r.signer_name,
      'signer_email', r.signer_email,
      'message', r.message,
      'status', r.status
    ),
    'form', jsonb_build_object(
      'name', f.name,
      'page_count', f.page_count,
      'template_path', f.template_path
    ),
    'fields', fields_json,
    'custom_values', custom_values_json
  );
end;
$$;

create or replace function submit_signature(p_token text, p_values jsonb, p_pdf text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r records%rowtype;
  item jsonb;
begin
  select * into r from records where token = p_token;
  if not found then
    return jsonb_build_object('error', 'Invalid signing link');
  end if;

  if r.status = 'completed' then
    return jsonb_build_object('error', 'Already completed');
  end if;

  if jsonb_typeof(p_values) = 'array' then
    for item in select * from jsonb_array_elements(p_values)
    loop
      insert into record_values (record_id, field_id, value)
      values (r.id, (item->>'field_id')::uuid, item->>'value')
      on conflict (record_id, field_id) do update set value = excluded.value;
    end loop;
  end if;

  update records
  set status = 'submitted',
      submitted_at = now(),
      signed_pdf_data = p_pdf
  where id = r.id;

  return jsonb_build_object('ok', true);
end;
$$;
