import type { Env } from './kv'

// Zoho Recruit "Candidates" module (Athena's confirmed field map — reuse
// these API names rather than re-discovering them; see Athena's worker.js).
const ZOHO_ACCOUNTS = 'https://accounts.zoho.com'
const ZOHO_RECRUIT = 'https://recruit.zoho.com/recruit/v2'
const TOKEN_CACHE_KEY = 'zoho_access_token'
const MASTER_DATA_CACHE_KEY = 'master_data_cache'
const MASTER_DATA_TTL_SECONDS = 600 // 10 min, matches Hermes' Master Data cache

export function isZohoConfigured(env: Env): boolean {
  return Boolean(env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REFRESH_TOKEN)
}

async function getZohoToken(env: Env): Promise<string> {
  const cached = await env.CTI_SIGN_KV.get(TOKEN_CACHE_KEY, 'json') as { token: string; expiresAt: number } | null
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const body = new URLSearchParams({
    refresh_token: env.ZOHO_REFRESH_TOKEN!,
    client_id: env.ZOHO_CLIENT_ID!,
    client_secret: env.ZOHO_CLIENT_SECRET!,
    grant_type: 'refresh_token',
  })
  const res = await fetch(`${ZOHO_ACCOUNTS}/oauth/v2/token`, { method: 'POST', body })
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!data.access_token) throw new Error(data.error || 'Zoho token refresh failed')

  const entry = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 }
  await env.CTI_SIGN_KV.put(TOKEN_CACHE_KEY, JSON.stringify(entry), { expirationTtl: 3500 })
  return entry.token
}

// The Candidates module holds CTI's entire recruiting history — tens of
// thousands of records, ~5-8s per 200-record page from Zoho. Filtering to
// just the active onboarding statuses (below) still matches 4,399 records
// company-wide. Hermes' own Master Data feed additionally scopes to
// CTI_Office = 'CTI Indonesia' (the office this app's seafarers come
// through) — matching that filter here brings the real count to 2,342,
// confirmed against Zoho directly. No page cap: this mirrors Hermes'
// existing feed exactly rather than an arbitrary slice of it. A cold
// fetch takes ~85s (12 pages), which is why results are cached 10 min in
// KV — only a manual Refresh or a stale cache pays that cost.
// MAX_PAGES is a runaway-loop backstop only, not a practical limit.
const ACTIVE_ONBOARDING_STATUSES = ['Completing Documents', 'Ready to Go', 'Report to Ship', 'Rescheduled']
const CTI_OFFICE = 'CTI Indonesia'
const MAX_PAGES = 50
const PER_PAGE = 200

function buildActiveCandidatesCriteria(): string {
  const statusOr = `(${ACTIVE_ONBOARDING_STATUSES.map((s) => `(Onboarding_Status:equals:${s})`).join('or')})`
  return `(${statusOr}and(CTI_Office:equals:${CTI_OFFICE}))`
}

async function fetchActiveCandidates(token: string): Promise<{ records: Record<string, unknown>[]; truncated: boolean }> {
  let all: Record<string, unknown>[] = []
  let page = 1
  let more = true
  // URLSearchParams.set() encodes its value itself — don't pre-encode here,
  // or the criteria string gets double-encoded and Zoho silently matches
  // nothing instead of erroring.
  const criteria = buildActiveCandidatesCriteria()
  while (more && page <= MAX_PAGES) {
    const u = new URL(`${ZOHO_RECRUIT}/Candidates/search`)
    u.searchParams.set('criteria', criteria)
    u.searchParams.set('page', String(page))
    u.searchParams.set('per_page', String(PER_PAGE))
    u.searchParams.set('sort_by', 'Updated_On')
    u.searchParams.set('sort_order', 'desc')
    const res = await fetch(u.toString(), { headers: { Authorization: `Zoho-oauthtoken ${token}` } })
    const data = (await res.json()) as { data?: Record<string, unknown>[]; info?: { more_records?: boolean } }
    all = all.concat(data.data ?? [])
    more = data.info?.more_records === true
    page++
  }
  return { records: all, truncated: more }
}

// Field API names confirmed in Athena's worker.js `SF` map.
export interface SeafarerRow {
  id: string
  fullName: string
  cruiseLine: string
  positionHired: string
  seafarerIdNumber: string
  onboardingStatus: string
  employmentStatus: string
  signOnDate: string
  signOffDate: string
  signOnPort: string
  seamanBookNumber: string
  passportNumber: string
  dateOfBirth: string
  gender: string
  email: string
  phone: string
}

function mapSeafarer(r: Record<string, unknown>): SeafarerRow {
  const str = (v: unknown): string => {
    if (Array.isArray(v)) return v.join(', ')
    if (v && typeof v === 'object' && 'name' in v) return String((v as { name: unknown }).name ?? '')
    return v == null ? '' : String(v)
  }
  return {
    id: String(r.id ?? ''),
    fullName: str(r.Full_Name) || [str(r.First_Name), str(r.Last_Name)].filter(Boolean).join(' '),
    cruiseLine: str(r.Cruise_Line),
    positionHired: str(r.Position_Applied),
    seafarerIdNumber: str(r.Crew_ID_Number),
    onboardingStatus: str(r.Onboarding_Status),
    employmentStatus: str(r.Employment_Status),
    signOnDate: str(r.Sign_On_Date),
    signOffDate: str(r.Sign_Off_Date),
    signOnPort: str(r.Sign_On_Port),
    seamanBookNumber: str(r.Seaman_Book_Number),
    passportNumber: str(r.Passport_Number),
    dateOfBirth: str(r.Date_of_Birth),
    gender: str(r.Gender),
    email: str(r.Email),
    phone: str(r.Mobile),
  }
}

export interface MasterDataPayload {
  source: string
  count: number
  truncated: boolean
  data: SeafarerRow[]
}

export async function getMasterData(env: Env, refresh: boolean): Promise<MasterDataPayload> {
  if (!refresh) {
    const cached = (await env.CTI_SIGN_KV.get(MASTER_DATA_CACHE_KEY, 'json')) as MasterDataPayload | null
    if (cached) return cached
  }

  const token = await getZohoToken(env)
  const { records, truncated } = await fetchActiveCandidates(token)
  const data = records.map(mapSeafarer).filter((r) => r.fullName)
  const payload: MasterDataPayload = { source: 'zoho-recruit', count: data.length, truncated, data }
  await env.CTI_SIGN_KV.put(MASTER_DATA_CACHE_KEY, JSON.stringify(payload), { expirationTtl: MASTER_DATA_TTL_SECONDS })
  return payload
}
