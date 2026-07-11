import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

if (!isConfigured) {
  // Keeps the app renderable before keys are wired in; calls will surface a
  // friendly "not configured" message rather than crashing at import time.
  console.warn('[CTI Sign] Supabase env vars missing — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key',
)

// Base URL for Edge Functions (signer flows).
export const functionsBase = url ? `${url}/functions/v1` : ''
