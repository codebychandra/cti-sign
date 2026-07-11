// GET /signing-session?token=... — public. Validates the token and returns the
// document + field map + a short-lived signed URL for the template PDF.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const token = new URL(req.url).searchParams.get('token')
    if (!token) return json({ error: 'Missing token' }, 400)

    const { data: record } = await admin
      .from('records')
      .select('id, form_id, signer_name, signer_email, message, status')
      .eq('token', token)
      .single()
    if (!record) return json({ error: 'Invalid or expired signing link' }, 404)

    const { data: form } = await admin
      .from('forms')
      .select('id, name, page_count, template_path')
      .eq('id', record.form_id)
      .single()
    if (!form?.template_path) return json({ error: 'Document not ready' }, 409)

    const { data: fields } = await admin
      .from('form_fields')
      .select('*')
      .eq('form_id', form.id)
      .order('sort_order')

    const { data: signed } = await admin.storage
      .from('templates')
      .createSignedUrl(form.template_path, 60 * 30) // 30 min

    // mark viewed (first open only)
    if (record.status === 'sent') {
      await admin
        .from('records')
        .update({ status: 'viewed', viewed_at: new Date().toISOString() })
        .eq('id', record.id)
    }

    return json({
      record: {
        signer_name: record.signer_name,
        signer_email: record.signer_email,
        message: record.message,
        status: record.status,
      },
      form: { name: form.name, page_count: form.page_count },
      fields: fields ?? [],
      templateUrl: signed?.signedUrl,
    })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
