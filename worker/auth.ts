import type { Env } from './kv'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

function toB64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of arr) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** One shared password, held as a Worker secret — compared in constant time. */
export function checkPassword(env: Env, password: string): boolean {
  const a = password
  const b = env.ADMIN_PASSWORD
  if (!b) return false // ADMIN_PASSWORD secret not set yet
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function issueSessionToken(env: Env): Promise<string> {
  const payloadB64 = toB64Url(encoder.encode(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })))
  const key = await hmacKey(env.SESSION_SECRET)
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64))
  return `${payloadB64}.${toB64Url(sig)}`
}

export async function verifySessionToken(env: Env, token: string | null): Promise<boolean> {
  if (!token) return false
  const [payloadB64, sigB64] = token.split('.')
  if (!payloadB64 || !sigB64) return false
  try {
    const key = await hmacKey(env.SESSION_SECRET)
    const valid = await crypto.subtle.verify('HMAC', key, fromB64Url(sigB64), encoder.encode(payloadB64))
    if (!valid) return false
    const payload = JSON.parse(decoder.decode(fromB64Url(payloadB64))) as { exp: number }
    return payload.exp > Date.now()
  } catch {
    return false
  }
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization')
  return header?.startsWith('Bearer ') ? header.slice(7) : null
}
