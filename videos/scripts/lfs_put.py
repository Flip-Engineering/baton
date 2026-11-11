#!/usr/bin/env python3
"""Upload files to the archive's Git LFS store and print each one's pointer blob text.

  python3 videos/scripts/lfs_put.py FILE [FILE ...]      -> for each file: "<oid> <size>" on stdout, after the upload

The archive (flip-engineer/automated-content-pipeline-video-studies-archive) keeps videos/out/**/*.mp4 in LFS. `git lfs push` stalls behind
this machine's proxy, so publish.sh uploads through the LFS batch API and commits pointer files straight to main. The GitHub CLI supplies
the API credential when an importer has not supplied an Authorization header. An object the store already has comes back with no upload action
and is skipped.
"""
import base64, hashlib, json, os, subprocess, sys, urllib.request
from urllib.parse import urlsplit

BATCH = "https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive.git/info/lfs/objects/batch"
H = {"Accept": "application/vnd.git-lfs+json", "Content-Type": "application/vnd.git-lfs+json"}


class _File:
    """A file object urllib can stream from (no whole-file read into memory)."""
    def __init__(self, path):
        self.f = open(path, "rb")
        self.len = os.path.getsize(path)

    def read(self, n=-1):
        return self.f.read(n if n and n > 0 else 1 << 20)

    def __len__(self):
        return self.len


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def api_headers():
    """Copy importer headers and add the GitHub CLI credential when absent."""
    headers = dict(H)
    if _header_value(headers, "Authorization") is None:
        try:
            token = subprocess.check_output(["gh", "auth", "token"], text=True,
                                            stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.CalledProcessError):
            raise RuntimeError("lfs_put: GitHub CLI authentication is unavailable") from None
        if not token:
            raise RuntimeError("lfs_put: GitHub CLI authentication returned an empty token")
        headers["Authorization"] = "Basic " + base64.b64encode(("x-access-token:" + token).encode()).decode()
    return headers


def _header_value(headers, name):
    return next((value for key, value in headers.items() if key.lower() == name.lower()), None)


def _merge_headers(base, overrides):
    result = dict(base)
    for name, value in overrides.items():
        for existing in list(result):
            if existing.lower() == name.lower():
                del result[existing]
        result[name] = value
    return result


def _same_origin(left, right):
    a, b = urlsplit(left), urlsplit(right)
    if not a.scheme or not a.hostname or not b.scheme or not b.hostname:
        return False
    def port(url):
        return url.port or (443 if url.scheme.lower() == "https" else 80 if url.scheme.lower() == "http" else None)
    return (a.scheme.lower(), a.hostname.lower(), port(a)) == (b.scheme.lower(), b.hostname.lower(), port(b))


def verify_headers(action_headers, batch_headers, verify_href):
    action_headers = dict(action_headers or {})
    base_headers = {name: value for name, value in H.items() if name.lower() != "authorization"}
    result = _merge_headers(base_headers, action_headers)
    has_action_auth = _header_value(action_headers, "Authorization") is not None
    if not has_action_auth and _same_origin(verify_href, BATCH):
        batch_auth = _header_value(batch_headers, "Authorization")
        if batch_auth is not None:
            result = _merge_headers(result, {"Authorization": batch_auth})
    return result


def put(path):
    oid, size = sha256(path), os.path.getsize(path)
    body = json.dumps({"operation": "upload", "transfers": ["basic"], "objects": [{"oid": oid, "size": size}]}).encode()
    headers = api_headers()
    r = json.load(urllib.request.urlopen(urllib.request.Request(BATCH, data=body, headers=headers), timeout=60))
    o = r["objects"][0]
    if o.get("error"):
        raise SystemExit(f"lfs_put: {path}: {o['error']}")
    acts = o.get("actions") or {}
    if "upload" in acts:
        u = acts["upload"]
        hdr = dict(u.get("header", {}), **{"Content-Length": str(size), "Content-Type": "application/octet-stream"})
        for attempt in range(4):
            try:
                urllib.request.urlopen(urllib.request.Request(u["href"], data=_File(path), method="PUT", headers=hdr), timeout=1800)
                break
            except Exception as e:  # network hiccup: retry with backoff
                if attempt == 3:
                    raise
                print(f"lfs_put: retry {path}: {e}", file=sys.stderr)
                import time; time.sleep(2 ** (attempt + 1))
        if "verify" in acts:
            v = acts["verify"]
            urllib.request.urlopen(urllib.request.Request(v["href"], data=json.dumps({"oid": oid, "size": size}).encode(),
                                                          method="POST", headers=verify_headers(v.get("header", {}), headers, v["href"])), timeout=60)
        print(f"lfs_put: uploaded {os.path.basename(path)} ({size >> 20} MB)", file=sys.stderr)
    else:
        print(f"lfs_put: already stored {os.path.basename(path)}", file=sys.stderr)
    return oid, size


if __name__ == "__main__":
    for p in sys.argv[1:]:
        oid, size = put(p)
        print(oid, size, flush=True)
