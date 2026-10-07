# Match

Dating / social app (taste & personality-first) backed by Supabase.

## Supabase

- Project: **Match**
- Ref: `pkpdheytmbwvqhpcaigm`
- Region: `eu-west-1`
- API URL: `https://pkpdheytmbwvqhpcaigm.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/pkpdheytmbwvqhpcaigm

## Stack

- Vite + React 18
- `@supabase/supabase-js` (Auth + Postgres via RLS)
- Lucide icons

## Setup

```bash
cp .env.example .env
# put the project's anon/publishable key in VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Env vars (never commit real keys — `.env` is gitignored):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (legacy anon JWT or `sb_publishable_…`)

## What is wired

- **Auth**: email/password sign-up & sign-in (Supabase Auth)
- **Profile**: load / upsert `public.profiles` after onboarding; save from Profile tab
- **Discovery**: reads discoverable profiles from Supabase; falls back to mock cards when empty
- **Likes**: inserts into `public.likes` for real UUID profiles (match trigger runs in DB)

Still mock / local UI: social feed, live rooms, events, chat transcripts (until those tables have data).

## Repo layout

- `schema.sql` — production Postgres schema with RLS
- `src/MatchApp.jsx` — main UI
- `src/lib/supabase.js` — browser client (anon key only)
- `src/lib/profile.js` — profile / discovery / likes helpers
- `src/types/database.ts` — generated Supabase types

## Scripts

- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run preview` — preview build
