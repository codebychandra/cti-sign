# CTI Sign

A lightweight e-signature platform for CTI. Create a project, build a form from a
template PDF, map signature/date/text fields onto it, email a signer a unique link,
and collect a legally-formatted signed PDF back.

**Stack:** React + Vite + TypeScript + Tailwind · Supabase (Postgres, Storage, Auth,
Edge Functions) · Microsoft Graph or Resend (email) · Cloudflare Workers (hosting).

```
Project ──< Form/Template (PDF + field map) ──< Record (one signing instance)
Draft → Sent → Viewed → Submitted → Completed
```
Projects can also run in **auto-populate** mode (no signer email/link — record
values are just filled in directly) instead of the default **send for signature** mode.

---

## Setup checklist

### 1. Supabase project
1. Create a free project at https://supabase.com.
2. **SQL Editor** → paste and run [`supabase/schema.sql`](supabase/schema.sql).
   (If the `storage.buckets` inserts are blocked, create two **private** buckets
   named `templates` and `signed` under Storage → Buckets, then re-run.)
3. **Project Settings → API** → copy the **Project URL** and the **anon public** key.

### 2. Local development
```bash
cp .env.example .env       # then fill in the two VITE_ values
npm install
npm run dev
```
Open the printed URL, create a staff account, and start building.
> Tip: In Supabase → Authentication → Providers → Email, turn **off** "Confirm email"
> for the fastest internal setup, or leave it on and confirm via the emailed link.

### 3. Signer flow (no CLI needed)
The signer-facing flow (open link → view document → sign → submit) runs entirely
through two Postgres RPC functions — `get_signing_session` / `submit_signature` —
deployed by running [`supabase/schema.sql`](supabase/schema.sql) and the files in
[`supabase/migrations/`](supabase/migrations) in the SQL Editor, same as step 1.
No Supabase CLI is required for the app to work end to end.

### 3a. Email (send-signature-request Edge Function)
Sending the actual "you've been asked to sign" email does use one Edge Function,
which needs the Supabase CLI to deploy:
```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy send-signature-request
```
It sends via **Microsoft Graph** (CTI's own mailbox) if the `MS_*` secrets below
are set, else falls back to **Resend** if `RESEND_API_KEY` is set, else just marks
the record Sent so you can share the link manually:
```bash
# Option A — Microsoft Graph (CTI mailbox)
supabase secrets set MS_TENANT_ID=...
supabase secrets set MS_CLIENT_ID=...
supabase secrets set MS_CLIENT_SECRET=...
supabase secrets set MS_SEND_FROM=cti-it-team@cti-usa.com

# Option B — Resend
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set SIGN_FROM_EMAIL="CTI Sign <no-reply@cti-usa.com>"
```
Microsoft Graph here needs the **`Mail.Send`** Application permission (Entra app
registration, admin-consented) — see 3b below for the same app registration steps,
just a different permission.

### 3b. (Not currently wired up) OneDrive / SharePoint auto-save
> ⚠️ **Status:** the OneDrive upload code exists (`supabase/functions/_shared/onedrive.ts`)
> but only runs inside the old `submit-signature` Edge Function, which the app no
> longer calls (signing now goes through the `submit_signature` RPC — see step 3).
> Setting the secrets below will **not** currently save completed PDFs to OneDrive
> until that upload call is ported into the RPC (or a Postgres trigger). Treat this
> section as a reference for a future fix, not a working feature yet.

Completed PDFs are always stored in Supabase. To *also* drop a copy into OneDrive
automatically, register an app in Microsoft Entra (Azure AD) — a Microsoft 365
admin does this once:
1. **Entra admin center → App registrations → New registration.** Name it "CTI Sign".
2. **API permissions → Add → Microsoft Graph → Application permissions →
   `Files.ReadWrite.All`** → then **Grant admin consent**.
3. **Certificates & secrets → New client secret** → copy the secret *value*.
4. **Overview** → copy the **Application (client) ID** and **Directory (tenant) ID**.
5. Set the Supabase secrets:
   ```bash
   supabase secrets set MS_TENANT_ID=...        # Directory (tenant) ID
   supabase secrets set MS_CLIENT_ID=...         # Application (client) ID
   supabase secrets set MS_CLIENT_SECRET=...     # secret value
   supabase secrets set ONEDRIVE_USER=cti-it-team@cti-usa.com   # OneDrive owner
   supabase secrets set ONEDRIVE_FOLDER="CTI Sign/Signed"       # optional
   ```
   For a SharePoint document library instead of a user's OneDrive, set
   `ONEDRIVE_SITE_ID=<site-id>` in place of `ONEDRIVE_USER`.

Until these are set, signing works normally — the OneDrive copy is simply skipped.
When set, each completed record also shows an "Open copy in OneDrive" link.

### 4. Deploy — Cloudflare Workers
**Live at: https://cti-sign.cti-athena.workers.dev/**

The app is hosted as a Cloudflare Workers static-assets site
([`wrangler.toml`](wrangler.toml)), built with `npm run build` (output: `dist/`)
and connected to this GitHub repo via Cloudflare's own Git integration — pushing
to `main` triggers a rebuild automatically; nothing in this repo's CI does it.
SPA routing (e.g. `/sign/:token` deep links) is handled natively by
`not_found_handling = "single-page-application"` in `wrangler.toml` — no extra
routing files needed. The Supabase URL/key are baked into the committed
[`.env.production`](.env.production) (public-safe values), so no separate
platform env-var setup is required either.

---

## How it works
- **CTI staff** authenticate with Supabase Auth and manage projects, templates,
  custom fields, and records. Row Level Security restricts all tables to
  authenticated users (any logged-in staff account has full access — see the
  security note below).
- **Signers** are anonymous. They never touch the database directly — the
  browser calls two Postgres RPC functions gated by an unguessable per-record
  token: `get_signing_session` (returns the document, field map, and any
  prefilled custom-field values) and `submit_signature` (stores the finished
  PDF, rendered in the signer's browser with `pdf-lib`, and moves the record to
  Submitted — a staff member then marks it Completed).
- **Email** goes out via the `send-signature-request` Edge Function → Microsoft
  Graph or Resend (see step 3a).

## Field types
Template fields (placed on the PDF): `signature`, `initials`, `text`,
`textarea`, `date`, `signed_date` (auto-filled the day the signer signs),
`number`, `email`. Any non-signature field can also be **mapped to a project
custom field** so its value is pulled from/saved to that record's custom-field
column instead of being typed fresh each time. Geometry is stored normalized
(0..1) so it renders correctly at any zoom or screen size.

Project-level custom fields (columns shown in the Completed table): `text`,
`date`, `number`, `email`, `auto_number` (auto-incrementing with an optional
prefix), `single_dropdown`, `multi_dropdown`.

## Known gaps
- **OneDrive auto-save is not wired up** — see the warning in step 3b.
- `docs/deployment-notes.md` has a couple of operational notes worth reading
  before touching the project-detail tabs or the deploy pipeline.
