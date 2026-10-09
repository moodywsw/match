#!/usr/bin/env python3
"""Seed ~12 clearly-marked TEST profiles + demo scenarios for an admin account.

Usage (from repo root):
    SUPABASE_ACCESS_TOKEN=... python3 supabase/seed/seed_test_profiles.py [admin_email]

What it does (see supabase/seed/README.md):
  * DB writes go through the Supabase Management API SQL endpoint (server side).
  * Photo uploads sign in AS each test user with the public anon key, so Storage
    and `photos` RLS are exercised exactly like the app. No service-role key used.
  * Passwords are random and written ONLY to TEST_ACCOUNTS.md at the repo root
    (git-ignored). Re-running requires removing test data first.
"""
import datetime as dt
import json
import os
import pathlib
import secrets
import string
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SCENARIOS_ONLY = "--scenarios-only" in sys.argv  # retry step 3 against already-seeded users
ADMIN_EMAIL = (ARGS[0] if ARGS else "jojoamber1993@gmail.com").lower()
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
ENV = {}
for line in (ROOT / "apps/mobile/.env").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1)
        ENV[k.strip()] = v.strip().strip('"')
URL = ENV["EXPO_PUBLIC_SUPABASE_URL"].rstrip("/")
ANON = ENV["EXPO_PUBLIC_SUPABASE_ANON_KEY"]
REF = URL.split("//")[1].split(".")[0]
if not TOKEN:
    sys.exit("SUPABASE_ACCESS_TOKEN is required")

# Photos: i.pravatar.cc serves Unsplash photos (Unsplash License: free to use, no attribution required).
PHOTO = "https://i.pravatar.cc/800?img={}"

# key, name, gender, age, city, lat, lng, intention, interested_in, verified, joined_days, photo, interests, bio, friday
PEOPLE = [
    ("ines", "Inês", "woman", 27, "Lisbon", 38.7114, -9.1300, "serious", ["men", "women"], True, 12, 5,
     ["Jazz", "Wine", "Travel", "Photography", "Indie"],
     "Architect by day, amateur ceramicist by night. Looking for someone to get lost in Alfama with.",
     "Sunset at a miradouro with a good bottle of wine"),
    ("marta", "Marta", "woman", 24, "Lisbon", 38.7290, -9.1340, "casual", ["everyone"], False, 3, 16,
     ["Techno", "House", "Coffee", "Nightlife", "Gym"],
     "Med student running on galão and techno. Will absolutely out-dance you.",
     "Dancing at Lux until the sun comes up"),
    ("beatriz", "Beatriz", "woman", 31, "Cascais", 38.6979, -9.4215, "serious", ["men"], True, 20, 26,
     ["Beach", "Reading", "Sushi", "Yoga", "Indie"],
     "Surf mornings, book club evenings. Currently reading three books at once and finishing none.",
     "Bonfire on the beach with my closest friends"),
    ("sofia", "Sofia", "woman", 29, "Lisbon", 38.7166, -9.1489, "new_people", ["everyone"], True, 35, 32,
     ["Portuguese", "Cooking", "Cinema", "Concerts", "Travel"],
     "Moved down from Porto last year. Show me your favourite tasca and I'll show you how to make a proper francesinha.",
     "Trying a new restaurant with someone who orders dessert first"),
    ("carolina", "Carolina", "woman", 35, "Oeiras", 38.6970, -9.3090, "figuring_out", ["men", "women"], False, 8, 45,
     ["Pop", "Gaming", "Pets", "Comedy", "Coffee"],
     "UX designer, plant hoarder, karaoke menace. My dog Pastel has final approval.",
     "Karaoke night, I'm doing ABBA, you're doing backing vocals"),
    ("joana", "Joana", "woman", 22, "Almada", 38.6790, -9.1569, "casual", ["everyone"], False, 2, 27,
     ["Cinema", "Documentaries", "Rock", "Street food", "Fashion"],
     "Film student. Yes, I will judge your Letterboxd. Gently.",
     "Indie film at Cinema Ideal, then bar hopping in Cais do Sodré"),
    ("tiago", "Tiago", "man", 28, "Lisbon", 38.7369, -9.1427, "serious", ["women", "everyone"], True, 15, 12,
     ["Cooking", "Jazz", "Hiking", "Wine", "Sci-fi"],
     "Software engineer who cooks better than he codes. Ask me about my bacalhau à Brás.",
     "Cooking dinner for friends with a playlist that slaps"),
    ("rui", "Rui", "man", 33, "Lisbon", 38.7139, -9.1600, "serious", ["women"], False, 25, 13,
     ["Hiking", "Classical", "Coffee", "Reading", "Travel"],
     "Furniture maker and cyclist. Terrible at small talk, great at long talks.",
     "Quiet dinner and a long walk along the river"),
    ("miguel", "Miguel", "man", 26, "Lisbon", 38.7130, -9.1450, "casual", ["everyone"], True, 6, 51,
     ["Jazz", "R&B", "Live concerts", "Street food", "Fashion"],
     "Saxophone player. Yes, I'll play at your cousin's wedding. No, not Careless Whisper.",
     "Live jazz at Hot Clube, then late-night bifanas"),
    ("duarte", "Duarte", "man", 30, "Cascais", 38.7050, -9.3980, "new_people", ["women"], False, 30, 53,
     ["Beach", "Fitness", "Reggaeton", "Burgers", "Travel"],
     "Kitesurf instructor. Sunburnt all year round. Will teach you to stand on a board, no promises after that.",
     "Sunset beers at a beach bar in Guincho"),
    ("andre", "André", "man", 38, "Lisbon", 38.7480, -9.1530, "serious", ["women"], True, 40, 59,
     ["Hiking", "Documentary", "Italian", "Reading", "Pets"],
     "Secondary school teacher, dad-joke specialist, weekend hiker in Sintra.",
     "Board games and homemade pizza with friends"),
    ("alex", "Alex", "non_binary", 25, "Lisbon", 38.7250, -9.1500, "figuring_out", ["everyone"], False, 10, 48,
     ["Indie", "Photography", "Vegan", "Electronic", "Fashion"],
     "Illustrator. Collector of tiny zines and big opinions. They/them.",
     "Gallery opening, then dumplings in Martim Moniz"),
]


def http(method, url, body=None, headers=None, raw=False):
    data = body if (raw or body is None) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read()
            return r.status, (json.loads(txt) if txt and not raw else txt)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {url.split('?')[0]} -> HTTP {e.code}: {e.read()[:500]!r}")


def sql(query):
    _, res = http("POST", f"https://api.supabase.com/v1/projects/{REF}/database/query", {"query": query},
                  {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json",
                   "User-Agent": "match-seed/1.0"})
    return res


def jlit(obj):
    s = json.dumps(obj, ensure_ascii=False)
    assert "$J$" not in s
    return f"$J${s}$J$::jsonb"


def password():
    alphabet = string.ascii_letters + string.digits + "!@#%^*-_=+"
    while True:
        p = "".join(secrets.choice(alphabet) for _ in range(20))
        if any(c.islower() for c in p) and any(c.isupper() for c in p) and any(c.isdigit() for c in p) \
                and any(not c.isalnum() for c in p):
            return p


def birth(age, i):
    t = dt.date.today()
    # birthday already passed this year (30-330 days ago) so the shown age is exactly `age`
    return dt.date(t.year - age, t.month, min(t.day, 28)) - dt.timedelta(days=30 + (37 * i) % 300)


def main():
    existing = sql("select count(*)::int n from auth.users where email like '%@match.test'")[0]["n"]
    if SCENARIOS_ONLY:
        rows = sql("select u.email, u.id from auth.users u where u.email like 'test%@match.test'")
        by_email = {r["email"]: r["id"] for r in rows}
        admin_id = sql(f"select id from auth.users where lower(email) = '{ADMIN_EMAIL}'")[0]["id"]
        ids = {p[0]: by_email[f"test{i}@match.test"] for i, p in enumerate(PEOPLE, start=1)}
        run_scenarios(ids, admin_id)
        return
    if existing:
        sys.exit(f"{existing} @match.test users already exist. Run the removal first (supabase/seed/README.md).")
    admin = sql(f"select id from auth.users where lower(email) = '{ADMIN_EMAIL}'")
    if not admin:
        sys.exit(f"admin {ADMIN_EMAIL} not found")
    admin_id = admin[0]["id"]

    people = []
    for i, p in enumerate(PEOPLE, start=1):
        (key, name, gender, age, city, lat, lng, intention, pref, verified, joined, photo, interests, bio, friday) = p
        people.append(dict(key=key, n=i, id=str(uuid.uuid4()), email=f"test{i}@match.test", password=password(),
                           name=name, gender=gender, age=age, birth=birth(age, i).isoformat(), city=city, lat=lat,
                           lng=lng, intention=intention, pref=pref, verified=verified, joined=joined, photo=photo,
                           interests=interests, bio=bio, friday=friday))

    # ---- 1. auth users + profiles (server side) ------------------------------------------
    sql(f"""
do $seed$
declare j jsonb := {jlit(people)}; p jsonb; v uuid;
begin
  for p in select * from jsonb_array_elements(j) loop
    v := (p->>'id')::uuid;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token,
      reauthentication_token, is_sso_user, is_anonymous)
    values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated', p->>'email',
      extensions.crypt(p->>'password', extensions.gen_salt('bf', 10)), now(),
      '{{"provider":"email","providers":["email"]}}'::jsonb,
      jsonb_build_object('test_account', true, 'name', p->>'name'),
      now() - make_interval(days => (p->>'joined')::int), now(), '', '', '', '', '', '', '', '', false, false);
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v::text, v,
      jsonb_build_object('sub', v::text, 'email', p->>'email', 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now());
    insert into public.profiles (id, name, birth_date, gender, interested_in, city, intention, bio, friday_answer,
      verified, onboarding_complete, is_discoverable, is_test, created_at)
    values (v, p->>'name', (p->>'birth')::date, p->>'gender',
      array(select jsonb_array_elements_text(p->'pref')), p->>'city', p->>'intention', p->>'bio', p->>'friday',
      (p->>'verified')::boolean, true, true, true, now() - make_interval(days => (p->>'joined')::int));
    insert into public.user_interests (user_id, interest_id)
      select v, i.id from public.interests i where i.label in (select jsonb_array_elements_text(p->'interests'));
    insert into private.user_locations (user_id, cell_lat, cell_lng, updated_at)
      select v, c.cell_lat, c.cell_lng, now() from private.snap_cell((p->>'lat')::float8, (p->>'lng')::float8, 1.5) c;
  end loop;
end $seed$;""")
    print(f"created {len(people)} auth users + profiles")
    write_accounts(people)  # right away, so credentials are never lost if a later step fails

    # ---- 2. photos: sign in as each user, upload with their JWT (RLS applies) ---------------
    for p in people:
        _, sess = http("POST", f"{URL}/auth/v1/token?grant_type=password",
                       {"email": p["email"], "password": p["password"]},
                       {"apikey": ANON, "Content-Type": "application/json"})
        jwt = sess["access_token"]
        _, img = http("GET", PHOTO.format(p["photo"]), headers={"User-Agent": "match-seed/1.0"}, raw=True)
        path = f"{p['id']}/{int(time.time() * 1000)}.jpg"
        http("POST", f"{URL}/storage/v1/object/profile-photos/{path}", img,
             {"apikey": ANON, "Authorization": f"Bearer {jwt}", "Content-Type": "image/jpeg",
              "x-upsert": "false"}, raw=True)
        http("POST", f"{URL}/rest/v1/photos",
             {"user_id": p["id"], "url": f"{URL}/storage/v1/object/public/profile-photos/{path}",
              "position": 0, "is_primary": True},
             {"apikey": ANON, "Authorization": f"Bearer {jwt}", "Content-Type": "application/json",
              "Prefer": "return=minimal"})
        http("POST", f"{URL}/auth/v1/logout", b"", {"apikey": ANON, "Authorization": f"Bearer {jwt}"}, raw=True)
        print(f"  photo ok: {p['email']} ({p['name']})")

    # ---- 3. scenarios ----------------------------------------------------------------------
    run_scenarios({p["key"]: p["id"] for p in people}, admin_id)


def run_scenarios(ids, admin_id):
    scen = (ROOT / "supabase/seed/scenarios.sql").read_text()
    scen = scen.replace("'__IDS__'::jsonb", jlit(ids)).replace("'__ADMIN__'::uuid", f"'{admin_id}'::uuid")
    out = sql(scen)
    print("scenarios:", json.dumps(out, ensure_ascii=False, indent=1))


def write_accounts(people):
    acct_file = ROOT / "TEST_ACCOUNTS.md"

    lines = ["# Match TEST accounts (local only, never commit)", "",
             f"Seeded {dt.datetime.now():%Y-%m-%d %H:%M} for admin {ADMIN_EMAIL}. "
             "All rows are flagged `profiles.is_test = true`. Remove with supabase/seed/README.md.", "",
             "| # | Email | Password | Name | Gender | Age | City | Intention | Role in demo |",
             "|---|---|---|---|---|---|---|---|---|"]
    roles = {"ines": "Match 26h ago, no messages: starters nudge", "tiago": "Silent match: EXPIRING timer",
             "miguel": "11+11 messages: video call suggestion", "rui": "Marked 'We met': confirm + feedback",
             "duarte": "Expired match (Archived)", "beatriz": "Brand-new match (20 min ago)",
             "marta": "Liked you", "joana": "Liked you", "carolina": "Super liked you",
             "sofia": "Today's pick with 'Real photos' trust badge", "andre": "Today's pick",
             "alex": "Today's pick"}
    for p in people:
        lines.append(f"| {p['n']} | {p['email']} | `{p['password']}` | {p['name']} | {p['gender']} | {p['age']} | "
                     f"{p['city']} | {p['intention']} | {roles.get(p['key'], '')} |")
    acct_file.write_text("\n".join(lines) + "\n")
    os.chmod(acct_file, 0o600)
    print(f"wrote {acct_file}")


if __name__ == "__main__":
    main()
