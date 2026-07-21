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

export interface MailAttachment {
  name: string
  contentType: string
  contentBase64: string
}

export async function sendMailViaGraph(
  env: Env,
  to: string,
  subject: string,
  html: string,
  attachment?: MailAttachment,
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
        ...(attachment
          ? {
              attachments: [
                {
                  '@odata.type': '#microsoft.graph.fileAttachment',
                  name: attachment.name,
                  contentType: attachment.contentType,
                  contentBytes: attachment.contentBase64,
                },
              ],
            }
          : {}),
      },
      saveToSentItems: true,
    }),
  })
  if (!res.ok) return { ok: false, error: await res.text() }
  return { ok: true }
}

// Shared CTI Group branded shell (header banner + footer), matching the
// look already used for Hermes' Service Agreement emails so crew see one
// consistent CTI brand across both tools.
function brandedEmailShell(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;margin:0 auto;"><tr><td>
<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid #e0e0e0;">
  <tr><td style="padding:18px 24px;background:#B01A18;" bgcolor="#B01A18">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;"><img src="https://codebychandra.github.io/hermes/logo.jpg" width="44" height="44" alt="CTI" style="display:block;border:0;"></td>
      <td style="padding-left:12px;vertical-align:middle;">
        <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:0.3px;line-height:1.1;">CTI Group</div>
        <div style="color:rgba(255,255,255,0.75);font-size:10px;letter-spacing:1.2px;text-transform:uppercase;margin-top:2px;">Worldwide Services, Inc.</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;background:#8B1210;font-size:0;line-height:0;" bgcolor="#8B1210">&nbsp;</td></tr>
  <tr><td style="background:#ffffff;padding:28px 24px;" bgcolor="#ffffff">
    ${bodyHtml}
  </td></tr>
  <tr><td style="padding:12px 24px;background:#f8f8f8;text-align:center;" bgcolor="#f8f8f8">
    <p style="margin:0;font-size:10.5px;color:#aaa;">CTI Group Worldwide Services, Inc. &middot; www.cti-usa.com</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

function detailsBoxHtml(details: { label: string; value: string }[]): string {
  if (!details.length) return ''
  const rows = details
    .map((d) => `<div style="font-size:13px;color:#444;margin-bottom:4px;"><strong>${escapeHtml(d.label)}:</strong> ${escapeHtml(d.value || '—')}</div>`)
    .join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border:1px solid #eee;border-radius:6px;margin:0 0 18px;"><tr><td style="padding:14px 16px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#aaa;margin-bottom:10px;">Details</div>
      ${rows}
    </td></tr></table>`
}

export function signatureEmailHtml(name: string, doc: string, message: string, link: string, details: { label: string; value: string }[] = []): string {
  return brandedEmailShell(`
    <h2 style="margin:0 0 14px;font-size:16px;color:#1a1a1a;">${escapeHtml(doc)}</h2>
    <p style="margin:0 0 8px;font-size:13px;color:#555;">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 18px;font-size:13px;color:#555;line-height:1.6;">Please review and electronically sign your ${escapeHtml(doc)} using the link below.${message ? ` ${escapeHtml(message)}` : ''}</p>
    ${detailsBoxHtml(details)}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr><td style="background:#B01A18;border-radius:6px;" bgcolor="#B01A18">
      <a href="${link}" style="display:block;padding:13px 16px;color:#fff;font-size:14px;font-weight:700;text-decoration:none;text-align:center;">Review &amp; Sign Document</a>
    </td></tr></table>
    <p style="font-size:11px;color:#aaa;margin:0;">If you have questions about this document, please contact CTI Indonesia directly. Do not ignore this email.</p>
  `)
}

export function completedEmailHtml(name: string, doc: string, details: { label: string; value: string }[] = []): string {
  return brandedEmailShell(`
    <h2 style="margin:0 0 14px;font-size:16px;color:#1a1a1a;">Your Signed ${escapeHtml(doc)} is Confirmed</h2>
    <p style="margin:0 0 8px;font-size:13px;color:#555;">Dear <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin:0 0 10px;font-size:13px;color:#555;line-height:1.6;">Your ${escapeHtml(doc)} has been signed and confirmed by CTI Group Indonesia. Please find your signed copy attached to this email.</p>
    <p style="margin:0 0 18px;font-size:13px;color:#555;line-height:1.6;"><strong>Please keep this document in a safe place.</strong> You may be required to present it during your boarding process, so ensure it is readily accessible before your departure.</p>
    ${detailsBoxHtml(details)}
    <p style="font-size:11px;color:#aaa;margin:0;">For any questions regarding your documents or services, please contact CTI Indonesia directly.</p>
  `)
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
