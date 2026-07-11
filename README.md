# CTI Sign

A lightweight e-signature platform for CTI. Create a project, build a form from a
template PDF, map signature/date/text fields onto it, email a signer a unique link,
and collect a legally-formatted signed PDF back.

**Stack:** React + Vite + TypeScript + Tailwind · Supabase (Postgres, Storage, Auth,
Edge Functions) · Resend (email) · GitHub Pages (hosting).

```
Project ──< Form (template PDF + field map) ──< Record (one signing instance)
Draft → Sent → Viewed → Completed
```

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

### 3. Edge Functions (signer flow + email)
Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then:
```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy signing-session submit-signature send-signature-request
```
Set the email secrets (create a free account + API key at https://resend.com and
verify your sending domain there):
```bash
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set SIGN_FROM_EMAIL="CTI Sign <no-reply@cti-usa.com>"
```
> `signing-session` and `submit-signature` are public (token-gated);
> `send-signature-request` requires a staff login. This is set in
> [`supabase/config.toml`](supabase/config.toml) and applied on deploy.
> Until `RESEND_API_KEY` is set, "Send" still works — it just marks the record
> Sent and you share the copyable link manually.

### 4. Deploy to GitHub Pages
1. Push this repo to GitHub.
2. **Settings → Pages** → Source: **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables** → add repository variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Push to `main` → the workflow builds and deploys to
   `https://<org>.github.io/<repo>/`.

> **Signer deep links:** GitHub Pages has no server-side routing, so
> [`public/404.html`](public/404.html) restores SPA routes. If you deploy to a
> **custom domain at the root**, set `pathSegmentsToKeep = 0` in `404.html` and
> `VITE_BASE=/`.

---

## How it works
- **CTI staff** authenticate with Supabase Auth and manage projects/forms/records.
  Row Level Security restricts all tables to authenticated users.
- **Signers** are anonymous. They never touch the database — the browser calls two
  public Edge Functions gated by an unguessable per-record token:
  - `signing-session` returns the document, field map, and a 30-min signed URL to
    the template.
  - `submit-signature` stores the finished PDF (rendered in the signer's browser
    with `pdf-lib`) and marks the record Completed.
- **Email** goes out via `send-signature-request` → Resend.

## Field types
`signature`, `initials`, `name`, `date`, `email`, `text`. Geometry is stored
normalized (0..1) so it renders correctly at any zoom or screen size.
