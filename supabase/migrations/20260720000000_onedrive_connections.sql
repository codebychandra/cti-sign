-- Per-project OneDrive connection (delegated OAuth), used to auto-save
-- completed signed PDFs into a folder the connecting staff member picked.
create table if not exists onedrive_connections (
  project_id    uuid primary key references projects(id) on delete cascade,
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  folder_id     text,
  folder_path   text,
  account_email text,
  connected_by  uuid references auth.users(id) on delete set null,
  connected_at  timestamptz not null default now()
);

alter table onedrive_connections enable row level security;

-- Same single-org trust model as every other table here: any authenticated
-- staff member can manage any project's connection. Tokens are only ever
-- read/written by the JWT-protected onedrive-connect Edge Function using the
-- service role — the frontend never reads refresh_token/access_token directly
-- (it only ever sees folder_path/account_email via the function's responses).
drop policy if exists staff_all on onedrive_connections;
create policy staff_all on onedrive_connections for all to authenticated using (true) with check (true);

alter table records add column if not exists onedrive_uploaded_at timestamptz;
