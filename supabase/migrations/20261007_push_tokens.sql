-- Applied via Supabase MCP: push_tokens
-- Device Expo/FCM/APNs tokens for signed-in users (RLS: own rows only).

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  device_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.push_tokens enable row level security;
-- policies: select/insert/update/delete where auth.uid() = user_id
