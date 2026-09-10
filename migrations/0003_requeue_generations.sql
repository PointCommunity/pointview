alter table feedback_records
  add column if not exists requeue_generation integer not null default 1;

alter table feedback_leases
  add column if not exists requeue_generation integer not null default 1;

do $$ begin
  alter table feedback_records
    add constraint feedback_records_requeue_generation_positive check (requeue_generation > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table feedback_leases
    add constraint feedback_leases_requeue_generation_positive check (requeue_generation > 0);
exception when duplicate_object then null;
end $$;

insert into schema_migrations (version, digest)
values ('0003', 'pointview-requeue-generations-v1')
on conflict (version) do update set digest = excluded.digest;
