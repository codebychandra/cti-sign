-- ============================================================================
-- CTI Sign — signer flow WITHOUT Edge Functions (no CLI needed).
-- Run this in Supabase → SQL Editor after schema.sql.
--
-- It replaces the signing-session / submit-signature Edge Functions with two
-- SECURITY DEFINER database functions the signer's browser can call directly
-- with the public key. They are gated by the unguessable per-record token, so
-- anonymous signers can only ever touch the one record their link points to.
-- ============================================================================

-- Store the finished PDF right in the row (base64). Keeps everything in the DB,
-- so no storage upload permissions are needed for anonymous signers.
alter table records add column if not exists signed_pdf_data text;

-- The signer's browser fetches the blank template directly, so the templates
-- bucket must be world-readable. (Signed PDFs stay private in the DB row above.)
update storage.buckets set public = true where id = 'templates';

-- ---------------------------------------------------------------------------
-- Return everything the signing page needs, and mark the record "viewed".
-- ---------------------------------------------------------------------------
create or replace function public.get_signing_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r records%rowtype;
  f forms%rowtype;
  flds jsonb;
begin
  select * into r from records where token = p_token;
  if not found then
    return jsonb_build_object('error', 'Invalid or expired signing link');
  end if;

  select * into f from forms where id = r.form_id;
  if f.template_path is null then
    return jsonb_build_object('error', 'Document is not ready yet');
  end if;

  select coalesce(jsonb_agg(to_jsonb(ff) order by ff.sort_order), '[]'::jsonb)
    into flds
    from form_fields ff
    where ff.form_id = f.id;

  if r.status = 'sent' then
    update records set status = 'viewed', viewed_at = now() where id = r.id;
  end if;

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
    'fields', flds
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Store the signer's values + finished PDF and complete the record.
-- ---------------------------------------------------------------------------
create or replace function public.submit_signature(p_token text, p_values jsonb, p_pdf text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r records%rowtype;
  v jsonb;
begin
  select * into r from records where token = p_token;
  if not found then
    return jsonb_build_object('error', 'Invalid signing link');
  end if;
  if r.status = 'completed' then
    return jsonb_build_object('error', 'This document has already been signed');
  end if;

  if p_values is not null then
    for v in select * from jsonb_array_elements(p_values) loop
      insert into record_values (record_id, field_id, value)
      values (r.id, (v->>'field_id')::uuid, v->>'value')
      on conflict (record_id, field_id) do update set value = excluded.value;
    end loop;
  end if;

  update records
    set status = 'completed',
        completed_at = now(),
        signed_pdf_data = p_pdf
    where id = r.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Let anonymous signers (and staff) call just these two functions.
grant execute on function public.get_signing_session(text) to anon, authenticated;
grant execute on function public.submit_signature(text, jsonb, text) to anon, authenticated;
