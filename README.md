# Match

Dating / social app prototype (taste & personality-first) backed by Supabase.

## Supabase

- Project: **Match**
- Ref: `pkpdheytmbwvqhpcaigm`
- Region: `eu-west-1`
- API URL: `https://pkpdheytmbwvqhpcaigm.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/pkpdheytmbwvqhpcaigm

## Repo layout

- `schema.sql` — production Postgres schema with RLS policies
- `MatchApp.jsx` — single-file React UI prototype (local/mock data)

## Next steps

1. Wire `MatchApp.jsx` to the Supabase client (Auth + tables).
2. Track schema changes as migrations under `supabase/migrations`.
3. Add publishable keys via env vars (never commit secrets).
