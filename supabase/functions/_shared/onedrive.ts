// OneDrive / SharePoint auto-save via Microsoft Graph (app-only, client-credentials).
//
// This runs unattended inside the submit-signature Edge Function, so it uses the
// "client credentials" flow — an Azure app registration with the APPLICATION
// permission Files.ReadWrite.All (admin-consented). No user is signed in.
//
// Configured entirely by Supabase secrets; if MS_CLIENT_ID is absent the upload
// is skipped and signing still succeeds (files remain safe in Supabase Storage).
//
// Required secrets to enable:
//   MS_TENANT_ID     Azure AD / Entra tenant id (GUID) or domain
//   MS_CLIENT_ID     Application (client) id of the app registration
//   MS_CLIENT_SECRET Client secret value
//   ONEDRIVE_USER    UPN/email or object-id of the OneDrive owner
//                    (e.g. cti-it-team@cti-usa.com) — OR set ONEDRIVE_SITE_ID
//                    for a SharePoint document library instead.
// Optional:
//   ONEDRIVE_SITE_ID SharePoint site id; when set, files go to that site's
//                    default drive instead of a user's OneDrive.
//   ONEDRIVE_FOLDER  Destination folder path (default: "CTI Sign/Signed")

interface UploadResult {
  ok: boolean
  skipped?: boolean
  webUrl?: string
  error?: string
}

export async function uploadToOneDrive(filename: string, bytes: Uint8Array): Promise<UploadResult> {
  const tenant = Deno.env.get('MS_TENANT_ID')
  const clientId = Deno.env.get('MS_CLIENT_ID')
  const clientSecret = Deno.env.get('MS_CLIENT_SECRET')
  const user = Deno.env.get('ONEDRIVE_USER')
  const siteId = Deno.env.get('ONEDRIVE_SITE_ID')
  const folder = (Deno.env.get('ONEDRIVE_FOLDER') ?? 'CTI Sign/Signed').replace(/^\/+|\/+$/g, '')

  if (!clientId || !clientSecret || !tenant || (!user && !siteId)) {
    return { ok: false, skipped: true }
  }

  try {
    // 1. Get an app-only access token
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    })
    if (!tokenRes.ok) return { ok: false, error: 'token: ' + (await tokenRes.text()) }
    const { access_token } = await tokenRes.json()

    // 2. Resolve the drive root for a user's OneDrive or a SharePoint site
    const driveRoot = siteId
      ? `https://graph.microsoft.com/v1.0/sites/${siteId}/drive`
      : `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user!)}/drive`

    // 3. Simple upload (signed PDFs are well under Graph's 4 MB simple-PUT limit)
    const path = `${folder}/${filename}`.split('/').map(encodeURIComponent).join('/')
    const uploadUrl = `${driveRoot}/root:/${path}:/content`
    const up = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/pdf' },
      body: bytes,
    })
    if (!up.ok) return { ok: false, error: 'upload: ' + (await up.text()) }
    const meta = await up.json()
    return { ok: true, webUrl: meta.webUrl }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
