#!/usr/bin/env python3
"""field_find: find and fetch real recordings of a concept's world (machines, engines, motors, mills, power, crowds,
horses, tools, clocks ...) for a concept palette (engine/daw/palette.py).  MUSIC c13.

Why: `audio_find.py` is a speech-phrase finder; asked for machine field recordings it returns audiobooks.  The library's
own machine world is 4.9 minutes of mostly sub-2-second clips (c13 critic's survey).  This indexes, track by track, the
USC Cinema "Red Library" and "GOLD TAPE" sound-effects collections (Sunset Editorial) on archive.org: about 117 items,
3,000+ tracks, almost all labelled CC0 1.0 per item (the licence is read from each item and recorded with every fetch;
a track from an item without a CC0/PD licence URL is listed but refused by `fetch` unless --any-licence).  Many are long
continuous takes: "Ascending and Descending Motor Pitch" (71 s), "Single Cylinder Engine" (50 s), "Textile Machine",
"Mechanical Machine Start Up", "Truck Accelerations" (88 s), "Electrical Buzzing" (102 s), "Thresher" (94 s) ...

    python3 tools/field_find.py index                    # build/refresh the track index (cached, ~0.5 MB, 2-3 min once)
    python3 tools/field_find.py search engine motor accelerat --min 10 [--max 120] [--n 40]
    python3 tools/field_find.py fetch "GOLD_TAPE_40_Motors/G40-15-Single Cylinder Engine" --out DIR [--from 3 --to 40]
                                                         # -> DIR/<slug>.wav (44.1 kHz mono) + DIR/sources.json (provenance)
                                                         # a spoken slate at the head ("screwdriver on metal") is found with
                                                         # faster-whisper and cut (--keep-slate keeps it)

Search is plain word matching on track titles, item names and a small thesaurus of concept words (a word like
"engine" also matches motor, diesel, truck, cylinder, idle ...).  It ranks by matches, then by length (longer takes
first: a palette wants continuous material).  It only reads public listings; nothing is downloaded until `fetch`.

radio aporee ::: maps on archive.org (MUSIC c14): located field recordings, many minutes long, real plants and machines
(a swing hammer in a Piedmont workshop, a steel press in Kitakyushu, rails moved by a magnetic crane in Brandenburg, a
hydro turbine, a factory steam whistle, a weaving machine in Lodz).  The licence is applied by each uploader, so it is read
per item and recorded; only the public-domain mark, CC0 and CC-BY pass (BY-SA, NC and ND are refused unless --any-licence).
`fetch-item` reads only the span asked for, straight from archive.org (ffmpeg seeks the remote file), so a 13-minute
recording costs the disk only its cut.

    python3 tools/field_find.py aporee hammer forge turbine loom whistle --n 30     # live search, licence-filtered
    python3 tools/field_find.py fetch-item aporee_71917_83985 --from 6 --to 50 --out DIR --name swing_hammer [--flac]

Other sources, and why they're not here (yet):
  - Freesound (CC0 / CC-BY, tags, durations): the API needs a key.  With FREESOUND_API_KEY set, `search --freesound`
    queries it too (licence filter CC0 + Attribution); fetching its originals needs OAuth, so the tool prints the page.
  - NPS sound gallery (public domain): small, mostly nature.  Not indexed.
  - BBC Sound Effects (RemArc licence): personal, educational and research use only.  NOT usable for publishing.
  - Public-domain industrial films with sync sound (Prelinger, archive.org): the machine sound sits under narration;
    pulling it out needs source separation (HTDemucs), GPU work.  `video_find.py` finds the films.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
INDEX = os.path.join(VIDEOS, "sources", "audio", "field_index.json")
FF = os.environ.get("FFMPEG", "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2")
SEARCH = "https://archive.org/advancedsearch.php"
META = "https://archive.org/metadata/"
DL = "https://archive.org/download/"
COLLECTION_Q = "identifier:(Red_Library* OR GOLD_TAPE*)"
FREE = ("publicdomain", "/zero/")

# concept words -> what titles in these collections actually say
THESAURUS = {
    "engine": ["engine", "motor", "diesel", "cylinder", "idle", "idling", "truck", "sputter", "rev", "start up", "starts"],
    "motor": ["motor", "engine", "electric motor", "vari-speed", "running"],
    "accelerat": ["accelerat", "ascending", "speed", "start up", "starts", "speedup", "revving", "away"],
    "machine": ["machine", "machines", "factory", "mechanical", "conveyor", "textile", "press", "industrial"],
    "mill": ["mill", "thresher", "textile", "loom", "saw", "grind"],
    "governor": ["governor", "steady motor", "steam engine", "regulat"],
    "power": ["electric", "electrical", "buzz", "hum", "transformer", "generator", "dynamo", "discharge", "arc"],
    "hum": ["hum", "buzz", "drone", "steady"],
    "assemble": ["ratchet", "wrench", "screw", "bolt", "hammer", "clank", "metal", "tools", "latch"],
    "metal": ["metal", "clank", "clang", "anvil", "steel", "chain", "pipe"],
    "steam": ["steam", "hiss", "air", "whistle", "locomotive", "catapult"],
    "train": ["train", "locomotive", "rail", "trolley", "steam"],
    "crowd": ["crowd", "crowds", "voices", "applause", "cheer", "men"],
    "horse": ["horse", "horses", "hooves", "gallop", "trot", "wagon"],
    "clock": ["clock", "tick", "timer", "chime"],
    "rhythm": ["rhythmic", "tick", "clicks", "stamping", "pump", "pumping", "clatter", "clattering"],
}


def _get(url, timeout=60, tries=4):
    last = None
    for k in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "acp-studio field_find"}),
                                          timeout=timeout).read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (k + 1))
    raise RuntimeError(f"{url}: {last}")


def build_index(verbose=True):
    q = urllib.parse.urlencode({"q": COLLECTION_Q, "fl[]": "identifier", "rows": 1000, "output": "json"})
    ids = sorted(d["identifier"] for d in json.loads(_get(f"{SEARCH}?{q}"))["response"]["docs"])
    rows = []
    for i, ident in enumerate(ids):
        try:
            d = json.loads(_get(META + ident))
        except Exception as e:  # noqa: BLE001
            print(f"  skip {ident}: {e}", file=sys.stderr)
            continue
        md = d.get("metadata", {})
        lic = md.get("licenseurl") or ""
        for f in d.get("files", []):
            nm = f.get("name", "")
            if not nm.lower().endswith(".flac"):
                continue
            title = re.sub(r"^[A-Z]\d+(\.\d+)?-\d+[a-z]?-", "", nm[:-5])
            rows.append({"item": ident, "file": nm, "title": title, "len": float(f.get("length") or 0),
                         "bytes": int(f.get("size") or 0), "licence": lic})
        if verbose:
            print(f"  {i + 1:3d}/{len(ids)} {ident}", file=sys.stderr)
    os.makedirs(os.path.dirname(INDEX), exist_ok=True)
    json.dump({"built": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "query": COLLECTION_Q, "tracks": rows},
              open(INDEX, "w"), indent=0)
    print(f"{len(rows)} tracks from {len(ids)} items -> {INDEX}")


def _index():
    if not os.path.exists(INDEX):
        build_index()
    return json.load(open(INDEX))["tracks"]


def _terms(words):
    out = []
    for w in words:
        w = w.lower()
        syn = THESAURUS.get(w) or next((v for k, v in THESAURUS.items() if w.startswith(k) or k.startswith(w)), None)
        out.append((w, [w] + (syn or [])))
    return out


def search(words, lo=0.0, hi=1e9, n=40, free_only=False):
    terms = _terms(words)
    hits = []
    for r in _index():
        if not (lo <= r["len"] <= hi):
            continue
        if free_only and not any(f in r["licence"] for f in FREE):
            continue
        hay = (r["title"] + " " + r["item"].replace("_", " ")).lower()
        score, direct = 0, 0
        for w, syn in terms:
            if w in r["title"].lower():
                direct += 1
            if any(s in hay for s in syn):
                score += 1
        if score:
            hits.append((score, direct, r["len"], r))
    hits.sort(key=lambda h: (-h[0], -h[1], -h[2]))
    return [h[3] for h in hits[:n]]


def freesound(words, lo, hi, n):
    key = os.environ.get("FREESOUND_API_KEY")
    if not key:
        print("(freesound: set FREESOUND_API_KEY to search it too)")
        return []
    q = urllib.parse.urlencode({"query": " ".join(words), "token": key, "page_size": n,
                                "filter": f'duration:[{lo} TO {min(hi, 3600)}] license:("Creative Commons 0" OR "Attribution")',
                                "fields": "id,name,duration,license,username,url,tags"})
    d = json.loads(_get("https://freesound.org/apiv2/search/text/?" + q))
    return d.get("results", [])


def slate_end(wav, look=8.0, max_nsp=0.35):
    """USC Red Library / GOLD TAPE tracks often open with a spoken slate ("screwdriver on metal", "say number ten").  Two listening
    models heard it as a voice in the music (c13).  -> seconds where the last confident speech in the first `look` s ends, or 0.
    Uses faster-whisper tiny.en (already used by audio_find.py); if it is missing, returns 0 and says so."""
    try:
        from faster_whisper import WhisperModel
    except Exception:  # noqa: BLE001
        print("  (slate check skipped: faster-whisper not installed)", file=sys.stderr)
        return 0.0
    m = WhisperModel("tiny.en", device="cpu", compute_type="int8")
    segs, _ = m.transcribe(wav, vad_filter=True, clip_timestamps=[0.0, look], word_timestamps=True)
    end = 0.0
    for sg in segs:
        if sg.no_speech_prob <= max_nsp and sg.start < look and len(sg.text.strip()) > 2:
            end = max(end, (sg.words[-1].end if sg.words else sg.end))
            print(f"  slate: {sg.start:.2f}-{end:.2f} s \"{sg.text.strip()}\" (cut)", file=sys.stderr)
    return end + 0.25 if end else 0.0


def fetch(spec, out, t0=None, t1=None, any_licence=False, name=None, deslate=True):
    item, _, fn = spec.partition("/")
    rec = next((r for r in _index() if r["item"] == item and (r["file"] == fn or r["file"][:-5] == fn or r["title"] == fn)), None)
    if not rec:
        raise SystemExit(f"field_find: not in the index: {spec}")
    if not any_licence and not any(f in rec["licence"] for f in FREE):
        raise SystemExit(f"field_find: {spec} is not labelled CC0/PD ({rec['licence'] or 'no licence'}); --any-licence to override")
    os.makedirs(out, exist_ok=True)
    slug = name or re.sub(r"[^a-z0-9]+", "_", rec["title"].lower()).strip("_")[:48]
    tmp = os.path.join(out, f".{slug}.flac")
    data = _get(DL + urllib.parse.quote(item) + "/" + urllib.parse.quote(rec["file"]), timeout=300)
    open(tmp, "wb").write(data)
    wav = os.path.join(out, slug + ".wav")
    args = [FF, "-y", "-loglevel", "error"] + (["-ss", str(t0)] if t0 is not None else []) + ["-i", tmp]
    if t1 is not None:
        args += ["-t", str(float(t1) - float(t0 or 0))]
    subprocess.run(args + ["-ac", "1", "-ar", "44100", "-sample_fmt", "s16", wav], check=True)
    cut = 0.0
    if deslate and (t0 or 0) < 8.0:            # the slate is at the head of the track
        full = os.path.join(out, f".{slug}.head.wav")
        subprocess.run([FF, "-y", "-loglevel", "error", "-i", tmp, "-t", "10", "-ac", "1", "-ar", "16000", full], check=True)
        se = slate_end(full)
        os.remove(full)
        if se > (t0 or 0):
            cut = se - (t0 or 0)
            trimmed = wav + ".tmp.wav"
            subprocess.run([FF, "-y", "-loglevel", "error", "-ss", f"{cut:.3f}", "-i", wav, "-c:a", "pcm_s16le", trimmed], check=True)
            os.replace(trimmed, wav)
    os.remove(tmp)
    src = os.path.join(out, "sources.json")
    meta = json.load(open(src)) if os.path.exists(src) else {}
    meta[slug] = {"item": item, "file": rec["file"], "title": rec["title"], "from": t0, "to": t1, "slate_cut_s": round(cut, 2),
                  "licence": rec["licence"], "url": f"https://archive.org/details/{item}",
                  "credit": "USC Cinema / Sunset Editorial Collection sound effects, archive.org",
                  "fetched": time.strftime("%Y-%m-%d", time.gmtime())}
    json.dump(meta, open(src, "w"), indent=1)
    print(f"{wav}  ({rec['title']}, {rec['licence']})")
    return wav


# ------------------------------------------------------------------------------------------------ radio aporee (c14)
APOREE_OK = ("publicdomain", "/zero/", "/licenses/by/")


def _licence_ok(lic):
    return any(f in (lic or "") for f in APOREE_OK)


def aporee(words, n=40, any_licence=False):
    """Live search of radio aporee ::: maps on archive.org (identifier aporee_*), titles only.  -> [{id, title, licence}]."""
    out, seen = [], set()
    for w in words:
        q = urllib.parse.urlencode({"q": f"identifier:aporee_* AND title:({w})", "fl[]": ["identifier", "title", "licenseurl"],
                                    "rows": 300, "output": "json"}, doseq=True)
        for d in json.loads(_get(f"{SEARCH}?{q}"))["response"]["docs"]:
            if d["identifier"] in seen:
                continue
            seen.add(d["identifier"])
            lic = d.get("licenseurl", "")
            if any_licence or _licence_ok(lic):
                out.append({"id": d["identifier"], "title": d.get("title", ""), "licence": lic, "word": w})
    return out[:n] if n else out


def _lic_tag(lic):
    return ("PD" if "publicdomain" in lic else "CC0" if "/zero/" in lic else "BY" if "/licenses/by/" in lic else
            (lic.split("/licenses/")[-1].strip("/") if "/licenses/" in lic else (lic or "?")))


def fetch_item(ident, out, t0=None, t1=None, name=None, any_licence=False, flac=False, file=None):
    """Cut [t0, t1] of an archive.org item's audio (prefers FLAC, else WAV, else MP3) straight from the remote file.  Records the
    uploader's licence, creator, title and description in DIR/sources.json.  -> path."""
    md = json.loads(_get(META + ident))
    m = md.get("metadata", {})
    lic = m.get("licenseurl") or ""
    if not any_licence and not _licence_ok(lic):
        raise SystemExit(f"field_find: {ident} is {lic or 'unlicensed'}: only the PD mark, CC0 and CC-BY pass; --any-licence to override")
    files = [f for f in md.get("files", []) if f.get("name", "").lower().endswith((".flac", ".wav", ".mp3", ".ogg"))]
    if file:
        files = [f for f in files if f["name"] == file] or files
    rank = {".flac": 0, ".wav": 1, ".mp3": 2, ".ogg": 3}
    files.sort(key=lambda f: rank[os.path.splitext(f["name"].lower())[1]])
    if not files:
        raise SystemExit(f"field_find: no audio in {ident}")
    fn = files[0]["name"]
    os.makedirs(out, exist_ok=True)
    slug = name or re.sub(r"[^a-z0-9]+", "_", (m.get("title") or ident).lower()).strip("_")[:48]
    path = os.path.join(out, slug + (".flac" if flac else ".wav"))
    args = [FF, "-y", "-loglevel", "error"]
    px = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if px:
        args += ["-http_proxy", px]
    if t0 is not None:
        args += ["-ss", str(t0)]
    args += ["-i", DL + urllib.parse.quote(ident) + "/" + urllib.parse.quote(fn)]
    if t1 is not None:
        args += ["-t", str(float(t1) - float(t0 or 0))]
    args += ["-ac", "1", "-ar", "44100"] + (["-sample_fmt", "s16", "-compression_level", "8"] if flac else ["-sample_fmt", "s16"])
    subprocess.run(args + [path], check=True)
    src = os.path.join(out, "sources.json")
    meta = json.load(open(src)) if os.path.exists(src) else {}
    desc = re.sub(r"<[^>]+>", " ", m.get("description") or "")
    meta[slug] = {"item": ident, "file": fn, "title": m.get("title", ""), "from": t0, "to": t1, "licence": lic,
                  "licence_tag": _lic_tag(lic), "creator": m.get("creator", ""), "url": f"https://archive.org/details/{ident}",
                  "description": re.sub(r"\s+", " ", desc).strip()[:400],
                  "credit": f"{m.get('creator', '')}, radio aporee ::: maps (archive.org/details/{ident}), {_lic_tag(lic)}",
                  "note": "licence applied by the uploader; check the item page before publishing",
                  "fetched": time.strftime("%Y-%m-%d", time.gmtime())}
    json.dump(meta, open(src, "w"), indent=1)
    print(f"{path}  ({m.get('title', '')[:80]}, {_lic_tag(lic)})")
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("index")
    s = sub.add_parser("search")
    s.add_argument("words", nargs="+")
    s.add_argument("--min", type=float, default=0.0)
    s.add_argument("--max", type=float, default=1e9)
    s.add_argument("--n", type=int, default=40)
    s.add_argument("--free", action="store_true", help="only CC0 / public-domain items")
    s.add_argument("--freesound", action="store_true")
    s.add_argument("--json", action="store_true")
    f = sub.add_parser("fetch")
    f.add_argument("spec", help="ITEM/FILE (or ITEM/TITLE) as `search` prints it")
    f.add_argument("--out", required=True)
    f.add_argument("--from", dest="t0", type=float)
    f.add_argument("--to", dest="t1", type=float)
    f.add_argument("--name")
    f.add_argument("--any-licence", action="store_true")
    f.add_argument("--keep-slate", action="store_true", help="don't cut a spoken slate at the head of the track")
    r = sub.add_parser("aporee", help="search radio aporee ::: maps on archive.org (licence-filtered)")
    r.add_argument("words", nargs="+")
    r.add_argument("--n", type=int, default=40)
    r.add_argument("--any-licence", action="store_true")
    fi = sub.add_parser("fetch-item", help="cut a span of any archive.org item's audio (radio aporee etc.)")
    fi.add_argument("ident")
    fi.add_argument("--out", required=True)
    fi.add_argument("--from", dest="t0", type=float)
    fi.add_argument("--to", dest="t1", type=float)
    fi.add_argument("--name")
    fi.add_argument("--file", help="a particular file of the item")
    fi.add_argument("--flac", action="store_true", help="write FLAC (lossless, about half the size)")
    fi.add_argument("--any-licence", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "aporee":
        for d in aporee(a.words, a.n, a.any_licence):
            print(f"{_lic_tag(d['licence']):4s}  {d['id']:22s}  {d['title'][:110]}")
        return
    if a.cmd == "fetch-item":
        return fetch_item(a.ident, a.out, a.t0, a.t1, a.name, a.any_licence, a.flac, a.file)
    if a.cmd == "index":
        return build_index()
    if a.cmd == "search":
        res = search(a.words, a.min, a.max, a.n, a.free)
        if a.json:
            print(json.dumps(res, indent=1))
        else:
            for r in res:
                lic = "CC0" if "/zero/" in r["licence"] else ("PD" if "publicdomain" in r["licence"] else (r["licence"] or "?"))
                print(f"{r['len']:7.1f}s  {lic:4s}  {r['item']}/{r['file'][:-5]}")
        if a.freesound:
            for r in freesound(a.words, a.min, a.max, a.n):
                print(f"{r['duration']:7.1f}s  FS    {r['name']}  ({r['license']}, {r['username']})  {r['url']}")
        return
    fetch(a.spec, a.out, a.t0, a.t1, a.any_licence, a.name, deslate=not a.keep_slate)


if __name__ == "__main__":
    main()
