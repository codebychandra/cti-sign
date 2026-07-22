import { type Env, getCollection, mutateCollection, newId, newToken, nowIso, putPdf, getPdf, deletePdf } from './kv'
import { checkPassword, issueSessionToken, verifySessionToken, bearerToken } from './auth'
import {
  isGraphEmailConfigured,
  sendMailViaGraph,
  signatureEmailHtml,
  completedEmailHtml,
  exchangeAuthCode,
  getValidAccessToken,
  listGraphFolders,
  uploadToGraphFolder,
  type OneDriveConnection,
} from './graph'
import { getMasterData, isZohoConfigured } from './zoho'

// --- Data shapes (mirrors src/lib/types.ts, with form_fields/values nested) -

type ProjectType = 'sent_signature' | 'auto_populate'
type RecordStatus = 'draft' | 'sent' | 'viewed' | 'submitted' | 'completed' | 'declined'

interface Project {
  id: string
  name: string
  description: string
  project_type: ProjectType
  created_at: string
}

interface FormField {
  id: string
  type: string
  label: string
  custom_field_id: string | null
  page: number
  x: number
  y: number
  width: number
  height: number
  text_align: string
  font_size: number
  required: boolean
  sort_order: number
}

interface Form {
  id: string
  project_id: string
  name: string
  page_count: number
  has_template: boolean
  fields: FormField[]
  created_at: string
}

interface ProjectCustomField {
  id: string
  project_id: string
  label: string
  type: string
  required: boolean
  show_in_table: boolean
  auto_prefix: string | null
  auto_start: number | null
  options: string[]
  sort_order: number
}

interface SignRecord {
  id: string
  form_id: string
  project_id: string
  signer_name: string
  signer_email: string
  status: RecordStatus
  token: string
  message: string
  sent_at: string | null
  viewed_at: string | null
  submitted_at: string | null
  completed_at: string | null
  onedrive_url: string | null
  onedrive_uploaded_at: string | null
  created_at: string
  values: { field_id: string; value: string }[]
  custom_values: { field_id: string; value: string }[]
}

// Maps the URL's :collection segment to its KV key and (for onedrive-connections
// only) the field used as its primary key instead of `id`.
const COLLECTIONS: Record<string, { key: string; idField: string }> = {
  projects: { key: 'projects', idField: 'id' },
  forms: { key: 'forms', idField: 'id' },
  'custom-fields': { key: 'project_custom_fields', idField: 'id' },
  records: { key: 'records', idField: 'id' },
  'onedrive-connections': { key: 'onedrive_connections', idField: 'project_id' },
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    try {
      return await route(request, url, env)
    } catch (e) {
      return json({ error: (e as Error).message }, 500)
    }
  },
}

async function route(request: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname.replace(/^\/api\//, '')
  const segments = path.split('/').filter(Boolean)
  const method = request.method

  // --- Public routes: login + the token-gated signer flow ------------------
  if (method === 'POST' && path === 'login') return handleLogin(request, env)
  if (method === 'GET' && segments[0] === 'sign' && segments.length === 2) return handleSigningSession(segments[1], env)
  if (method === 'POST' && segments[0] === 'sign' && segments.length === 3 && segments[2] === 'submit') {
    return handleSubmitSignature(segments[1], request, env)
  }

  // --- Everything else requires the shared admin session -------------------
  const authed = await verifySessionToken(env, bearerToken(request))
  if (!authed) return json({ error: 'Not authenticated' }, 401)

  if (segments[0] === 'templates' && segments.length === 2) {
    if (method === 'POST') return handleUploadTemplate(segments[1], request, env)
    if (method === 'GET') return handleGetTemplate(segments[1], env)
  }
  if (segments[0] === 'forms' && segments.length === 3 && segments[2] === 'fields' && method === 'PUT') {
    return handleReplaceFields(segments[1], request, env)
  }
  if (segments[0] === 'records' && segments.length === 3 && segments[2] === 'signed-pdf' && method === 'GET') {
    return handleGetSignedPdf(segments[1], env)
  }
  if (method === 'POST' && path === 'send-signature-request') return handleSendSignatureRequest(request, env)
  if (method === 'POST' && path === 'send-completion-email') return handleSendCompletionEmail(request, env)
  if (method === 'POST' && path === 'onedrive') return handleOneDrive(request, env)
  if (method === 'GET' && path === 'master-data') return handleMasterData(url, env)

  // --- Generic collection CRUD ---------------------------------------------
  const collectionName = segments[0]
  const collection = COLLECTIONS[collectionName]
  if (collection) return handleCollection(collection, segments[1], method, url, request, env)

  return json({ error: 'Not found' }, 404)
}

// --- Auth --------------------------------------------------------------------

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { password?: string }
  if (!body.password || !checkPassword(env, body.password)) return json({ error: 'Incorrect password' }, 401)
  return json({ token: await issueSessionToken(env) })
}

// --- Generic collection CRUD ---------------------------------------------------

async function handleCollection(
  collection: { key: string; idField: string },
  id: string | undefined,
  method: string,
  url: URL,
  request: Request,
  env: Env,
): Promise<Response> {
  if (method === 'GET' && !id) {
    const items = await getCollection<Record<string, unknown>>(env, collection.key)
    const filtered = items.filter((item) =>
      Array.from(url.searchParams.entries()).every(([k, v]) => String(item[k] ?? '') === v),
    )
    return json(filtered)
  }

  if (method === 'GET' && id) {
    const items = await getCollection<Record<string, unknown>>(env, collection.key)
    const item = items.find((i) => i[collection.idField] === id)
    return item ? json(item) : json({ error: 'Not found' }, 404)
  }

  if (method === 'POST') {
    const body = (await request.json()) as Record<string, unknown>
    const item: Record<string, unknown> = { id: newId(), created_at: nowIso(), ...body }
    // Records need an unguessable signing token — the old Supabase schema
    // generated this as a database column default; there's no equivalent
    // here, so it has to be assigned explicitly on creation.
    if (collection.key === 'records' && !item.token) item.token = newToken()
    await mutateCollection(env, collection.key, (items) => {
      items.push(item)
    })
    return json(item, 201)
  }

  if (method === 'PATCH' && id) {
    let updated: Record<string, unknown> | null = null
    const patch = (await request.json()) as Record<string, unknown>
    await mutateCollection<Record<string, unknown>>(env, collection.key, (items) => {
      const idx = items.findIndex((i) => i[collection.idField] === id)
      if (idx >= 0) {
        items[idx] = { ...items[idx], ...patch }
        updated = items[idx]
      }
    })
    return updated ? json(updated) : json({ error: 'Not found' }, 404)
  }

  if (method === 'DELETE' && id) {
    await mutateCollection<Record<string, unknown>>(env, collection.key, (items) =>
      items.filter((i) => i[collection.idField] !== id),
    )
    if (collection.key === 'forms') await deletePdf(env, `template_pdf_${id}`)
    if (collection.key === 'records') await deletePdf(env, `signed_pdf_${id}`)
    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, 405)
}

// --- Templates (PDF upload/download) ------------------------------------------

async function handleUploadTemplate(formId: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { base64?: string; page_count?: number }
  if (!body.base64 || !body.page_count) return json({ error: 'Missing base64 or page_count' }, 400)
  const stored = await putPdf(env, `template_pdf_${formId}`, body.base64)
  if (!stored.ok) return json({ error: stored.error }, 413)

  let updated: Form | null = null
  await mutateCollection<Form>(env, 'forms', (forms) => {
    const idx = forms.findIndex((f) => f.id === formId)
    if (idx >= 0) {
      forms[idx] = { ...forms[idx], page_count: body.page_count!, has_template: true }
      updated = forms[idx]
    }
  })
  return updated ? json(updated) : json({ error: 'Form not found' }, 404)
}

async function handleGetTemplate(formId: string, env: Env): Promise<Response> {
  const base64 = await getPdf(env, `template_pdf_${formId}`)
  return base64 ? json({ base64 }) : json({ error: 'No template uploaded' }, 404)
}

async function handleGetSignedPdf(recordId: string, env: Env): Promise<Response> {
  const base64 = await getPdf(env, `signed_pdf_${recordId}`)
  return base64 ? json({ base64 }) : json({ error: 'No signed document found' }, 404)
}

async function handleReplaceFields(formId: string, request: Request, env: Env): Promise<Response> {
  const fields = (await request.json()) as FormField[]
  let updated: Form | null = null
  await mutateCollection<Form>(env, 'forms', (forms) => {
    const idx = forms.findIndex((f) => f.id === formId)
    if (idx >= 0) {
      forms[idx] = { ...forms[idx], fields }
      updated = forms[idx]
    }
  })
  return updated ? json(updated) : json({ error: 'Form not found' }, 404)
}

// --- Signer flow (public, token-gated) ----------------------------------------

async function handleSigningSession(token: string, env: Env): Promise<Response> {
  const records = await getCollection<SignRecord>(env, 'records')
  const record = records.find((r) => r.token === token)
  if (!record) return json({ error: 'Invalid or expired signing link' }, 404)

  const forms = await getCollection<Form>(env, 'forms')
  const form = forms.find((f) => f.id === record.form_id)
  if (!form?.has_template) return json({ error: 'Document is not ready yet' }, 409)

  const templateBase64 = await getPdf(env, `template_pdf_${form.id}`)
  if (!templateBase64) return json({ error: 'Document is not ready yet' }, 409)

  if (record.status === 'sent') {
    await mutateCollection<SignRecord>(env, 'records', (items) => {
      const idx = items.findIndex((r) => r.id === record.id)
      if (idx >= 0) items[idx] = { ...items[idx], status: 'viewed', viewed_at: nowIso() }
    })
  }

  return json({
    record: {
      signer_name: record.signer_name,
      signer_email: record.signer_email,
      message: record.message,
      status: record.status,
      custom_values: record.custom_values,
    },
    form: { name: form.name, page_count: form.page_count },
    fields: form.fields,
    templateBase64,
  })
}

async function handleSubmitSignature(token: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { values?: { field_id: string; value: string }[]; pdfBase64?: string }
  if (!body.pdfBase64) return json({ error: 'Missing signed document' }, 400)

  const records = await getCollection<SignRecord>(env, 'records')
  const record = records.find((r) => r.token === token)
  if (!record) return json({ error: 'Invalid signing link' }, 404)
  if (record.status === 'submitted' || record.status === 'completed') return json({ error: 'This document has already been signed' }, 409)

  const stored = await putPdf(env, `signed_pdf_${record.id}`, body.pdfBase64)
  if (!stored.ok) return json({ error: stored.error }, 413)

  await mutateCollection<SignRecord>(env, 'records', (items) => {
    const idx = items.findIndex((r) => r.id === record.id)
    if (idx >= 0) {
      items[idx] = { ...items[idx], status: 'submitted', submitted_at: nowIso(), values: body.values ?? items[idx].values }
    }
  })
  return json({ ok: true })
}

// --- Email ---------------------------------------------------------------------

async function recordDetails(env: Env, record: SignRecord): Promise<{ label: string; value: string }[]> {
  const customFields = await getCollection<ProjectCustomField>(env, 'project_custom_fields')
  const projectFields = customFields.filter((f) => f.project_id === record.project_id && f.show_in_table).sort((a, b) => a.sort_order - b.sort_order)
  return projectFields
    .map((field) => ({ label: field.label, value: record.custom_values.find((v) => v.field_id === field.id)?.value ?? '' }))
    .filter((d) => d.value)
}

// "Project Name_Name" — matches the client's downloadFilename convention
// (src/pages/ProjectDetail.tsx) so downloads, OneDrive saves, and email
// subjects/attachments all identify a document the same way.
async function buildDocumentTitle(env: Env, record: SignRecord): Promise<string> {
  const [projects, customFields] = await Promise.all([
    getCollection<Project>(env, 'projects'),
    getCollection<ProjectCustomField>(env, 'project_custom_fields'),
  ])
  const project = projects.find((p) => p.id === record.project_id)
  const nameField = customFields.find((f) => f.project_id === record.project_id && f.label.trim().toLowerCase() === 'name')
  const nameValue = (nameField && record.custom_values.find((v) => v.field_id === nameField.id)?.value?.trim()) || record.signer_name
  const parts = [project?.name, nameValue].filter((p): p is string => Boolean(p && p.trim()))
  return parts.join('_').trim() || 'Document'
}

async function buildDocumentFilename(env: Env, record: SignRecord): Promise<string> {
  const title = await buildDocumentTitle(env, record)
  return `${title.replace(/[^\w.() -]+/g, '')}.pdf`
}

async function handleSendSignatureRequest(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { recordId?: string; appUrl?: string }
  if (!body.recordId || !body.appUrl) return json({ error: 'Missing recordId or appUrl' }, 400)

  const records = await getCollection<SignRecord>(env, 'records')
  const record = records.find((r) => r.id === body.recordId)
  if (!record) return json({ error: 'Record not found' }, 404)

  const forms = await getCollection<Form>(env, 'forms')
  const docName = forms.find((f) => f.id === record.form_id)?.name ?? 'Document'
  const link = `${body.appUrl}/sign/${record.token}`

  if (isGraphEmailConfigured(env)) {
    const details = await recordDetails(env, record)
    const subject = await buildDocumentTitle(env, record)
    const result = await sendMailViaGraph(env, record.signer_email, subject, signatureEmailHtml(record.signer_name, docName, record.message, link, details))
    if (!result.ok) return json({ error: 'Microsoft email error: ' + result.error }, 502)
    await markSent(env, record.id)
    return json({ ok: true, emailed: true, provider: 'microsoft-graph' })
  }

  await markSent(env, record.id)
  return json({ ok: true, emailed: false, note: 'No email provider configured; link marked sent for manual sharing.', link })
}

async function handleSendCompletionEmail(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { recordId?: string }
  if (!body.recordId) return json({ error: 'Missing recordId' }, 400)

  const records = await getCollection<SignRecord>(env, 'records')
  const record = records.find((r) => r.id === body.recordId)
  if (!record) return json({ error: 'Record not found' }, 404)
  if (!isGraphEmailConfigured(env)) return json({ ok: true, emailed: false, note: 'No email provider configured.' })

  const forms = await getCollection<Form>(env, 'forms')
  const docName = forms.find((f) => f.id === record.form_id)?.name ?? 'Document'
  const signedPdfBase64 = await getPdf(env, `signed_pdf_${record.id}`)
  if (!signedPdfBase64) return json({ error: 'No signed document found for this record.' }, 404)

  const details = await recordDetails(env, record)
  const subject = await buildDocumentTitle(env, record)
  const attachmentName = await buildDocumentFilename(env, record)
  const result = await sendMailViaGraph(
    env,
    record.signer_email,
    subject,
    completedEmailHtml(record.signer_name, docName, details),
    { name: attachmentName, contentType: 'application/pdf', contentBase64: signedPdfBase64 },
  )
  if (!result.ok) return json({ error: 'Microsoft email error: ' + result.error }, 502)
  return json({ ok: true, emailed: true, provider: 'microsoft-graph' })
}

async function markSent(env: Env, recordId: string): Promise<void> {
  await mutateCollection<SignRecord>(env, 'records', (items) => {
    const idx = items.findIndex((r) => r.id === recordId)
    if (idx >= 0) items[idx] = { ...items[idx], status: 'sent', sent_at: nowIso() }
  })
}

// --- Master Data (Zoho Recruit Candidates feed) ---------------------------------

async function handleMasterData(url: URL, env: Env): Promise<Response> {
  if (!isZohoConfigured(env)) return json({ error: 'Zoho is not configured on this environment.' }, 409)
  try {
    const payload = await getMasterData(env, url.searchParams.get('refresh') === '1')
    return json(payload)
  } catch (e) {
    return json({ error: 'Zoho error: ' + (e as Error).message }, 502)
  }
}

// --- OneDrive connect (multi-action) --------------------------------------------

async function handleOneDrive(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>
  switch (body.action) {
    case 'exchange': return odExchange(body as { project_id: string; code: string; redirect_uri: string }, env)
    case 'list-folders': return odListFolders(body as { project_id: string; folder_id?: string }, env)
    case 'select-folder': return odSelectFolder(body as { project_id: string; folder_id: string; folder_path: string }, env)
    case 'disconnect': return odDisconnect(body as { project_id: string }, env)
    case 'upload': return odUpload(body as { record_id: string }, env)
    default: return json({ error: 'Unknown action' }, 400)
  }
}

async function odExchange({ project_id, code, redirect_uri }: { project_id: string; code: string; redirect_uri: string }, env: Env) {
  if (!project_id || !code || !redirect_uri) return json({ error: 'Missing project_id, code, or redirect_uri' }, 400)
  const result = await exchangeAuthCode(env, code, redirect_uri)
  if (!result.ok) return json({ error: 'Microsoft token exchange failed: ' + result.error }, 502)

  await mutateCollection<OneDriveConnection>(env, 'onedrive_connections', (items) => {
    const idx = items.findIndex((c) => c.project_id === project_id)
    const conn: OneDriveConnection = {
      project_id,
      refresh_token: result.refreshToken,
      access_token: result.accessToken,
      expires_at: result.expiresAt,
      folder_id: null,
      folder_path: null,
      account_email: result.accountEmail,
      connected_at: nowIso(),
    }
    if (idx >= 0) items[idx] = conn
    else items.push(conn)
  })
  return json({ ok: true, account_email: result.accountEmail })
}

async function findConnection(env: Env, projectId: string): Promise<OneDriveConnection | null> {
  const items = await getCollection<OneDriveConnection>(env, 'onedrive_connections')
  return items.find((c) => c.project_id === projectId) ?? null
}

async function odListFolders({ project_id, folder_id }: { project_id: string; folder_id?: string }, env: Env) {
  if (!project_id) return json({ error: 'Missing project_id' }, 400)
  const conn = await findConnection(env, project_id)
  if (!conn) return json({ error: 'Not connected' }, 404)
  const token = await getValidAccessToken(env, conn, async (accessToken, refreshToken, expiresAt) => {
    await mutateCollection<OneDriveConnection>(env, 'onedrive_connections', (items) => {
      const idx = items.findIndex((c) => c.project_id === project_id)
      if (idx >= 0) items[idx] = { ...items[idx], access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt }
    })
  })
  if (!token.ok) return json({ error: token.error }, 502)
  const folders = await listGraphFolders(token.accessToken, folder_id)
  return json({ ok: true, folders })
}

async function odSelectFolder({ project_id, folder_id, folder_path }: { project_id: string; folder_id: string; folder_path: string }, env: Env) {
  if (!project_id || !folder_id || !folder_path) return json({ error: 'Missing project_id, folder_id, or folder_path' }, 400)
  let found = false
  await mutateCollection<OneDriveConnection>(env, 'onedrive_connections', (items) => {
    const idx = items.findIndex((c) => c.project_id === project_id)
    if (idx >= 0) {
      items[idx] = { ...items[idx], folder_id, folder_path }
      found = true
    }
  })
  return found ? json({ ok: true }) : json({ error: 'Not connected' }, 404)
}

async function odDisconnect({ project_id }: { project_id: string }, env: Env) {
  if (!project_id) return json({ error: 'Missing project_id' }, 400)
  await mutateCollection<OneDriveConnection>(env, 'onedrive_connections', (items) => items.filter((c) => c.project_id !== project_id))
  return json({ ok: true })
}

async function odUpload({ record_id }: { record_id: string }, env: Env) {
  if (!record_id) return json({ error: 'Missing record_id' }, 400)
  const records = await getCollection<SignRecord>(env, 'records')
  const record = records.find((r) => r.id === record_id)
  if (!record) return json({ error: 'Record not found' }, 404)

  const signedBase64 = await getPdf(env, `signed_pdf_${record.id}`)
  if (!signedBase64) return json({ error: 'No signed document to upload yet' }, 409)

  const conn = await findConnection(env, record.project_id)
  if (!conn || !conn.folder_id) return json({ ok: true, skipped: true, note: 'No OneDrive folder connected for this project.' })

  const token = await getValidAccessToken(env, conn, async (accessToken, refreshToken, expiresAt) => {
    await mutateCollection<OneDriveConnection>(env, 'onedrive_connections', (items) => {
      const idx = items.findIndex((c) => c.project_id === record.project_id)
      if (idx >= 0) items[idx] = { ...items[idx], access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt }
    })
  })
  if (!token.ok) return json({ error: token.error }, 502)

  const filename = await buildDocumentFilename(env, record)
  const bytes = Uint8Array.from(atob(signedBase64), (c) => c.charCodeAt(0))
  const uploaded = await uploadToGraphFolder(token.accessToken, conn.folder_id, filename, bytes)
  if (!uploaded.ok) return json({ error: uploaded.error }, 502)

  await mutateCollection<SignRecord>(env, 'records', (items) => {
    const idx = items.findIndex((r) => r.id === record.id)
    if (idx >= 0) items[idx] = { ...items[idx], onedrive_url: uploaded.webUrl ?? null, onedrive_uploaded_at: nowIso() }
  })
  return json({ ok: true, webUrl: uploaded.webUrl })
}
