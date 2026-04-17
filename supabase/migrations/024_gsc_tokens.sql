  -- GSC OAuth tokens storage (singleton pattern — only one row, id='singleton')
  -- Consumed by packages/ui-alquilatucarro/server/utils/gsc.ts via service role key.
  -- Tokens are sensitive (OAuth refresh tokens) — no anon access.

  create table gsc_tokens (
    id text primary key,
    access_token text not null,
    refresh_token text,
    expires_at bigint not null, -- unix ms epoch
    token_type text not null default 'Bearer',
    scope text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  -- Enable RLS. No policies = anon and authenticated cannot access.
  -- service_role bypasses RLS → only trusted server code can read/write.
  alter table gsc_tokens enable row level security;

  -- Auto-update updated_at on row updates
  create or replace function set_updated_at()
  returns trigger
  language plpgsql
  as $$
  begin
    new.updated_at := now();
    return new;
  end;
  $$;

  create trigger gsc_tokens_updated_at
    before update on gsc_tokens
    for each row execute function set_updated_at();
