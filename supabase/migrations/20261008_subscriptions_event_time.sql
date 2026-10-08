-- Webhook events can arrive out of order; keep the timestamp of the newest
-- applied event so older ones never overwrite newer state.
alter table public.subscriptions add column if not exists last_event_at timestamptz;
