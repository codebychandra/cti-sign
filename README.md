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

### 3b. OneDrive — per-project "Connect to OneDrive" (delegated OAuth)
Each project has its own **Connect to OneDrive** button (Template tab): a staff
member signs in with Microsoft, picks a destination folder, and from then on
every record marked **Complete** in that project auto-uploads its signed PDF
there. This uses the *same* Entra app registration as email (step 3a), with
two more things added:

1. **Authentication → add a platform → Web** (not "Single-page application" —
   the code exchange happens server-side, in the Edge Function, with the
   client secret) → redirect URI:
   `https://cti-sign.cti-athena.workers.dev/oauth/onedrive/callback`
   (or your own domain + `/oauth/onedrive/callback`).
2. **API permissions → Add → Microsoft Graph → Delegated permissions** →
   `Files.ReadWrite` and `offline_access` → grant admin consent (or each staff
   member consents individually the first time they click Connect).
3. Deploy the function and make sure the `MS_*` secrets from step 3a are set
   (it reuses them):
   ```bash
   supabase functions deploy onedrive-connect
   ```
4. The **client ID and tenant ID** (not secret) also need to reach the browser
   to build the Microsoft sign-in link — already baked into
   [`.env.production`](.env.production) as `VITE_MS_TENANT_ID` /
   `VITE_MS_CLIENT_ID`. Update those two if you ever rotate the app registration.

Storage: `onedrive_connections` (one row per project — refresh/access token,
chosen folder, connected account email). Tokens are only ever read/written by
the `onedrive-connect` function (service role); the frontend only ever
queries the non-secret columns. Disconnecting a project just deletes its row.

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
- `docs/deployment-notes.md` has a couple of operational notes worth reading
  before touching the project-detail tabs or the deploy pipeline.
- `supabase/functions/signing-session`, `submit-signature`, and
  `_shared/onedrive.ts` are leftover from an earlier design (superseded by the
  `get_signing_session`/`submit_signature` RPCs and the new `onedrive-connect`
  function respectively) — not called from the frontend, safe to remove later.
