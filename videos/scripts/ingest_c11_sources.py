#!/usr/bin/env python3
"""MUSIC c11: the instruments the slate never had (a real drum kit, string sections, a pipe organ, an electric piano).

The c11 critic (videos/review/studio_music_c11/before/NOTES.md, section 4): the library had no strings, no modern kit and
no real keyboard beyond one upright piano, so every "modern" layer was a numpy oscillator and every "serious" layer was
sampled brass.  This adds, all from public sample sets fetched with a partial git clone (nothing else in the repos is
downloaded; delete the clones afterwards):

  c11_kick, c11_snare, c11_hat, c11_cym, c11_tom   Virtuosity Drums (CC0), a club kit recorded live in Boston: each hit is
                                                   the close mic + overheads + room mixed at ingest (stereo; the room is
                                                   spread with a 13 ms side delay), so a hit sounds like a kit in a room.
  c11_vln, c11_vla, c11_vc, c11_cb                 VSCO 2 CE (CC0) violin, viola and cello SECTIONS (sustain with vibrato,
                                                   spiccato) and solo contrabass (sustain, spiccato).
  c11_organ                                        VSCO 2 CE (CC0) pipe organ (Rode), loud and quiet registrations.
  c11_rhodes                                       jRhodes3d (a 1977 Rhodes Mark I; samples CC BY-NC 4.0, music made with
                                                   them CC0: "free for use as a musical instrument").  Not for resale as a
                                                   sample set; fine in our videos.

    git clone --filter=blob:none --no-checkout --depth 1 https://github.com/sfzinstruments/virtuosity_drums vd
    (cd vd && git sparse-checkout init --no-cone && <patterns> > .git/info/sparse-checkout && git checkout)
    python3 videos/scripts/ingest_c11_sources.py drums --root vd
    python3 videos/scripts/ingest_c11_sources.py vsco --root VSCO-2-CE
    python3 videos/scripts/ingest_c11_sources.py rhodes --root jlearman.jRhodes3d

Writes videos/sources/audio/inst/c11_<set>/ (16-bit wav at 44.1 kHz) with map.json in the engine/daw/bank.py format.
"""
import argparse
import json
import os
import re
import sys
from fractions import Fraction

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)
OUT = os.path.join(VIDEOS, "sources", "audio", "inst")
SR = 44100
VD_CREDIT = "Virtuosity Drums, performed by Austin McMahon, recorded at Virtuosity Musical Instruments (Boston); sfzinstruments, CC0 1.0"
VD_REPO = "https://github.com/sfzinstruments/virtuosity_drums"
VS_CREDIT = "Versilian Studios (Sam Gossner, Simon Dalzell) and contributors, VSCO 2 Community Edition, CC0 1.0"
VS_REPO = "https://github.com/sgossner/VSCO-2-CE"
RH_CREDIT = "jRhodes3d by John Learman (1977 Rhodes Mark I Stage 73); samples CC BY-NC 4.0, music made with them CC0"
RH_REPO = "https://github.com/sfzinstruments/jlearman.jRhodes3d"


def read(path):
    import soundfile as sf
    x, r = sf.read(path, dtype="float32", always_2d=True)
    if r != SR:
        f = Fraction(SR, r).limit_denominator(1000)
        x = resample_poly(x, f.numerator, f.denominator, axis=0).astype(np.float32)
    return x


def to_int16(x):
    return np.clip(np.round(x * 32767), -32768, 32767).astype(np.int16)


def trim(x, maxs, fade=0.08, pre=0.002):
    a = np.abs(x).max(1)
    thr = max(a.max() * 0.02, 1e-4)
    i = max(0, int(np.argmax(a > thr)) - int(pre * SR))
    y = x[i:i + int(maxs * SR)].copy()
    k = min(int(fade * SR), len(y) // 4)
    if k:
        y[-k:] *= np.linspace(1, 0, k)[:, None] ** 2
    # drop the silent end
    e = np.abs(y).max(1)
    last = len(e) - int(np.argmax(e[::-1] > 1e-4))
    return y[:max(last, int(0.05 * SR))]


def spread(room, ms=13.0):
    """A mono room mic as a stereo field: the right side delayed a few ms (the image of a room, not a chorus)."""
    m = room[:, 0]
    d = int(ms / 1000 * SR)
    r = np.concatenate([np.zeros(d, np.float32), m])[:len(m)]
    return np.stack([m, r], 1)


def write_set(name, zones, info):
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    keep = []
    for i, (fn, x, z) in enumerate(zones):
        out = f"{i:03d}_{fn}"
        wavfile.write(os.path.join(d, out), SR, to_int16(x))
        z = dict(z, file=out, sr=SR, dur=round(len(x) / SR, 3))
        keep.append(z)
    info = dict(info, name=name, sr=SR, zones=keep)
    json.dump(info, open(os.path.join(d, "map.json"), "w"), indent=1)
    mb = sum(os.path.getsize(os.path.join(d, z["file"])) for z in keep) / 1e6
    print(f"  {name}: {len(keep)} zones, {mb:.1f} MB")


# ------------------------------------------------------------------------------------------------ drums
def ingest_drums(root):
    S = os.path.join(root, "Samples")

    def mics(close_dir, close_fn, mixes, gains, maxs):
        """close + overhead + room for one hit; mixes = [(dir, prefix)], all mono files of the same stem."""
        stem = close_fn.split("_", 1)[1]
        parts = []
        c = read(os.path.join(S, close_dir, close_fn))
        parts.append((c if c.shape[1] == 2 else np.repeat(c, 2, 1)) * gains[0])
        for (dd, pfx), g in zip(mixes, gains[1:]):
            p = os.path.join(S, dd, f"{pfx}_{stem}")
            if os.path.exists(p):
                y = read(p)
                y = y if y.shape[1] == 2 else spread(y) if pfx == "room" else np.repeat(y, 2, 1)
                parts.append(y * g)
        n = max(len(p) for p in parts)
        x = sum(np.pad(p, ((0, n - len(p)), (0, 0))) for p in parts)
        return trim(x, maxs)

    info = {"source": "Virtuosity Drums", "credit": VD_CREDIT, "licence": "CC0 1.0", "repo": VD_REPO, "release": 0.2}
    # kick: snares off (a tighter kick), 4 velocities x 4 round robins
    zs = []
    for fn in sorted(os.listdir(os.path.join(S, "kickmic", "kick"))):
        m = re.match(r"kickmic_kick_(snoff|snon)_vl(\d)_rr(\d)\.flac", fn)
        if not m or m.group(1) != "snoff":
            continue
        x = mics("kickmic/kick", fn, [("oh/kick", "oh"), ("room/kick", "room")], (1.0, 0.35, 0.45), 1.6)
        zs.append((fn.replace(".flac", ".wav"), x, {"art": "hit", "vel": int(m.group(2)) / 4, "rr": int(m.group(3)), "unpitched": True}))
    write_set("c11_kick", zs, dict(info, what="kick drum (club kit, snares off), close + overhead + room"))

    # snare: center (36 numbered hits, sorted into 6 velocity layers by level), rimshot (12), cross-stick (16)
    zs = []
    for art, key, layers in (("hit", "center", 6), ("rim", "rimshot", 3), ("xstick", "crossstick", 4)):
        fns = [f for f in os.listdir(os.path.join(S, "snaremic", "snare")) if re.match(rf"snaremic_snare_{key}_vl\d+\.flac", f)]
        if not fns:
            continue
        xs = [(f, mics("snaremic/snare", f, [("oh/snare", "oh"), ("room/snare", "room")], (1.0, 0.5, 0.5), 1.4)) for f in fns]
        lv = [20 * np.log10(np.sqrt((x[:int(0.05 * SR)] ** 2).mean()) + 1e-9) for _, x in xs]
        order = np.argsort(lv)
        per = max(1, len(xs) // layers)
        for rank, k in enumerate(order):
            layer = min(layers, rank // per + 1)
            f, x = xs[k]
            zs.append((f.replace(".flac", ".wav"), x, {"art": art, "vel": round(layer / layers, 3), "rr": rank % per + 1, "unpitched": True}))
    write_set("c11_snare", zs, dict(info, what="snare (club kit): center hits, rimshots, cross-stick; close + overhead + room"))

    # hats: closed, half, 3/4 open (arts), open, pedal; overhead mic only (the hat is in it), 4 velocities x 4 rr
    zs = []
    for fn in sorted(os.listdir(os.path.join(S, "oh", "hh"))):
        m = re.match(r"oh_hh_(closed|half|34|open|pedal)_vl(\d)_rr(\d)\.flac", fn)
        if not m:
            continue
        art = {"34": "open34"}.get(m.group(1), m.group(1))
        vmax = 3 if art in ("open", "pedal") else 4
        x = read(os.path.join(S, "oh", "hh", fn))
        x = trim(x if x.shape[1] == 2 else np.repeat(x, 2, 1), 2.5 if art.startswith("open") else 0.9)
        zs.append((fn.replace(".flac", ".wav"), x, {"art": art, "vel": round(int(m.group(2)) / vmax, 3), "rr": int(m.group(3)), "unpitched": True}))
    write_set("c11_hat", zs, dict(info, what="hi-hat (club kit): closed, half, 3/4 open, open, pedal; overheads"))

    zs = []
    for sub in ("crash", "ride"):
        for fn in sorted(os.listdir(os.path.join(S, "oh", sub))):
            m = re.match(rf"oh_{sub}_(crash|sizzle|ride|bell)_vl(\d)_rr(\d)\.flac", fn)
            if not m:
                continue
            x = read(os.path.join(S, "oh", sub, fn))
            x = trim(x if x.shape[1] == 2 else np.repeat(x, 2, 1), 4.5)
            zs.append((fn.replace(".flac", ".wav"), x, {"art": m.group(1), "vel": round(int(m.group(2)) / 3, 3), "rr": int(m.group(3)), "unpitched": True}))
    write_set("c11_cym", zs, dict(info, what="cymbals (club kit): crash, sizzle crash, ride, ride bell; overheads"))

    zs = []
    d = os.path.join(S, "snaremic", "ltom")
    if os.path.isdir(d):
        fns = [f for f in os.listdir(d) if "center" in f]
        xs = [(f, mics("snaremic/ltom", f, [("oh/ltom", "oh")], (1.0, 0.7), 2.0)) for f in fns]
        lv = [20 * np.log10(np.sqrt((x[:int(0.05 * SR)] ** 2).mean()) + 1e-9) for _, x in xs]
        order = np.argsort(lv)
        per = max(1, len(xs) // 4)
        for rank, k in enumerate(order):
            f, x = xs[k]
            zs.append((f.replace(".flac", ".wav"), x, {"art": "hit", "vel": round(min(4, rank // per + 1) / 4, 3), "rr": rank % per + 1, "unpitched": True}))
        write_set("c11_tom", zs, dict(info, what="floor tom (club kit), center hits; snare mic + overheads"))


# ------------------------------------------------------------------------------------------------ VSCO strings and organ
PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9,
      "A#": 10, "Bb": 10, "B": 11}


def vsco_note(fn):
    """VSCO names use C3 = middle C... but not every folder does; we measure afterwards (pitchqa) and correct by octave."""
    m = re.search(r"(?:^|[_\s-])([A-G](?:#|b)?)(-?\d)(?=[_\s.v-]|$)", fn)
    if not m:
        return None
    return 12 * (int(m.group(2)) + 2) + PC[m.group(1)]


def ingest_pitched(name, root, parts, what, credit, repo, mono=True, maxs=3.5, release=0.3, measure=True, stereo_keep=False):
    from engine.daw import pitchqa
    zs = []
    for sub, art in parts:
        p = os.path.join(root, sub)
        if not os.path.isdir(p):
            print(f"  {name}: missing {sub}", file=sys.stderr)
            continue
        for fn in sorted(os.listdir(p)):
            if not fn.lower().endswith((".wav", ".flac")):
                continue
            note = vsco_note(fn)
            if note is None:
                continue
            v = re.search(r"_v(?:l)?(\d+)", fn)
            rr = re.search(r"_rr(\d+)", fn, re.I)
            x = read(os.path.join(p, fn))
            x = trim(x, maxs, fade=0.15)
            if mono and not stereo_keep:
                x = x.mean(1, keepdims=True)
            zs.append([fn.replace(" ", "_").rsplit(".", 1)[0] + ".wav", x,
                       {"art": art, "vel_n": int(v.group(1)) if v else None, "rr": int(rr.group(1)) if rr else 1, "note": note,
                        "src": os.path.join(sub, fn)}])
    if not zs:
        return
    vmax = {}
    for _, _, z in zs:
        vmax[z["art"]] = max(vmax.get(z["art"], 1), z["vel_n"] or 1)
    for _, _, z in zs:
        z["vel"] = round((z["vel_n"] or vmax[z["art"]]) / vmax[z["art"]], 3)
    off = 0
    if measure:
        import tempfile
        errs, cents = [], []
        with tempfile.TemporaryDirectory() as td:
            for fn, x, z in zs:
                tp = os.path.join(td, "z.wav")
                wavfile.write(tp, SR, to_int16(x))
                try:
                    c = pitchqa.check(tp, z["note"], struck=z["art"] in ("spic", "stac", "pizz"))
                except Exception:  # noqa: BLE001
                    continue
                z["cents"], z["octave_err"], z["conf"] = c["cents"], c["octave"], c["conf"]
                if c["conf"] >= 0.25:
                    errs.append(c["octave"])
                    cents.append(c["cents"])
        off = int(round(float(np.median(errs)))) if errs else 0
        med = float(np.median(cents)) if cents else 0.0
        for _, _, z in zs:
            if off:
                z["note"] += 12 * off
            if "cents" not in z or z.get("conf", 0) < 0.25 or abs(z["cents"] - med) > 40 or z.get("octave_err", 0) != off:
                z["cents"] = round(med, 1)
                z["cents_from"] = "set median"
    write_set(name, [(f, x, z) for f, x, z in zs], {"what": what, "source": "VSCO" if "VSCO" in credit else "", "credit": credit,
                                                     "licence": "CC0 1.0" if "CC0 1.0" in credit else credit, "repo": repo,
                                                     "octave_offset_applied": off, "release": release})


def ingest_vsco(root):
    ingest_pitched("c11_vln", root, [("Strings/Violin Section/susVib", "sus"), ("Strings/Violin Section/Spic", "spic")],
                   "violin section: sustain with vibrato, spiccato", VS_CREDIT, VS_REPO, mono=False, stereo_keep=True, release=0.45)
    ingest_pitched("c11_vla", root, [("Strings/Viola Section/susvib", "sus"), ("Strings/Viola Section/spic", "spic")],
                   "viola section: sustain with vibrato, spiccato", VS_CREDIT, VS_REPO, mono=False, stereo_keep=True, release=0.45)
    ingest_pitched("c11_vc", root, [("Strings/Cello Section/susvib", "sus"), ("Strings/Cello Section/spic", "spic")],
                   "cello section: sustain with vibrato, spiccato", VS_CREDIT, VS_REPO, mono=False, stereo_keep=True, release=0.45)
    ingest_pitched("c11_cb", root, [("Strings/Solo Contrabass/SusNV", "sus"), ("Strings/Solo Contrabass/Spic", "spic")],
                   "solo contrabass: sustain without vibrato, spiccato", VS_CREDIT, VS_REPO, release=0.35)


def ingest_organ(root):
    """The Rode organ files are numbered (Rode_Man3Open_01 ...), every third semitone; the number is a key index, so the
    pitch is measured outright (pitchqa on a guessed note, then the set's octave)."""
    from engine.daw import pitchqa
    zs = []
    for sub, vel in (("Keys/Organ/Quiet", 0.5), ("Keys/Organ/Loud", 1.0)):
        p = os.path.join(root, sub)
        if not os.path.isdir(p):
            continue
        for fn in sorted(os.listdir(p)):
            m = re.search(r"_(\d+)\.wav$", fn)
            if not m:
                continue
            x = trim(read(os.path.join(p, fn)), 6.0, fade=0.3)
            zs.append([f"{sub.split('/')[-1].lower()}_{fn}", x, {"art": "sus", "vel": vel, "rr": 1, "idx": int(m.group(1)), "src": os.path.join(sub, fn)}])
    if not zs:
        return
    import tempfile
    # find the index -> MIDI offset: try offsets, keep the one pitchqa agrees with most
    with tempfile.TemporaryDirectory() as td:
        est = []
        for fn, x, z in zs[::3]:
            tp = os.path.join(td, "z.wav")
            wavfile.write(tp, SR, to_int16(x.mean(1, keepdims=True)))
            try:
                r = pitchqa.f0_file(tp)
                if r["hz"] > 0 and r["conf"] >= 0.3:
                    est.append(r["midi"] - z["idx"])
            except Exception:  # noqa: BLE001
                pass
        base = int(round(float(np.median(est)))) if est else 35
        for fn, x, z in zs:
            z["note"] = z["idx"] + base
            tp = os.path.join(td, "z.wav")
            wavfile.write(tp, SR, to_int16(x.mean(1, keepdims=True)))
            try:
                c = pitchqa.check(tp, z["note"], struck=False)
                z["note"] += 12 * c["octave"] if c["conf"] >= 0.3 else 0
                z["cents"] = c["cents"] if c["conf"] >= 0.3 else 0.0
            except Exception:  # noqa: BLE001
                z["cents"] = 0.0
    write_set("c11_organ", [(f, x, z) for f, x, z in zs], {"what": "pipe organ (Rode), quiet and loud registrations", "source": "VSCO",
                                                          "credit": VS_CREDIT, "licence": "CC0 1.0", "repo": VS_REPO, "release": 0.9,
                                                          "index_to_midi": base})


# ------------------------------------------------------------------------------------------------ Rhodes
def ingest_rhodes(root):
    """jRhodes3d-mono: files are A_<midi>__<name>_<layer>.flac, layer 5 the softest and 1 the hardest (the sfz's groups)."""
    d = os.path.join(root, "jRhodes3d-mono")
    out = []
    for fn in sorted(os.listdir(d)):
        m = re.match(r"A_(\d+)__\w+?_(\d)\.flac$", fn)
        if not m:
            continue
        x = trim(read(os.path.join(d, fn)), 6.0, fade=0.6)
        out.append([fn.replace(".flac", ".wav"), x, {"art": "sus", "vel": round((6 - int(m.group(2))) / 5, 3), "rr": 1,
                                                     "note": int(m.group(1)), "src": "jRhodes3d-mono/" + fn}])
    write_set("c11_rhodes", out, {"what": "Rhodes Mark I Stage 73 (1977), 5 velocity layers, every 4th white key, unlooped, mono",
                                  "source": "jRhodes3d", "credit": RH_CREDIT, "licence": "samples CC BY-NC 4.0; free to use in music (CC0)",
                                  "repo": RH_REPO, "release": 0.35})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["drums", "vsco", "organ", "rhodes"])
    ap.add_argument("--root", required=True)
    a = ap.parse_args()
    {"drums": ingest_drums, "vsco": ingest_vsco, "organ": ingest_organ, "rhodes": ingest_rhodes}[a.what](a.root)
