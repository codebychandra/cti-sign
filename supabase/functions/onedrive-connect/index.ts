// POST /onedrive-connect — staff only (JWT verified). One function, several
// actions, all around a per-project OneDrive connection (delegated OAuth):
//   exchange       — trade an auth code for tokens, store the connection
//   list-folders   — browse a connected account's folders (for the picker)
//   select-folder  — save which folder a project should upload into
//   disconnect     — forget the connection
//   upload         — push one record's completed PDF into its project's folder
//
// Uses the SAME app registration as send-signature-request (MS_TENANT_ID/
// MS_CLIENT_ID/MS_CLIENT_SECRET), just with the Files.ReadWrite + offline_access
// delegated permissions added. The redirect URI must be registered under a
// "Web" platform in Entra (not "Single-page application") because the code
// is exchanged here, server-side, with the client secret.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const MS_TENANT_ID = Deno.env.get('MS_TENANT_ID')
const MS_CLIENT_ID = Deno.env.get('MS_CLIENT_ID')
const MS_CLIENT_SECRET = Deno.env.get('MS_CLIENT_SECRET')
const SCOPE = 'offline_access Files.ReadWrite'

interface Connection {
  project_id: string
  refresh_token: string
  access_token: string | null
  expires_at: string | null
  folder_id: string | null
  folder_path: string | null
  account_email: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    return json({ error: 'Microsoft app credentials are not configured on the server yet.' }, 500)
  }

  try {
    const body = await req.json()
    switch (body.action) {
      case 'exchange': return await handleExchange(body)
      case 'list-folders': return await handleListFolders(body)
      case 'select-folder': return await handleSelectFolder(body)
      case 'disconnect': return await handleDisconnect(body)
      case 'upload': return await handleUpload(body)
      default: return json({ error: 'Unknown action' }, 400)
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

async function handleExchange({ project_id, code, redirect_uri }: { project_id?: string; code?: string; redirect_uri?: string }) {
  if (!project_id || !code || !redirect_uri) return json({ error: 'Missing project_id, code, or redirect_uri' }, 400)

  const tokenRes = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID!,
      client_secret: MS_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      redirect_uri,
      scope: SCOPE,
    }),
  })
  if (!tokenRes.ok) return json({ error: 'Microsoft token exchange failed: ' + (await tokenRes.text()) }, 502)
  const tokens = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number }

  const meRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } })
  const me = meRes.ok ? await meRes.json() as { mail?: string; userPrincipalName?: string } : {}
  const accountEmail = me.mail ?? me.userPrincipalName ?? null

  const { error } = await admin.from('onedrive_connections').upsert({
    project_id,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    account_email: accountEmail,
    folder_id: null,
    folder_path: null,
  })
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true, account_email: accountEmail })
}

async function handleListFolders({ project_id, folder_id }: { project_id?: string; folder_id?: string }) {
  if (!project_id) return json({ error: 'Missing project_id' }, 400)
  const conn = await loadConnection(project_id)
  if (!conn) return json({ error: 'Not connected' }, 404)
  const token = await getValidAccessToken(conn)
  if (!token.ok) return json({ error: token.error }, 502)

  const path = folder_id ? `/me/drive/items/${encodeURIComponent(folder_id)}/children` : '/me/drive/root/children'
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}?$select=id,name,folder&$top=200`, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  })
  if (!res.ok) return json({ error: 'Could not list folders: ' + (await res.text()) }, 502)
  const data = await res.json() as { value: { id: string; name: string; folder?: unknown }[] }
  const folders = data.value.filter((item) => item.folder).map((item) => ({ id: item.id, name: item.name }))
  return json({ ok: true, folders })
}

async function handleSelectFolder({ project_id, folder_id, folder_path }: { project_id?: string; folder_id?: string; folder_path?: string }) {
  if (!project_id || !folder_id || !folder_path) return json({ error: 'Missing project_id, folder_id, or folder_path' }, 400)
  const { error } = await admin.from('onedrive_connections').update({ folder_id, folder_path }).eq('project_id', project_id)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}

async function handleDisconnect({ project_id }: { project_id?: string }) {
  if (!project_id) return json({ error: 'Missing project_id' }, 400)
  const { error } = await admin.from('onedrive_connections').delete().eq('project_id', project_id)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}

async function handleUpload({ record_id }: { record_id?: string }) {
  if (!record_id) return json({ error: 'Missing record_id' }, 400)
  const { data: record } = await admin
    .from('records')
    .select('id, project_id, signer_name, signed_pdf_data')
    .eq('id', record_id)
    .single()
  if (!record) return json({ error: 'Record not found' }, 404)
  if (!record.signed_pdf_data) return json({ error: 'No signed document to upload yet' }, 409)

  const conn = await loadConnection(record.project_id)
  if (!conn || !conn.folder_id) return json({ ok: true, skipped: true, note: 'No OneDrive folder connected for this project.' })

  const token = await getValidAccessToken(conn)
  if (!token.ok) return json({ error: token.error }, 502)

  const filename = `${(record.signer_name || 'record').replace(/[^\w.-]+/g, '_')}-${record.id.slice(0, 8)}.pdf`
  const bytes = Uint8Array.from(atob(record.signed_pdf_data), (c) => c.charCodeAt(0))
  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(conn.folder_id)}:/${encodeURIComponent(filename)}:/content`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/pdf' }, body: bytes },
  )
  if (!uploadRes.ok) return json({ error: 'Upload failed: ' + (await uploadRes.text()) }, 502)
  const uploaded = await uploadRes.json() as { webUrl?: string }

  await admin.from('records').update({ onedrive_url: uploaded.webUrl ?? null, onedrive_uploaded_at: new Date().toISOString() }).eq('id', record.id)
  return json({ ok: true, webUrl: uploaded.webUrl })
}

async function loadConnection(projectId: string): Promise<Connection | null> {
  const { data } = await admin.from('onedrive_connections').select('*').eq('project_id', projectId).single()
  return (data as Connection) ?? null
}

async function getValidAccessToken(conn: Connection): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const stillValid = conn.access_token && conn.expires_at && new Date(conn.expires_at).getTime() - Date.now() > 60_000
  if (stillValid) return { ok: true, accessToken: conn.access_token! }

  const res = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID!,
      client_secret: MS_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
      scope: SCOPE,
    }),
  })
  if (!res.ok) return { ok: false, error: 'Could not refresh Microsoft session: ' + (await res.text()) }
  const tokens = await res.json() as { access_token: string; refresh_token?: string; expires_in: number }

  // Microsoft typically rotates the refresh token on each use — always persist it.
  await admin.from('onedrive_connections').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }).eq('project_id', conn.project_id)

  return { ok: true, accessToken: tokens.access_token }
}
