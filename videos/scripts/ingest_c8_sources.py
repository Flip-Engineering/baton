#!/usr/bin/env python3
"""MUSIC c8: cut what `fetch_c8_sources.py` fetched into two small banks of REAL recordings (no synthesis, no pitch move).

    python3 videos/scripts/ingest_c8_sources.py --src DIR
      -> videos/sources/audio/inst/c8_heave/   grunts/ breaths/ bodies/ + map.json   (single men and the eleven VocalSet men)
      -> videos/sources/audio/field/           march_*.wav hooves_*.wav steam_*.wav + map.json  (real ground, real horses, a real locomotive)

The heave (engine/daw/huh.py) stacks them: a real breath in, a real throat's grunt for the attack, a real man holding a vowel at his
own note for the body.  Every clip is mono 44.1 kHz 16-bit, peak 0.5, a 3 ms fade in and out, cut where a man's own sound begins
(15 ms of his own room before the onset is kept).  The measured f0 (WORLD harvest), rise time (10 % to 90 % of the event peak), level
and source file are in map.json.

Licences (see research/capabilities/music.md, MUSIC c8):
  VocalSet (Wilkins et al., ISMIR 2018), CC BY 4.0: the credit must travel.
  USC Cinema / Sunset Editorial sound effects ("Red Library", "GOLD TAPE", archive.org), labelled CC0 1.0 on the items.
"""
import argparse
import glob
import json
import os
import sys

import numpy as np
import pyworld as pw
import soundfile as sf
from scipy import signal

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.normpath(os.path.join(HERE, "..", "sources", "audio"))


def rd(p):
    x, sr = sf.read(p)
    x = x if x.ndim == 1 else x.mean(1)
    if sr != SR:
        from fractions import Fraction
        f = Fraction(SR, sr).limit_denominator(1000)
        x = signal.resample_poly(x, f.numerator, f.denominator)
    return x.astype(np.float64)


def env_db(x, ms=8.0):
    w = max(1, int(SR * ms / 1000))
    return 20 * np.log10(np.sqrt(np.convolve(x ** 2, np.ones(w) / w, "same") + 1e-14))


def events(x, above=22.0, min_gap=0.10, min_dur=0.12, max_dur=1.6):
    e = env_db(x)
    floor, top = np.percentile(e, 8), np.percentile(e, 99.5)
    act = e > max(floor + above, top - 42)
    idx = np.flatnonzero(np.diff(np.r_[0, act.astype(int), 0]))
    segs = [(idx[i], idx[i + 1]) for i in range(0, len(idx), 2)]
    merged = []
    for a, b in segs:
        if merged and (a - merged[-1][1]) / SR < min_gap:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    out = []
    for a, b in merged:
        d = (b - a) / SR
        if d < min_dur or d > max_dur:
            continue
        ee = env_db(x[a:b], 4.0)
        ep = ee.max()
        i10, i90 = np.argmax(ee >= ep - 20), np.argmax(ee >= ep - 1.0)
        out.append(dict(a=int(a), b=int(b), dur=d, rise=(i90 - i10) / SR * 1000, snr=float(ep - floor)))
    return out


def f0info(seg):
    f0, _ = pw.harvest(seg.astype(np.float64), SR, f0_floor=60, f0_ceil=500, frame_period=10)
    v = f0[f0 > 0]
    return (float(np.median(v)) if len(v) else 0.0), float(len(v) / max(1, len(f0)))


def finish(seg, peak=0.5):
    n = len(seg)
    k = min(int(0.003 * SR), n // 4)
    seg = seg.copy()
    seg[:k] *= np.linspace(0, 1, k)
    seg[-k:] *= np.linspace(1, 0, k)
    return seg / (np.abs(seg).max() + 1e-12) * peak


def save(dirp, name, seg, info):
    os.makedirs(dirp, exist_ok=True)
    y = finish(seg)
    sf.write(os.path.join(dirp, name + ".wav"), y.astype(np.float32), SR, subtype="PCM_16")
    info = dict(info, file=name + ".wav", dur=round(len(y) / SR, 3), rms_db=round(float(20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-12)), 1))
    return info


def pick_spread(evs, n):
    """n events spread over the list (time order), best snr first inside each slice."""
    if len(evs) <= n:
        return evs
    sl = np.array_split(np.arange(len(evs)), n)
    return [max((evs[i] for i in s), key=lambda e: e["snr"]) for s in sl]


# ---------------------------------------------------------------------------------------------------- the single men
GRUNT_FILES = {   # prefix -> (how many events to keep, max rise ms)
    "R15-31": (5, 200), "R19-16": (8, 120), "R21-12": (8, 130), "R15-34": (3, 200), "R21-14": (8, 120),
    "R26-08": (12, 100), "R27-23": (12, 100), "R07-46": (3, 400), "R16-08": (3, 400)}
BREATH_FILES = {"R15-52": 8, "R15-30": 12, "R15-33": 8}


def find(src, prefix):
    g = glob.glob(os.path.join(src, "rl", prefix + "*.flac"))
    return g[0] if g else None


def grunts_and_breaths(src, out):
    mp = {"grunts": [], "breaths": []}
    for pre, (n, maxrise) in GRUNT_FILES.items():
        p = find(src, pre)
        if not p:
            continue
        x = rd(p)
        ev = [e for e in events(x, max_dur=1.1) if e["snr"] >= 30 and e["rise"] <= maxrise and 0.14 <= e["dur"]]
        keep = []
        for e in pick_spread(ev, n * 2):
            a = max(0, e["a"] - int(0.015 * SR))
            f0, vf = f0info(x[a:e["b"]])
            if pre not in ("R07-46", "R16-08") and vf < 0.3:
                continue
            keep.append((e, a, f0, vf))
        for k, (e, a, f0, vf) in enumerate(keep[:n]):
            nm = f"grunt_{pre}_{k:02d}"
            info = save(os.path.join(out, "grunts"), nm, x[a:min(len(x), e["b"] + int(0.03 * SR))],
                        {"src": os.path.basename(p), "t": round(a / SR, 2), "f0": round(f0, 1), "voiced": round(vf, 2), "rise_ms": round(e["rise"], 1),
                         "group": pre in ("R07-46", "R16-08")})
            mp["grunts"].append(info)
    for pre, n in BREATH_FILES.items():
        p = find(src, pre)
        if not p:
            continue
        x = rd(p)
        ev = [e for e in events(x, above=16, min_dur=0.25, max_dur=1.2) if e["snr"] >= 22]
        keep = []
        for e in ev:
            a = max(0, e["a"] - int(0.02 * SR))
            f0, vf = f0info(x[a:e["b"]])
            if vf <= 0.35:
                keep.append((e, a, f0, vf))
        for k, e in enumerate(pick_spread([t[0] for t in keep], n)):
            a = max(0, e["a"] - int(0.02 * SR))
            nm = f"breath_{pre}_{k:02d}"
            info = save(os.path.join(out, "breaths"), nm, x[a:min(len(x), e["b"] + int(0.03 * SR))],
                        {"src": os.path.basename(p), "t": round(a / SR, 2), "rise_ms": round(e["rise"], 1)})
            mp["breaths"].append(info)
    return mp


# ---------------------------------------------------------------------------------------------------- VocalSet bodies
def stable_runs(x, min_s=0.7, tol_cents=35.0, hop=10):
    f0, t = pw.harvest(x.astype(np.float64), SR, f0_floor=60, f0_ceil=520, frame_period=hop)
    f0 = pw.stonemask(x.astype(np.float64), f0, t, SR)
    cents = np.where(f0 > 0, 1200 * np.log2(np.maximum(f0, 1) / 440.0), np.nan)
    runs, i, n = [], 0, len(f0)
    need = int(min_s * 1000 / hop)
    while i < n:
        if np.isnan(cents[i]):
            i += 1
            continue
        j = i
        while j + 1 < n and not np.isnan(cents[j + 1]) and abs(cents[j + 1] - np.median(cents[i:j + 1])) < tol_cents:
            j += 1
        if j - i + 1 >= need:
            runs.append((i * hop / 1000.0, (j + 1) * hop / 1000.0, float(np.median(f0[i:j + 1]))))
        i = j + 1
    return runs


def _one_body(args):
    p, out, per_file, hold = args
    b = os.path.basename(p)[:-4]
    man = b.split("_")[0]
    parts = p.split(os.sep)
    tech = parts[-2]
    vowel = b.split("_")[-1]
    if vowel not in ("a", "o", "u"):
        return []
    x = rd(p)
    runs = stable_runs(x)
    if not runs:
        return []
    # loud runs first: a forte held note, not the quiet start of a long tone
    scored = sorted(runs, key=lambda r: -np.sqrt(np.mean(x[int(r[0] * SR):int(r[1] * SR)] ** 2)))
    mp = []
    for k, (t0, t1, f0) in enumerate(scored[:per_file]):
        a = int((t0 + 0.04) * SR)
        z = min(int((t1 - 0.02) * SR), a + int(hold * SR))
        seg = x[a:z]
        if len(seg) < int(0.55 * SR):
            continue
        midi = 69 + 12 * np.log2(f0 / 440.0)
        nm = f"body_{man}_{tech.replace('_', '')}_{vowel}_{k}"
        mp.append(save(os.path.join(out, "bodies"), nm, seg,
                       {"man": man, "tech": tech, "vowel": vowel, "f0": round(f0, 1), "midi": round(float(midi), 2),
                        "src": "VocalSet " + "/".join(parts[-4:]), "t": round(t0, 2)}))
    return mp


def bodies(src, out, per_file=2, hold=0.85, jobs=3):
    files = sorted(glob.glob(os.path.join(src, "vs", "FULL", "male*", "*", "*", "*.wav")))
    from multiprocessing import Pool
    with Pool(jobs) as pool:
        res = pool.map(_one_body, [(p, out, per_file, hold) for p in files], chunksize=2)
    return [m for r in res for m in r]


# ---------------------------------------------------------------------------------------------------- the mass: groups of men at once
MASS_FILES = {"R16-08": 4, "R07-46": 3, "R15-73": 3, "R15-70": 2, "R19-24": 3, "R08-07": 2, "R24-01": 2}


def mass(src, out, win=0.95):
    """Windows of several men shouting, grunting or chanting together, each starting at a rise of at least 7 dB within 120 ms (an entry)."""
    mp = []
    for pre, n in MASS_FILES.items():
        p = find(src, pre)
        if not p:
            continue
        x = rd(p)
        e = env_db(x, 20.0)
        step = int(0.02 * SR)
        cands = []
        for i in range(int(0.3 * SR), len(x) - int(win * SR), step):
            jump = e[i + int(0.12 * SR)] - e[i - int(0.25 * SR):i].mean()
            if jump >= 7.0 and e[i + int(0.12 * SR)] > np.percentile(e, 60):
                cands.append((jump, i))
        cands.sort(reverse=True)
        chosen = []
        for jump, i in cands:
            if all(abs(i - j) > int(2.5 * SR) for _, j in chosen):
                chosen.append((jump, i))
            if len(chosen) >= n:
                break
        for k, (jump, i) in enumerate(chosen):
            a = max(0, i - int(0.05 * SR))
            seg = x[a:a + int(win * SR)]
            nm = f"mass_{pre}_{k:02d}"
            mp.append(save(os.path.join(out, "mass"), nm, seg, {"src": os.path.basename(p), "t": round(a / SR, 2), "jump_db": round(float(jump), 1)}))
    return mp


# ---------------------------------------------------------------------------------------------------- field: ground, hooves, a locomotive
FIELD = [   # name, file prefix, start s, dur s
    ("march_platoon", "R16-16", 6.0, 8.0), ("march_army", "R16-15", 8.0, 8.0), ("march_gravel", "R27-40", 6.0, 8.0),
    ("march_dirt_slow", "R19-19", 4.0, 8.0), ("march_soldier_gravel", "R17-22", 2.0, 8.0), ("march_wagon", "R23-64", 14.0, 8.0),
    ("hooves_gallop_by", "R14-25", 5.0, 9.0), ("hooves_hard_ground", "R14-18", 3.6, 9.0),
    ("hooves_running", "R14-11", 8.0, 8.0), ("hooves_trot", "R23-51", 6.0, 8.0),
    ("steam_speedup", "G47-08", 11.0, 22.0), ("steam_starts", "G47-04", 0.0, 14.0)]


def field(src, out):
    mp = []
    for nm, pre, t0, d in FIELD:
        g = glob.glob(os.path.join(src, "rl", pre + "*.flac"))
        if not g:
            g = glob.glob(os.path.join(src, "rl", "**", pre + "*.flac"), recursive=True)
        if not g:
            continue
        x = rd(g[0])
        seg = x[int(t0 * SR):int((t0 + d) * SR)]
        if len(seg) < SR:
            continue
        seg = seg - np.mean(seg)
        info = save(out, nm, seg, {"src": os.path.basename(g[0]), "t": t0})
        mp.append(info)
    return mp


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--mass-only", action="store_true")
    a = ap.parse_args()
    heave = os.path.join(AUDIO, "inst", "c8_heave")
    os.makedirs(heave, exist_ok=True)
    if a.mass_only:
        mpath = os.path.join(heave, "map.json")
        mm = json.load(open(mpath))
        mm["mass"] = mass(a.src, heave)
        json.dump(mm, open(mpath, "w"), indent=1)
        print("mass", len(mm["mass"]))
        sys.exit(0)
    m = grunts_and_breaths(a.src, heave)
    m["bodies"] = bodies(a.src, heave)
    m["mass"] = mass(a.src, heave)
    json.dump({"name": "c8_heave", "what": "real recordings for a heave of men: single men's grunts and breaths (Sunset Editorial, CC0) and the eleven VocalSet men's held vowels at their own notes (CC BY 4.0), cut, never retuned",
               "credit": "VocalSet: Wilkins, Seetharaman, Wahl, Pardo, 'VocalSet: a singing voice dataset', ISMIR 2018 (CC BY 4.0). Sound effects: USC Cinema / Sunset Editorial Collection via archive.org ('Red Library', CC0 1.0 as labelled).",
               "licence": "CC BY 4.0 (bodies: the credit must travel); CC0 1.0 (grunts, breaths)", "sr": SR, **m}, open(os.path.join(heave, "map.json"), "w"), indent=1)
    fld = os.path.join(AUDIO, "field")
    os.makedirs(fld, exist_ok=True)
    f = field(a.src, fld)
    json.dump({"name": "field", "what": "real ground: marching men on dirt and gravel, horses, a steam locomotive getting up to speed (Sunset Editorial, CC0)",
               "licence": "CC0 1.0 as labelled on the archive.org items (Red Library, GOLD TAPE)", "sr": SR, "files": f}, open(os.path.join(fld, "map.json"), "w"), indent=1)
    print({k: len(v) for k, v in m.items()}, "field", len(f))
