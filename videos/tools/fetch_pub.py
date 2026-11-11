#!/usr/bin/env python3
"""fetch_pub.py: fetch published mp4s from the archive's main into DIR, no clone needed.

  python3 fetch_pub.py DIR NAME.mp4 [NAME_share.mp4 ...]     (looks in videos/out/, then videos/out/archive/)
  python3 fetch_pub.py --list [out|archive]                  (names on main, with sizes)
  python3 fetch_pub.py DIR videos/review/X/after/foo.mp4     (a name with a slash is a repo path)

Reads the LFS pointer through the GitHub contents API, then downloads through the LFS batch API
(git lfs pull hangs behind the proxy). Uses GH_TOKEN/GITHUB_TOKEN if set, else anonymous.
Skips files already in DIR, writes via .part, checks size. Exit 1 on any failure, with a message.
"""
import json, os, sys, urllib.request, urllib.error
REPO = os.environ.get("ARCH_REPO", "flip-engineer/automated-content-pipeline-video-studies-archive")
TOK = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")

def _req(url, data=None, headers=None):
    h = dict(headers or {})
    if TOK and "api.github.com" in url:
        h["Authorization"] = "Bearer " + TOK
    return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=120)

def contents(path):
    return json.load(_req(f"https://api.github.com/repos/{REPO}/contents/{path}?ref=main"))

def pointer(path):
    r = _req(f"https://api.github.com/repos/{REPO}/contents/{path}?ref=main", headers={"Accept": "application/vnd.github.raw"})
    t = r.read().decode("utf8", "replace")
    if "oid sha256:" not in t:
        raise RuntimeError(f"{path} is not an LFS pointer (stored directly?)")
    oid = [l.split(":")[1].strip() for l in t.splitlines() if l.startswith("oid")][0]
    size = int([l.split()[1] for l in t.splitlines() if l.startswith("size")][0])
    return oid, size

def fetch(path, dst):
    oid, size = pointer(path)
    body = json.dumps({"operation": "download", "transfers": ["basic"], "objects": [{"oid": oid, "size": size}]}).encode()
    r = json.load(_req(f"https://github.com/{REPO}.git/info/lfs/objects/batch", body,
                       {"Accept": "application/vnd.git-lfs+json", "Content-Type": "application/vnd.git-lfs+json"}))
    act = r["objects"][0].get("actions", {}).get("download")
    if not act:
        raise RuntimeError(f"no download action for {path}: {r['objects'][0].get('error')}")
    n = 0
    with urllib.request.urlopen(urllib.request.Request(act["href"], headers=act.get("header", {})), timeout=600) as resp, open(dst + ".part", "wb") as o:
        while True:
            b = resp.read(1 << 20)
            if not b:
                break
            o.write(b); n += len(b)
    if n != size:
        os.remove(dst + ".part")
        raise RuntimeError(f"{path}: got {n} bytes, expected {size}")
    os.rename(dst + ".part", dst)
    return size

def main(a):
    if a and a[0] == "--list":
        d = {"out": "videos/out", "archive": "videos/out/archive"}.get(a[1] if len(a) > 1 else "out", "videos/out")
        for e in contents(d):
            if e["type"] == "file":
                print(f'{e["size"]:>9}  {e["name"]}  (pointer bytes; real size via fetch)')
        return 0
    if len(a) < 2:
        print(__doc__); return 1
    out, bad = a[0], 0
    os.makedirs(out, exist_ok=True)
    for n in a[1:]:
        dst = os.path.join(out, os.path.basename(n))
        if os.path.exists(dst):
            print("have", n); continue
        paths = [n] if "/" in n else ["videos/out/" + n, "videos/out/archive/" + n]
        for p in paths:
            try:
                s = fetch(p, dst); print("ok", p, s // 1048576, "MB", flush=True); break
            except urllib.error.HTTPError as e:
                last = f"HTTP {e.code} for {p}"
            except Exception as e:
                last = f"{p}: {e}"; break
        else:
            pass
        if not os.path.exists(dst):
            print("FAIL", n, "-", last, file=sys.stderr); bad = 1
    return bad

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
