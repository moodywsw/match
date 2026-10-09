-- Marks seeded QA/demo accounts (see supabase/seed/README.md).
-- Not granted to clients (profiles uses column-level grants), so it never
-- reaches the app; it only lets operators find and remove test data.
alter table public.profiles add column if not exists is_test boolean not null default false;
comment on column public.profiles.is_test is 'Seeded test account (emails @match.test). Remove with supabase/seed/remove_test_data.sql.';
create index if not exists profiles_is_test_idx on public.profiles (id) where is_test;
