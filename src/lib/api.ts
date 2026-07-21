// Thin fetch client for the Cloudflare Worker backend (replaces supabase.ts).
// Same-origin: the Worker serves both the SPA and /api/*, so relative paths work.
const API_BASE = '/api'
const TOKEN_KEY = 'cti_sign_session'

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token)
  else sessionStorage.removeItem(TOKEN_KEY)
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// Public, token-gated signer routes — no session/auth header involved.
async function publicRequest(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const api = {
  login: (password: string): Promise<{ token: string }> =>
    request('/login', { method: 'POST', body: JSON.stringify({ password }) }),

  list: <T>(collection: string, params?: Record<string, string>): Promise<T[]> => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : ''
    return request(`/${collection}${qs}`)
  },
  get: <T>(collection: string, id: string): Promise<T> => request(`/${collection}/${id}`),
  create: <T>(collection: string, body: Record<string, unknown>): Promise<T> =>
    request(`/${collection}`, { method: 'POST', body: JSON.stringify(body) }),
  update: <T>(collection: string, id: string, patch: Record<string, unknown>): Promise<T> =>
    request(`/${collection}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (collection: string, id: string): Promise<{ ok: true }> =>
    request(`/${collection}/${id}`, { method: 'DELETE' }),

  replaceFields: (formId: string, fields: unknown[]): Promise<unknown> =>
    request(`/forms/${formId}/fields`, { method: 'PUT', body: JSON.stringify(fields) }),
  uploadTemplate: (formId: string, base64: string, pageCount: number): Promise<unknown> =>
    request(`/templates/${formId}`, { method: 'POST', body: JSON.stringify({ base64, page_count: pageCount }) }),
  getTemplate: (formId: string): Promise<{ base64: string }> => request(`/templates/${formId}`),
  getSignedPdf: (recordId: string): Promise<{ base64: string }> => request(`/records/${recordId}/signed-pdf`),

  sendSignatureRequest: (recordId: string, appUrl: string): Promise<{ ok: true; emailed: boolean; note?: string }> =>
    request('/send-signature-request', { method: 'POST', body: JSON.stringify({ recordId, appUrl }) }),
  sendCompletionEmail: (recordId: string): Promise<{ ok: true; emailed: boolean; note?: string }> =>
    request('/send-completion-email', { method: 'POST', body: JSON.stringify({ recordId }) }),
  onedrive: (body: Record<string, unknown>): Promise<any> =>
    request('/onedrive', { method: 'POST', body: JSON.stringify(body) }),

  // Public signer flow.
  getSigningSession: (token: string): Promise<any> => publicRequest(`/sign/${token}`),
  submitSignature: (token: string, body: { values: { field_id: string; value: string }[]; pdfBase64: string }): Promise<{ ok: true }> =>
    publicRequest(`/sign/${token}/submit`, { method: 'POST', body: JSON.stringify(body) }),
}
