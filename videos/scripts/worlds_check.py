"""WORLDS studio c1 checks on the reel stills: the camera maths and the render speed.

    python3 videos/scripts/worlds_check.py videos/review/studio_worlds_c1/after
      -> prints a table and writes <dir>/checks.json

Per still <tag>.jpg (+ <tag>.json written by worlds_reel.mjs):
  scale       measured on-screen height of known objects vs the pinhole maths (within 10 %: a wrong camera or unit is a bug)
  speed       wall ms per frame (render + readback) from the page, against a 3 s budget
How a world looks (its light, its depth, whether its lights read as a lattice) is judged on the stills and the sheets
(worlds_sheet.py), by eye.
"""
import json
import os
import sys


def check(path, grid=False):
    """grid: ignored (kept for old callers)."""
    out = {"file": os.path.basename(path)}
    meta = path[:-4] + ".json"
    if os.path.exists(meta):
        info = json.load(open(meta))
        sc = [s for s in (info.get("scale") or []) if isinstance(s, dict) and "errPct" in s]
        out["scale"] = sc
        out["scale_pass"] = all(abs(s["errPct"]) <= 10 for s in sc) if sc else None
        out["wall_ms"] = info.get("wallMs") or info.get("wallMsPerFrame")
        out["speed_pass"] = out["wall_ms"] is not None and out["wall_ms"] <= 3000
    return out


if __name__ == "__main__":
    d = sys.argv[1]
    rows = []
    for f in sorted(os.listdir(d)):
        if f.endswith(".jpg") and not f.startswith(("SHEET", "PAIR", "BEFORE")) and "_f" not in f:
            rows.append(check(os.path.join(d, f)))
    for r in rows:
        sc = " ".join(f"{s['label']}:{s['measuredPx']}/{s['expectPx']}px({s['errPct']:+.1f}%)" for s in r.get("scale") or [])
        print(f"{r['file']:<22} ms={r.get('wall_ms')} {sc}")
    json.dump(rows, open(os.path.join(d, "checks.json"), "w"), indent=1)
