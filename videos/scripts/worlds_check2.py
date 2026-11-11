"""WORLDS studio c1 pass 2: the pass-1 checks (worlds_check.py: camera maths, render speed) on the pass-2 stills, with the
page's own stage timings.

    python3 videos/scripts/worlds_check2.py videos/review/studio_worlds_c1/after/r2
      -> prints a table and writes <dir>/checks2.json

Depth, the horizon, foreground detail, highlights and parallax are judged on the stills and clips, by eye.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worlds_check import check  # noqa: E402


def check2(path, c1dir=None):
    out = check(path)
    meta = path[:-4] + ".json"
    info = json.load(open(meta)) if os.path.exists(meta) else {}
    out["wall_ms"] = info.get("wallMs")
    out["cloud_ms"] = (info.get("stages") or {}).get("mid")
    return out


if __name__ == "__main__":
    d = sys.argv[1]
    rows = []
    for f in sorted(os.listdir(d)):
        if f.endswith(".jpg") and f.startswith("shot") and "_f" not in f:
            rows.append(check2(os.path.join(d, f)))
    for r in rows:
        print(f"{r['file']:<14} ms={r.get('wall_ms')} cloud_ms={r.get('cloud_ms')} scale_ok={r.get('scale_pass')}")
    json.dump({"stills": rows}, open(os.path.join(d, "checks2.json"), "w"), indent=1)
