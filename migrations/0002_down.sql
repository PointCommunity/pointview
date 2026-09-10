alter table if exists model_profiles drop constraint if exists model_profiles_provider_connection_fk;
alter table if exists model_profiles drop column if exists provider_connection_id;
drop table if exists provider_connections cascade;
