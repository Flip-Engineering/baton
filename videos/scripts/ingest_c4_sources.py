"""MUSIC studio cycle 4: fetch the real sound sources the c4 pipeline plays (multisampled instruments and real rooms).

    python3 videos/scripts/ingest_c4_sources.py [--only piano_knight,room_barn] [--list]

What it fetches (every file logged with its source URL and licence in videos/sources/audio/inst/CATALOG.md and
videos/sources/audio/rooms/CATALOG.md; engine/instruments.py reads the map.json files):

  instruments (videos/sources/audio/inst/<set>/, 44.1 kHz 16-bit, trimmed with a release fade):
    CC0 1.0: Versilian Community Sample Library (github.com/sgossner/VCSL) and VSCO 2 Community Edition
    (github.com/sgossner/VSCO-2-CE). Both are CC0 (the repos' LICENSE files); credit is given anyway.
  rooms (videos/sources/audio/rooms/<name>.wav): real spaces recorded as balloon-pop / clap / sweep responses on
    freesound.org, CC0 only (the sound page's licence is checked at fetch time; a page that does not say CC0 is
    skipped). freesound's API needs a key, so the file is its public high-quality preview (an MP3 of the upload):
    the response is trimmed to its onset, faded, and used as a convolution room. That lossy step is logged.

Sample names follow the Yamaha octave convention in both libraries (C3 = MIDI 60); the script checks it against a
pitch estimate of each file and logs the offset it used per set.
Disk: every set is trimmed to a few seconds per note (the whole fetch is about 25 MB). Nothing is deleted.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
LIB = os.path.join(VIDEOS, "sources", "audio")
INST = os.path.join(LIB, "inst")
ROOMS = os.path.join(LIB, "rooms")
SR = 44100
FF = "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
RAW = {"VCSL": "https://raw.githubusercontent.com/sgossner/VCSL/master/",
       "VSCO": "https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/"}
CREDIT = {"VCSL": "Versilian Studios (Sam Gossner) and contributors, Versilian Community Sample Library, CC0 1.0",
          "VSCO": "Versilian Studios (Sam Gossner, Simon Dalzell) and contributors, VSCO 2 Community Edition, CC0 1.0"}
PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8,
      "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def note_of(name):
    """'A#0' / 'C-1' -> MIDI with C3 = 60 (the libraries' convention)."""
    m = re.search(r"(?<![A-Za-z])([A-G][#b]?)(-?\d)(?![0-9])", name)
    return None if not m else 12 * (int(m.group(2)) + 2) + PC[m.group(1)]


# ------------------------------------------------------------------ the sets
def _vcsl_piano(lo=33, hi=91):
    out = []
    for vl in ("vl1", "vl2"):
        for n in ("A", "B", "C#", "D#", "F", "G"):
            for o in range(-1, 7):
                midi = 12 * (o + 2) + PC[n]
                if lo <= midi <= hi:
                    out.append((f"Chordophones/Zithers/Upright Piano, Knight/Sustains/Player_{vl}_rr1_{n}{o}.wav",
                                {"vel": 0.55 if vl == "vl1" else 1.0}))
    return out


SETS = {
    # an upright piano with a real hammer and a real room tone (a grange hall, a storefront church)
    "piano_knight": dict(src="VCSL", files=_vcsl_piano(), trim=3.2, mono=True, release=0.25,
                         what="upright piano (Knight), sustain pedal off, 2 velocity layers, every 2 semitones"),
    # the heartland harmonica: diatonic Hohner Special 20 in C and in F (together they cover B-flat major's notes)
    "harmonica": dict(src="VCSL", files=[(f"Aerophones/Free Aerophones/Harmonica-Hohner-Special20-C/Sustains/Normal/"
                                          f"Hohner-Special20_Normal_{n}.wav", {"vel": 1.0})
                                         for n in ("C3", "E3", "C4", "E4", "G4", "C5", "E5", "G5", "C6")]
                     + [(f"Aerophones/Free Aerophones/Harmonica-Hohner-Special20-F/Sustains/Normal/"
                         f"Hohner-Special20-F_Normal_{n}.wav", {"vel": 1.0})
                        for n in ("F3", "A3", "C4", "F4", "A4", "C5", "F5", "C6")],
                     trim=2.6, mono=True, release=0.12, what="diatonic harmonica, Hohner Special 20 in C and F, sustains"),
    # the upright bass the work song walks on (pizzicato, loud layer, 2 round robins)
    "bass_pizz": dict(src="VSCO", files=[(f"Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_{n}_v3_rr{r}.wav", {"vel": 1.0, "rr": r})
                                         for n in ("E0", "G0", "A#0", "C1", "E1", "F#0") for r in (1, 2)]
                      + [(f"Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_{n}_v1_rr{r}.wav", {"vel": 0.6, "rr": r})
                         for n in ("D1", "F#1", "G#1", "A1", "C#2", "E2", "G#2", "B2") for r in (1, 2)],
                      trim=1.6, mono=True, release=0.08, what="solo contrabass pizzicato"),
    # a brass band: tenor trombone, trumpet, tuba sustains (loud layers) and staccato stabs
    "brass_sus": dict(src="VSCO", files=[(f"Brass/Tenor Trombone/sus/tenortbn_sus_{n}_v3_1.wav", {"vel": 1.0, "section": "tbn"})
                                         for n in ("A#1", "C3", "C#3", "D#3", "D2", "F1", "F2", "F3")]
                      + [(f"Brass/Trumpet/sus/Sum_SHTrumpet_sus_{n}_v3_rr1.wav", {"vel": 1.0, "section": "tpt"})
                         for n in ("A#3", "A2", "A4", "C3", "C5", "D#3", "D4", "F2", "F4", "G3")]
                      + [(f"Brass/Tuba/sus/Tuba3_sus_{n}_v3_rr1_Mid.wav", {"vel": 1.0, "section": "tuba"})
                         for n in ("A#0", "A#1", "D#1", "D2", "F1", "F2")],
                      trim=3.0, mono=True, release=0.18, what="tenor trombone, trumpet and tuba sustains, loud"),
    "brass_stac": dict(src="VSCO", files=[(f"Brass/Trumpet/stac/Sum_SHTrumpet_stac_{n}_v3_rr{r}.wav", {"vel": 1.0, "rr": r, "section": "tpt"})
                                          for n in ("A#3", "A2", "A4", "C3", "C5", "D#3", "D4", "F3", "F4", "G3") for r in (1, 2)]
                       + [(f"Brass/Tenor Trombone/stac/tenortbn_stac_{n}_v4_rr1.wav", {"vel": 1.0, "section": "tbn"})
                          for n in ("A#1", "A#2", "D3", "F1", "F2", "F3")],
                       trim=1.2, mono=True, release=0.08, what="trumpet and tenor trombone staccato, loudest layer"),
    # the hall's floor and hands: a real bass drum (the stomp's body), real tambourines
    "bass_drum": dict(src="VCSL", files=[(f"Membranophones/Struck Membranophones/Bass Drum 1/BDrumNew_hit_v{v}_rr{r}_Sum.wav",
                                          {"vel": v / 7, "rr": r}) for v in (3, 5, 7) for r in (1, 2)],
                      trim=1.4, mono=True, release=0.1, unpitched=True, what="concert bass drum hits, 3 dynamics"),
    "tambourine": dict(src="VCSL", files=[("Idiophones/Struck Idiophones/Tambourine 1/Tamb1_Hit_v1_rr1_Mid.wav", {"vel": 0.5, "kind": "hit"}),
                                          ("Idiophones/Struck Idiophones/Tambourine 1/Tamb1_Hit_v2_rr1_Mid.wav", {"vel": 1.0, "kind": "hit"}),
                                          ("Idiophones/Struck Idiophones/Tambourine 2/Tamb2_Hit_v1_rr1_Mid.wav", {"vel": 0.5, "kind": "hit", "rr": 2}),
                                          ("Idiophones/Struck Idiophones/Tambourine 2/Tamb2_Hit_v2_rr2_Mid.wav", {"vel": 1.0, "kind": "hit", "rr": 2}),
                                          ("Idiophones/Struck Idiophones/Tambourine 1/Tamb1_Shake_rr1_Mid.wav", {"vel": 0.8, "kind": "shake"}),
                                          ("Idiophones/Struck Idiophones/Tambourine 2/Tamb2_Shake_rr3_Mid.wav", {"vel": 0.8, "kind": "shake", "rr": 2}),
                                          ("Idiophones/Struck Idiophones/Tambourine 1/Tamb1_Roll_v2_rr1_Mid.wav", {"vel": 0.8, "kind": "roll"})],
                       trim=1.6, mono=False, release=0.06, unpitched=True, what="tambourine hits, shakes and a roll"),
}

# real rooms (freesound.org, CC0, via the public high-quality preview): (name, sound id, what, use)
ROOM_SET = [
    ("barn", 856706, "balloon pop in a barn (Gergueil, France, May 2026)", "COMMON WEALTH: the grange hall / barn the storm song is sung in"),
    ("church_nyc", 240593, "impulse response at Notre Dame, New York City (2014, X/Y pair)", "PEOPLE'S BANK: the storefront-to-cathedral church"),
    ("church_small", 585739, "small church, 5 m, stereo impulse response", "PEOPLE'S BANK: the near church"),
    # (537675 "IR_ST_Parking_Garage_01" was dropped: its page says it is digitally modelled, not a recorded space)
    ("garage", 732457, "impulse response captured in a parking garage in Arcadia, California", "RED WEDGE: poured concrete, the facade's own space"),
    ("underpass", 731458, "sine sweep at a Los Angeles freeway underpass, 5.9 s", "RED WEDGE: the long concrete tail"),
]


# ------------------------------------------------------------------ helpers
def curl(url, out=None):
    args = ["curl", "-sS", "-L", "--fail", "--max-time", "120", url]
    if out:
        args += ["-o", out]
    r = subprocess.run(args, capture_output=True, text=out is None)
    if r.returncode:
        raise RuntimeError(f"curl {url}: {r.stderr[:200] if isinstance(r.stderr, str) else r.stderr[:200]}")
    return r.stdout


def read_any(path):
    d = tempfile.mkdtemp()
    o = os.path.join(d, "x.wav")
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", path, "-acodec", "pcm_f32le", "-ar", str(SR), o], check=True)
    _, x = wavfile.read(o)
    os.remove(o)
    os.rmdir(d)
    x = x.astype(float)
    return x if x.ndim == 2 else x[:, None]


def f0_est(x, lo=40.0, hi=2000.0):
    m = x.mean(1)
    a = int(np.argmax(np.abs(m) > 0.1 * np.abs(m).max()))
    seg = m[a + int(0.08 * SR): a + int(0.08 * SR) + 8192]
    if len(seg) < 4096:
        return None
    seg = seg * np.hanning(len(seg))
    ac = np.fft.irfft(np.abs(np.fft.rfft(seg, 2 * len(seg))) ** 2)[: len(seg)]
    l0, l1 = int(SR / hi), int(SR / lo)
    k = l0 + int(np.argmax(ac[l0:l1]))
    return SR / k if ac[k] > 0.3 * ac[0] else None


def trim(x, secs, release):
    m = np.abs(x).max(1)
    a = max(0, int(np.argmax(m > 10 ** (-50 / 20) * m.max())) - int(0.002 * SR))
    y = x[a:a + int(secs * SR)].copy()
    f = min(len(y), int(max(release, 0.05) * SR))
    y[len(y) - f:] *= np.linspace(1, 0, f)[:, None] ** 2
    return y


def write16(path, x, scale):
    wavfile.write(path, SR, np.clip(x * scale * 32767, -32768, 32767).astype(np.int16))


# ------------------------------------------------------------------ fetchers
def fetch_set(name, spec, log):
    d = os.path.join(INST, name)
    os.makedirs(d, exist_ok=True)
    zones, raw, offs = [], [], []
    for rel, meta in spec["files"]:
        url = RAW[spec["src"]] + urllib.parse.quote(rel)
        tmp = os.path.join(d, "_dl" + os.path.splitext(rel)[1])
        try:
            curl(url, tmp)
            x = read_any(tmp)
        except Exception as e:  # noqa: BLE001
            log.append(f"  skip {rel}: {e}")
            continue
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        if spec.get("mono"):
            x = x.mean(1, keepdims=True)
        x = trim(x, spec["trim"], spec["release"])
        n = note_of(os.path.basename(rel)) if not spec.get("unpitched") else None
        if n is not None:
            f = f0_est(x)
            if f:
                est = 69 + 12 * np.log2(f / 440.0)
                offs.append(round(est - n))
        raw.append((rel, meta, n, x))
    if not raw:
        return None
    # octave check: the median offset between the named note and the measured f0, in whole octaves
    off = 0
    clean = [o for o in offs if o % 12 == 0 and abs(o) <= 12]   # the estimator's octave slips are not evidence
    if clean and len(clean) >= len(offs) / 2:
        vals, cnt = np.unique(clean, return_counts=True)
        best = vals[cnt == cnt.max()]
        off = 0 if 0 in best else int(best[0])
    peak = max(np.abs(x).max() for *_, x in raw)
    scale = 0.95 / peak                          # one scale per set: the velocity layers keep their real levels
    for i, (rel, meta, n, x) in enumerate(raw):
        fn = f"{i:03d}_{re.sub(r'[^A-Za-z0-9#_-]+', '_', os.path.splitext(os.path.basename(rel))[0])}.wav"
        write16(os.path.join(d, fn), x, scale)
        z = {"file": fn, "src": rel, "vel": meta.get("vel", 1.0), "rr": meta.get("rr", 1)}
        if n is not None:
            z["note"] = n + off
        for k in ("kind", "section"):
            if k in meta:
                z[k] = meta[k]
        zones.append(z)
    info = {"name": name, "what": spec["what"], "source": spec["src"], "credit": CREDIT[spec["src"]], "licence": "CC0 1.0",
            "repo": RAW[spec["src"]].replace("raw.githubusercontent.com", "github.com").replace("/master/", ""),
            "octave_offset_applied": off, "offsets_measured": offs, "sr": SR, "release": spec["release"], "zones": zones}
    json.dump(info, open(os.path.join(d, "map.json"), "w"), indent=1)
    log.append(f"  {name}: {len(zones)} zones, octave offset {off} (measured {sorted(set(offs))}), "
               f"{sum(os.path.getsize(os.path.join(d, z['file'])) for z in zones) / 1e6:.1f} MB")
    return info


def fetch_room(name, sid, what, use, log):
    os.makedirs(ROOMS, exist_ok=True)
    page = curl(f"https://freesound.org/s/{sid}/")
    lic = "CC0 1.0" if re.search(r"creativecommons\.org/publicdomain/zero|Creative Commons 0|CC0", page) else None
    if not lic:
        log.append(f"  room {name}: sound {sid} is not marked CC0 on its page; skipped")
        return None
    m = re.search(r"https://cdn\.freesound\.org/previews/\d+/\d+_\d+-hq\.mp3", page)
    user = re.search(r'href="/people/([^/"]+)/"', page)
    txt = re.sub(r"<[^>]+>", "\n", re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S))
    lines = [ln.strip() for ln in txt.split("\n") if ln.strip()]
    k = next((i for i, ln in enumerate(lines) if "Overall rating" in ln or "Not enough ratings" in ln), None)
    page_says = " ".join(lines[k + 1:k + 12])[:400] if k is not None else ""
    if not m:
        log.append(f"  room {name}: no preview URL on the page; skipped")
        return None
    tmp = os.path.join(ROOMS, f"_{name}.mp3")
    curl(m.group(0), tmp)
    x = read_any(tmp)
    os.remove(tmp)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, 1)
    mono = np.abs(x).max(1)
    a = max(0, int(np.argmax(mono > 0.25 * mono.max())) - int(0.001 * SR))
    y = x[a:a + int(4.5 * SR)].copy()
    env = 20 * np.log10(np.maximum(1e-9, np.sqrt(np.convolve(y.mean(1) ** 2, np.ones(441) / 441, "same"))))
    # end where the tail meets the recording's noise floor (+6 dB), with a fade
    floor = np.percentile(env[-int(0.5 * SR):], 50) if len(env) > SR else env.min()
    above = np.where(env > floor + 6)[0]
    end = min(len(y), int(above[-1]) + int(0.05 * SR)) if len(above) else len(y)
    y = y[:max(end, int(0.3 * SR))]
    f = min(len(y), int(0.25 * SR))
    y[len(y) - f:] *= np.linspace(1, 0, f)[:, None] ** 2
    y /= np.abs(y).max() + 1e-12
    wavfile.write(os.path.join(ROOMS, f"{name}.wav"), SR, (y * 0.95 * 32767).astype(np.int16))
    # rough RT60 from the energy decay (Schroeder), for the catalogue
    e = (y.mean(1) ** 2)[::-1].cumsum()[::-1]
    edc = 10 * np.log10(e / e[0] + 1e-12)
    i5, i25 = np.argmax(edc < -5), np.argmax(edc < -25)
    rt = round(3 * (i25 - i5) / SR, 2) if i25 > i5 else None
    info = {"name": name, "freesound_id": sid, "url": f"https://freesound.org/s/{sid}/", "author": user.group(1) if user else None,
            "what": what, "use": use, "licence": lic, "file": f"{name}.wav", "len_s": round(len(y) / SR, 2), "rt60_s_est": rt,
            "note": "freesound public preview (high-quality MP3 of the upload), trimmed to the onset, faded at the noise floor",
            "page_says": page_says}
    log.append(f"  room {name}: {info['len_s']} s, RT60 ~{rt} s, {lic}, by {info['author']}")
    return info


def write_catalogs(insts, rooms):
    rows = ["# Multisampled instruments (MUSIC c4)", "",
            "Fetched by `videos/scripts/ingest_c4_sources.py`; played by `videos/engine/instruments.py` (`Sampler`).",
            "All CC0 1.0. Credit is given though not required.", "",
            "| set | what | zones | source | licence | credit |", "|---|---|---|---|---|---|"]
    for i in insts:
        rows.append(f"| `{i['name']}` | {i['what']} | {len(i['zones'])} | {i['repo']} | {i['licence']} | {i['credit']} |")
    rows += ["", "Per-file source paths are in each set's `map.json` (`zones[].src`, relative to the repo above)."]
    os.makedirs(INST, exist_ok=True)
    open(os.path.join(INST, "CATALOG.md"), "w").write("\n".join(rows) + "\n")
    rows = ["# Real rooms (MUSIC c4)", "",
            "Recorded responses of real spaces, used as convolution rooms by `engine/instruments.py` (`room()`).",
            "CC0 only; each page's licence was checked when fetched. The file is freesound's public high-quality "
            "preview (an MP3 of the upload), trimmed and faded: a lossy source, logged as such.", "",
            "| name | what | used for | length | RT60 est. | author | source | licence |", "|---|---|---|---|---|---|---|---|"]
    for r in rooms:
        rows.append(f"| `{r['name']}` | {r['what']} | {r['use']} | {r['len_s']} s | {r['rt60_s_est']} s | {r['author']} | "
                    f"{r['url']} | {r['licence']} |")
    os.makedirs(ROOMS, exist_ok=True)
    open(os.path.join(ROOMS, "CATALOG.md"), "w").write("\n".join(rows) + "\n")
    json.dump(rooms, open(os.path.join(ROOMS, "rooms.json"), "w"), indent=1)


def main(argv):
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    if "--list" in argv:
        print("sets:", ", ".join(SETS), "| rooms:", ", ".join(r[0] for r in ROOM_SET))
        return 0
    log = []
    insts = []
    for name, spec in SETS.items():
        if only and name not in only:
            p = os.path.join(INST, name, "map.json")
            if os.path.exists(p):
                insts.append(json.load(open(p)))
            continue
        print(f"fetching {name} ...", flush=True)
        r = fetch_set(name, spec, log)
        if r:
            insts.append(r)
        print(log[-1] if log else "", flush=True)
    rooms = []
    old = {r["name"]: r for r in (json.load(open(os.path.join(ROOMS, "rooms.json"))) if os.path.exists(os.path.join(ROOMS, "rooms.json")) else [])}
    for name, sid, what, use in ROOM_SET:
        if only and name not in only and ("room_" + name) not in only:
            if name in old:
                rooms.append(old[name])
            continue
        try:
            r = fetch_room(name, sid, what, use, log)
        except Exception as e:  # noqa: BLE001
            log.append(f"  room {name}: {e}")
            r = None
        if r:
            rooms.append(r)
        print(log[-1], flush=True)
    write_catalogs(insts, rooms)
    print("\n".join(log))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
