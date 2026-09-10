alter table if exists feedback_leases drop column if exists requeue_generation;
alter table if exists feedback_records drop column if exists requeue_generation;
