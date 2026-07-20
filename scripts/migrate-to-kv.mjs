#!/usr/bin/env node
// One-time migration: export everything from Supabase and import it into the
// new Cloudflare KV structure the Worker expects. Safe to re-run — it always
// does a full export/import (not incremental), so re-running just overwrites
// the KV collections with a fresh snapshot from Supabase.
//
// Required environment variables:
//   SUPABASE_URL              e.g. https://xexdcrgbukoidyjbdqwm.supabase.co
//   SUPABASE_SERVICE_KEY      the service_role key (Project Settings -> API)
//   CLOUDFLARE_ACCOUNT_ID     Cloudflare dashboard -> Workers & Pages -> right sidebar
//   CLOUDFLARE_API_TOKEN      dash.cloudflare.com/profile/api-tokens ("Edit Cloudflare Workers")
//   KV_NAMESPACE_ID           the target KV namespace id (staging or production)
//
// Usage: node scripts/migrate-to-kv.mjs

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  KV_NAMESPACE_ID,
} = process.env

for (const [name, value] of Object.entries({
  SUPABASE_URL, SUPABASE_SERVICE_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KV_NAMESPACE_ID,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
}

async function supabaseSelect(table, columns = '*') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(columns)}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  })
  if (!res.ok) throw new Error(`Supabase select on ${table} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function supabaseDownload(bucket, path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  })
  if (!res.ok) throw new Error(`Supabase storage download ${bucket}/${path} failed: ${res.status}`)
  const buf = await res.arrayBuffer()
  return Buffer.from(buf).toString('base64')
}

async function kvPut(key, value) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: value,
  })
  if (!res.ok) throw new Error(`KV put ${key} failed: ${res.status} ${await res.text()}`)
}

function normalizeOptions(value) {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      return value.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean)
    }
  }
  return []
}

async function main() {
  console.log('Exporting from Supabase...')
  const [projects, formsRaw, formFields, customFields, recordsRaw, recordValues, recordCustomValues, connections] = await Promise.all([
    supabaseSelect('projects'),
    supabaseSelect('forms'),
    supabaseSelect('form_fields'),
    supabaseSelect('project_custom_fields'),
    supabaseSelect('records'),
    supabaseSelect('record_values'),
    supabaseSelect('record_custom_values'),
    supabaseSelect('onedrive_connections').catch(() => []), // table may not exist yet on older schemas
  ])

  console.log(`  projects: ${projects.length}, forms: ${formsRaw.length}, form_fields: ${formFields.length}`)
  console.log(`  project_custom_fields: ${customFields.length}, records: ${recordsRaw.length}`)
  console.log(`  record_values: ${recordValues.length}, record_custom_values: ${recordCustomValues.length}`)
  console.log(`  onedrive_connections: ${connections.length}`)

  // --- projects (drop owner_id/created_by — no individual accounts anymore) ---
  const outProjects = projects.map((p) => ({
    id: p.id, name: p.name, description: p.description ?? '', project_type: p.project_type ?? 'sent_signature', created_at: p.created_at,
  }))

  // --- forms, with form_fields nested + template PDF pulled from Storage -----
  console.log('Downloading template PDFs...')
  const outForms = []
  for (const f of formsRaw) {
    const fields = formFields
      .filter((ff) => ff.form_id === f.id)
      .map((ff) => ({
        id: ff.id, type: ff.type, label: ff.label, custom_field_id: ff.custom_field_id,
        page: ff.page, x: ff.x, y: ff.y, width: ff.width, height: ff.height,
        text_align: ff.text_align ?? 'left', font_size: ff.font_size ?? 11, required: ff.required, sort_order: ff.sort_order,
      }))
    outForms.push({ id: f.id, project_id: f.project_id, name: f.name, page_count: f.page_count ?? 0, has_template: Boolean(f.template_path), fields, created_at: f.created_at })

    if (f.template_path) {
      const base64 = await supabaseDownload('templates', f.template_path)
      await kvPut(`template_pdf_${f.id}`, base64)
    }
  }

  // --- project_custom_fields ----------------------------------------------
  const outCustomFields = customFields.map((c) => ({
    id: c.id, project_id: c.project_id, label: c.label, type: c.type, required: c.required,
    show_in_table: c.show_in_table ?? true, auto_prefix: c.auto_prefix, auto_start: c.auto_start,
    options: normalizeOptions(c.options), sort_order: c.sort_order,
  }))

  // --- records, with values/custom_values nested + signed PDF pulled out ----
  console.log('Storing signed PDFs...')
  const outRecords = []
  for (const r of recordsRaw) {
    const values = recordValues.filter((v) => v.record_id === r.id).map((v) => ({ field_id: v.field_id, value: v.value ?? '' }))
    const customValues = recordCustomValues.filter((v) => v.record_id === r.id).map((v) => ({ field_id: v.field_id, value: v.value ?? '' }))
    outRecords.push({
      id: r.id, form_id: r.form_id, project_id: r.project_id, signer_name: r.signer_name, signer_email: r.signer_email,
      status: r.status, token: r.token, message: r.message ?? '', sent_at: r.sent_at, viewed_at: r.viewed_at,
      submitted_at: r.submitted_at, completed_at: r.completed_at, onedrive_url: r.onedrive_url,
      onedrive_uploaded_at: r.onedrive_uploaded_at, created_at: r.created_at, values, custom_values: customValues,
    })
    if (r.signed_pdf_data) await kvPut(`signed_pdf_${r.id}`, r.signed_pdf_data)
  }

  // --- onedrive_connections --------------------------------------------------
  const outConnections = connections.map((c) => ({
    project_id: c.project_id, refresh_token: c.refresh_token, access_token: c.access_token, expires_at: c.expires_at,
    folder_id: c.folder_id, folder_path: c.folder_path, account_email: c.account_email, connected_at: c.connected_at,
  }))

  console.log('Writing collections to KV...')
  await kvPut('projects', JSON.stringify(outProjects))
  await kvPut('forms', JSON.stringify(outForms))
  await kvPut('project_custom_fields', JSON.stringify(outCustomFields))
  await kvPut('records', JSON.stringify(outRecords))
  await kvPut('onedrive_connections', JSON.stringify(outConnections))

  console.log('\nDone. Counts written to KV:')
  console.log(`  projects: ${outProjects.length}`)
  console.log(`  forms: ${outForms.length} (with ${formFields.length} total fields nested)`)
  console.log(`  project_custom_fields: ${outCustomFields.length}`)
  console.log(`  records: ${outRecords.length} (with ${recordValues.length} values, ${recordCustomValues.length} custom_values nested)`)
  console.log(`  onedrive_connections: ${outConnections.length}`)
  console.log('\nCompare these counts against the Supabase export counts printed above — they should match exactly.')
}

main().catch((e) => {
  console.error('Migration failed:', e.message)
  process.exit(1)
})
