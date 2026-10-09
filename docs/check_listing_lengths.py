"""Checks the Play listing limits in docs/PLAY_LISTING.md (title ≤30, short ≤80, full ≤4000)."""
import pathlib, re, sys

text = pathlib.Path(__file__).with_name("PLAY_LISTING.md").read_text(encoding="utf-8")
ok = True
for lang, sec in (("EN", text.split("## 2.")[0]), ("PT", text.split("## 2.")[1].split("## 3.")[0])):
    title = re.search(r"\(≤ 30\):\*\* `([^`]+)`", sec).group(1)
    blocks = re.findall(r"```\n(.*?)\n```", sec, re.S)
    short, full = blocks[0], blocks[1]
    for name, val, lim in (("title", title, 30), ("short", short, 80), ("full", full, 4000)):
        n = len(val)
        flag = "OK " if n <= lim else "TOO LONG"
        ok &= n <= lim
        print(f"{lang} {name:5} {n:5}/{lim} {flag}")
sys.exit(0 if ok else 1)
