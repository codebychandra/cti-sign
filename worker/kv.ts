export interface Env {
  CTI_SIGN_KV: KVNamespace
  ASSETS: Fetcher
  ADMIN_PASSWORD: string
  SESSION_SECRET: string
  MS_TENANT_ID?: string
  MS_CLIENT_ID?: string
  MS_CLIENT_SECRET?: string
  MS_SEND_FROM?: string
}

export async function getCollection<T>(env: Env, key: string): Promise<T[]> {
  const raw = await env.CTI_SIGN_KV.get(key)
  return raw ? (JSON.parse(raw) as T[]) : []
}

export async function setCollection<T>(env: Env, key: string, items: T[]): Promise<void> {
  await env.CTI_SIGN_KV.put(key, JSON.stringify(items))
}

/**
 * Read-modify-write: not transactional/atomic across concurrent requests —
 * a known, accepted trade-off at this app's scale (see the migration plan).
 */
export async function mutateCollection<T>(
  env: Env,
  key: string,
  mutate: (items: T[]) => T[] | void,
): Promise<T[]> {
  const items = await getCollection<T>(env, key)
  const result = mutate(items)
  const next = result ?? items
  await setCollection(env, key, next)
  return next
}

export function newId(): string {
  return crypto.randomUUID()
}

/** Unguessable per-record signing token (matches the old `gen_random_bytes(24)::hex` default). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function nowIso(): string {
  return new Date().toISOString()
}

// PDF bytes live under their own per-item key (mirroring Hermes' pattern of
// separate per-record file keys) instead of inline in a collection array —
// keeps the collection arrays small and fast to read/write on every request.
const MAX_PDF_BASE64_LENGTH = 10 * 1024 * 1024 // ~10MB base64, matches Hermes' own cap

export async function putPdf(env: Env, key: string, base64: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (base64.length > MAX_PDF_BASE64_LENGTH) {
    return { ok: false, error: 'PDF is too large to store (limit ~7MB per document).' }
  }
  await env.CTI_SIGN_KV.put(key, base64)
  return { ok: true }
}

export async function getPdf(env: Env, key: string): Promise<string | null> {
  return env.CTI_SIGN_KV.get(key)
}

export async function deletePdf(env: Env, key: string): Promise<void> {
  await env.CTI_SIGN_KV.delete(key)
}
