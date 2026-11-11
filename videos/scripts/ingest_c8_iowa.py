#!/usr/bin/env python3
"""MUSIC c8: a second brass player for CIVILIZATION: the University of Iowa Musical Instrument Samples (Electronic Music Studios),
French horn (Jessica Wiskus, 1997), Bb trumpet (no vibrato) and tenor trombone, recorded ANECHOIC (5 ft, cardioid): the raw, close, dry
sound a stopped, driven, close-miked horn needs.  VSCO (c6_*) is a different player in a different room.

    python3 videos/scripts/ingest_c8_iowa.py DIR        # fetches the chromatic-scale aiff files into DIR (about 30 MB), cuts them, writes
                                                        #   videos/sources/audio/inst/c8_iowa_{horn,tpt,tbn}/ (map.json + one wav per note)
Licence: the EMS site says "All of the recordings may be downloaded and used for any projects without restrictions" (Iowa MIS, free; credit
given anyway: "University of Iowa Electronic Music Studios, Musical Instrument Samples").  Every note's MEASURED pitch (engine/daw/pitchqa) is
kept as note + cents, so the bank removes each note's own few cents the way the VSCO sets do.  Delete DIR afterwards.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from engine.daw import pitchqa  # noqa: E402

SR = 44100
BASE = "https://theremin.music.uiowa.edu/sound files/MIS/Brass/"
SETS = {
    "c8_iowa_horn": ("frenchhorn", [("Horn.ff.%s.aiff", 1.0, ["Bb1B1", "C2B2", "C3B3", "C4B4", "C5F5"]), ("Horn.mf.%s.aiff", 0.6, ["C2B2", "C4B4", "C5F5"])]),
    "c8_iowa_tpt": ("Bbtrumpet", [("Trumpet.novib.ff.%s.aiff", 1.0, ["E3B3", "C4B4", "C5B5", "C6Eb6"]), ("Trumpet.novib.mf.%s.aiff", 0.6, ["E3B3", "C4B4", "C5B5", "C6D6"])]),
    "c8_iowa_tbn": ("tenortrombone", [("TenorTrombone.mf.%s.aiff", 1.0, ["C3B3", "C4B4"]), ("TenorTrombone.pp.%s.aiff", 0.4, ["C3B3"])]),
}


def fetch(sub, name, D):
    dest = os.path.join(D, sub, name)
    if os.path.exists(dest):
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    url = urllib.parse.quote(BASE + sub + "/" + name, safe=":/")
    try:
        open(dest, "wb").write(urllib.request.urlopen(url, timeout=120).read())
    except Exception as e:  # noqa: BLE001
        print("FAIL", name, e)
        return None
    return dest


def notes_of(x):
    """Slice a chromatic-scale recording into notes: runs above -38 dB of the file's loud level."""
    w = int(0.01 * SR)
    e = 20 * np.log10(np.sqrt(np.convolve(x ** 2, np.ones(w) / w, "same")) + 1e-9)
    thr = np.percentile(e, 98) - 32
    act = e > thr
    idx = np.flatnonzero(np.diff(np.r_[0, act.astype(int), 0]))
    segs = [(idx[i], idx[i + 1]) for i in range(0, len(idx), 2)]
    out = []
    for a, b in segs:
        if out and (a - out[-1][1]) / SR < 0.12:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return [(a, b) for a, b in out if (b - a) / SR > 0.25]


def main(D):
    root = os.path.join(HERE, "..", "sources", "audio", "inst")
    for setname, (sub, files) in SETS.items():
        od = os.path.join(root, setname)
        os.makedirs(od, exist_ok=True)
        zones = []
        for pat, vel, ranges in files:
            for rg in ranges:
                nm = pat % rg
                p = fetch(sub, nm, D)
                if not p:
                    continue
                x, sr = sf.read(p)
                x = x if x.ndim == 1 else x.mean(1)
                if sr != SR:
                    x = signal.resample_poly(x, SR, sr)
                segs = notes_of(x)
                for k, (a, b) in enumerate(segs):
                    a0 = max(0, a - int(0.02 * SR))
                    seg = x[a0:b + int(0.05 * SR)].copy()
                    seg *= 0.5 / (np.abs(seg).max() + 1e-9)
                    kf = int(0.004 * SR)
                    seg[:kf] *= np.linspace(0, 1, kf)
                    seg[-int(0.04 * SR):] *= np.linspace(1, 0, int(0.04 * SR))
                    try:
                        m = pitchqa.f0(seg.astype(float), SR, fmin=40.0, fmax=1500.0)
                        hz = float(m[0])
                    except Exception:  # noqa: BLE001
                        continue
                    midf = 69 + 12 * np.log2(hz / 440.0)
                    note = int(round(midf))
                    cents = float((midf - note) * 100)
                    fn = f"{setname[8:]}_{rg}_{int(vel * 10)}_{k:02d}_{note}.wav"
                    sf.write(os.path.join(od, fn), seg.astype(np.float32), SR, subtype="PCM_16")
                    zones.append({"file": fn, "src": f"MIS/Brass/{sub}/{nm} #{k}", "art": "sus", "vel": vel, "rr": 1, "note": note, "cents": round(cents, 1),
                                  "dur": round(len(seg) / SR, 2)})
        zones.sort(key=lambda z: (z["vel"], z["note"]))
        json.dump({"name": setname, "what": "University of Iowa MIS brass, anechoic, chromatic notes cut from the scale files (measured pitch)",
                   "source": "theremin.music.uiowa.edu (Electronic Music Studios, University of Iowa)", "licence": "free, without restriction (as stated on the site)",
                   "credit": "University of Iowa Electronic Music Studios, Musical Instrument Samples", "sr": SR, "release": 0.15, "zones": zones},
                  open(os.path.join(od, "map.json"), "w"), indent=1)
        print(setname, len(zones), "notes", sorted({z["note"] for z in zones})[:3], "...")


if __name__ == "__main__":
    main(sys.argv[1])
