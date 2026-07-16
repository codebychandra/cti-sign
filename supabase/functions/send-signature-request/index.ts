// POST /send-signature-request — staff only (JWT verified). Emails the signer
// their unique signing link and marks the record as sent.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('SIGN_FROM_EMAIL') ?? 'CTI Sign <no-reply@cti-usa.com>'
const MS_TENANT_ID = Deno.env.get('MS_TENANT_ID')
const MS_CLIENT_ID = Deno.env.get('MS_CLIENT_ID')
const MS_CLIENT_SECRET = Deno.env.get('MS_CLIENT_SECRET')
const MS_SEND_FROM = Deno.env.get('MS_SEND_FROM') ?? 'cti-it-team@cti-usa.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const { recordId, appUrl } = await req.json()
    if (!recordId || !appUrl) return json({ error: 'Missing recordId or appUrl' }, 400)

    const { data: record } = await admin
      .from('records')
      .select('id, token, signer_name, signer_email, message, form_id')
      .eq('id', recordId)
      .single()
    if (!record) return json({ error: 'Record not found' }, 404)

    const { data: form } = await admin.from('forms').select('name').eq('id', record.form_id).single()
    const docName = form?.name ?? 'Document'
    const link = `${appUrl}/sign/${record.token}`
    const subject = `Signature requested: ${docName}`
    const html = emailHtml(record.signer_name, docName, record.message, link)

    if (isMicrosoftGraphConfigured()) {
      const result = await sendWithMicrosoftGraph(record.signer_email, subject, html)
      if (!result.ok) return json({ error: 'Microsoft email error: ' + result.error }, 502)
      await markSent(record.id)
      return json({ ok: true, emailed: true, provider: 'microsoft-graph' })
    }

    if (RESEND_API_KEY) {
      const result = await sendWithResend(record.signer_email, subject, html)
      if (!result.ok) return json({ error: 'Email provider error: ' + result.error }, 502)
      await markSent(record.id)
      return json({ ok: true, emailed: true, provider: 'resend' })
    }

    // No email provider configured yet — still mark sent so the manual link works.
    await markSent(record.id)
    return json({ ok: true, emailed: false, note: 'No email provider configured; link marked sent for manual sharing.', link })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

function markSent(id: string) {
  return admin.from('records').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id)
}

function isMicrosoftGraphConfigured() {
  return Boolean(MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET)
}

async function sendWithMicrosoftGraph(to: string, subject: string, html: string) {
  const token = await getMicrosoftAccessToken()
  if (!token.ok) return token

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MS_SEND_FROM!)}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        replyTo: [{ emailAddress: { address: MS_SEND_FROM } }],
      },
      saveToSentItems: true,
    }),
  })

  if (!res.ok) return { ok: false as const, error: await res.text() }
  return { ok: true as const }
}

async function getMicrosoftAccessToken() {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID!,
    client_secret: MS_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })

  const res = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) return { ok: false as const, error: await res.text() }
  const data = await res.json() as { access_token?: string }
  if (!data.access_token) return { ok: false as const, error: 'No access token returned.' }
  return { ok: true as const, accessToken: data.access_token }
}

async function sendWithResend(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })

  if (!res.ok) return { ok: false as const, error: await res.text() }
  return { ok: true as const }
}

function emailHtml(name: string, doc: string, message: string, link: string) {
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
        <a href="${link}" style="background:#E11B22;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700">
          Review &amp; sign
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280">Or paste this link into your browser:<br>${link}</p>
    </div>
  </div>`
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
