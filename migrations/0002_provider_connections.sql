create table if not exists provider_connections (
  id uuid primary key,
  provider text not null unique check (provider in ('OLLAMA_CLOUD', 'OPENAI_CODEX')),
  status text not null check (status in ('DISCONNECTED', 'AUTHORIZING', 'CONNECTED', 'ERROR')),
  credential_envelope jsonb,
  credential_version integer not null default 0 check (credential_version >= 0),
  plan_type text,
  model_catalog jsonb not null default '[]'::jsonb check (jsonb_typeof(model_catalog) = 'array'),
  catalog_digest text,
  last_verified_at timestamptz,
  failure_code text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (credential_envelope is null or credential_version > 0),
  check (status <> 'CONNECTED' or credential_envelope is not null),
  check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

alter table model_profiles add column if not exists provider_connection_id uuid;

do $$ begin
  alter table model_profiles
    add constraint model_profiles_provider_connection_fk
    foreign key (provider_connection_id) references provider_connections(id);
exception when duplicate_object then null;
end $$;

insert into schema_migrations (version, digest)
values ('0002', 'pointview-provider-connections-v1')
on conflict (version) do update set digest = excluded.digest;
