// POST /submit-signature — public, token-gated. Stores the completed PDF the
// signer's browser produced, records field values, and completes the record.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const { token, values, pdfBase64 } = await req.json()
    if (!token || !pdfBase64) return json({ error: 'Missing token or document' }, 400)

    const { data: record } = await admin
      .from('records')
      .select('id, form_id, signer_name, status')
      .eq('token', token)
      .single()
    if (!record) return json({ error: 'Invalid signing link' }, 404)
    if (record.status === 'completed') return json({ error: 'Already completed' }, 409)

    // decode + store the signed PDF
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))
    const path = `${record.id}/signed-${Date.now()}.pdf`
    const up = await admin.storage.from('signed').upload(path, bytes, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (up.error) return json({ error: 'Storage failed: ' + up.error.message }, 500)

    // persist captured values (best-effort)
    if (Array.isArray(values) && values.length) {
      const rows = values.map((v: { field_id: string; value: string }) => ({
        record_id: record.id,
        field_id: v.field_id,
        value: v.value,
      }))
      await admin.from('record_values').upsert(rows, { onConflict: 'record_id,field_id' })
    }

    await admin
      .from('records')
      .update({ status: 'completed', signed_pdf_path: path, completed_at: new Date().toISOString() })
      .eq('id', record.id)

    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
