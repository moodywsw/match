#!/usr/bin/env python3
"""Delete all seeded test data: Storage files first (signed in as each test user, using the
passwords in TEST_ACCOUNTS.md), then rows via remove_test_data.sql.

Usage (repo root):  SUPABASE_ACCESS_TOKEN=... python3 supabase/seed/remove_test_data.py
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from seed_test_profiles import ANON, ROOT, URL, http, sql  # noqa: E402

acct = ROOT / "TEST_ACCOUNTS.md"
creds = re.findall(r"\|\s*(test\d+@match\.test)\s*\|\s*`([^`]+)`", acct.read_text()) if acct.exists() else []
if not creds:
    print("TEST_ACCOUNTS.md missing: photo files will be left in Storage (delete the folders in the dashboard).")
for email, pw in creds:
    try:
        _, s = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"email": email, "password": pw},
                    {"apikey": ANON, "Content-Type": "application/json"})
    except SystemExit as e:
        print(f"  skip {email}: {e}")
        continue
    h = {"apikey": ANON, "Authorization": f"Bearer {s['access_token']}", "Content-Type": "application/json"}
    uid = s["user"]["id"]
    for bucket in ("profile-photos", "story-media", "chat-media", "event-covers"):
        _, items = http("POST", f"{URL}/storage/v1/object/list/{bucket}", {"prefix": uid, "limit": 1000}, h)
        names = [f"{uid}/{i['name']}" for i in (items or []) if i.get("id")]
        if names:
            http("DELETE", f"{URL}/storage/v1/object/{bucket}", {"prefixes": names}, h)
            print(f"  {email}: deleted {len(names)} file(s) from {bucket}")
    http("POST", f"{URL}/auth/v1/logout", b"", {"apikey": ANON, "Authorization": h["Authorization"]}, raw=True)

out = sql((pathlib.Path(__file__).resolve().parent / "remove_test_data.sql").read_text())
print("after removal:", json.dumps(out))
print("You can now delete TEST_ACCOUNTS.md.")
