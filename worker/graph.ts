// Microsoft Graph helpers — email sending (app-only client-credentials) and
// OneDrive delegated OAuth (auth code + refresh). Ported near-verbatim from
// the old Supabase Edge Functions; the Graph calls themselves never depended
// on Supabase, only the token source (env vars) and where results get stored
// (now KV instead of Postgres) changed.
import type { Env } from './kv'

export function isGraphEmailConfigured(env: Env): boolean {
  return Boolean(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET)
}

export async function getAppOnlyAccessToken(env: Env): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const res = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID!,
      client_secret: env.MS_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) return { ok: false, error: await res.text() }
  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) return { ok: false, error: 'No access token returned.' }
  return { ok: true, accessToken: data.access_token }
}

export async function sendMailViaGraph(
  env: Env,
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await getAppOnlyAccessToken(env)
  if (!token.ok) return token
  const from = env.MS_SEND_FROM ?? 'cti-it-team@cti-usa.com'
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        replyTo: [{ emailAddress: { address: from } }],
      },
      saveToSentItems: true,
    }),
  })
  if (!res.ok) return { ok: false, error: await res.text() }
  return { ok: true }
}

export function signatureEmailHtml(name: string, doc: string, message: string, link: string): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1a1a1a">
    <div style="background:#111;padding:20px 24px;border-radius:10px 10px 0 0">
      <span style="color:#fff;font-size:20px;font-weight:800">CTI <span style="color:#E11B22">eSign</span></span>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 10px 10px">
      <p>Hi ${escapeHtml(name)},</p>
      <p>You have been requested to review and sign <b>${escapeHtml(doc)}</b>.</p>
      ${message ? `<p style="color:#6b7280">${escapeHtml(message)}</p>` : ''}
      <p style="text-align:center;margin:28px 0">
        <a href="${link}" style="background:#E11B22;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700">Review &amp; sign</a>
      </p>
      <p style="font-size:12px;color:#6b7280">Or paste this link into your browser:<br>${link}</p>
    </div>
  </div>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// --- OneDrive delegated OAuth (per-project "Connect to OneDrive") ---------

const DELEGATED_SCOPE = 'offline_access Files.ReadWrite'

export interface OneDriveConnection {
  project_id: string
  refresh_token: string
  access_token: string | null
  expires_at: string | null
  folder_id: string | null
  folder_path: string | null
  account_email: string | null
  connected_at: string
}

export async function exchangeAuthCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<{ ok: true; refreshToken: string; accessToken: string; expiresAt: string; accountEmail: string | null } | { ok: false; error: string }> {
  const res = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID!,
      client_secret: env.MS_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: DELEGATED_SCOPE,
    }),
  })
  if (!res.ok) return { ok: false, error: await res.text() }
  const tokens = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }

  const meRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } })
  const me = meRes.ok ? ((await meRes.json()) as { mail?: string; userPrincipalName?: string }) : {}

  return {
    ok: true,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    accountEmail: me.mail ?? me.userPrincipalName ?? null,
  }
}

export async function getValidAccessToken(
  env: Env,
  conn: OneDriveConnection,
  onRefreshed: (accessToken: string, refreshToken: string, expiresAt: string) => Promise<void>,
): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const stillValid = conn.access_token && conn.expires_at && new Date(conn.expires_at).getTime() - Date.now() > 60_000
  if (stillValid) return { ok: true, accessToken: conn.access_token! }

  const res = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID!,
      client_secret: env.MS_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
      scope: DELEGATED_SCOPE,
    }),
  })
  if (!res.ok) return { ok: false, error: 'Could not refresh Microsoft session: ' + (await res.text()) }
  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  // Microsoft typically rotates the refresh token on each use — always persist it.
  await onRefreshed(tokens.access_token, tokens.refresh_token ?? conn.refresh_token, expiresAt)
  return { ok: true, accessToken: tokens.access_token }
}

export async function listGraphFolders(accessToken: string, folderId?: string): Promise<{ id: string; name: string }[]> {
  const path = folderId ? `/me/drive/items/${encodeURIComponent(folderId)}/children` : '/me/drive/root/children'
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}?$select=id,name,folder&$top=200`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Could not list folders: ' + (await res.text()))
  const data = (await res.json()) as { value: { id: string; name: string; folder?: unknown }[] }
  return data.value.filter((item) => item.folder).map((item) => ({ id: item.id, name: item.name }))
}

export async function uploadToGraphFolder(
  accessToken: string,
  folderId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<{ ok: true; webUrl?: string } | { ok: false; error: string }> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(filename)}:/content`,
    { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/pdf' }, body: bytes },
  )
  if (!res.ok) return { ok: false, error: 'Upload failed: ' + (await res.text()) }
  const data = (await res.json()) as { webUrl?: string }
  return { ok: true, webUrl: data.webUrl }
}
