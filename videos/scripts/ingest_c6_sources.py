#!/usr/bin/env python3
"""MUSIC c6: ingest the VSCO 2 CE (CC0) sections the c6 rendering layer plays, with every root MEASURED.

    python3 videos/scripts/ingest_c6_sources.py --vsco /path/to/VSCO-2-CE [--only horn,tuba] [--no-measure]

Get the source without pulling all of it (about 1.2 GB with history for the parts used; delete it after):
    git clone --filter=blob:none --no-checkout --depth 1 https://github.com/sgossner/VSCO-2-CE.git vsco
    cd vsco && git sparse-checkout init --no-cone && git sparse-checkout set "/Brass/" "/Percussion/Timpani/" ... && git checkout

Writes videos/sources/audio/inst/c6_<set>/ (16-bit wav, mono for solo winds and brass, stereo for percussion, leading
silence trimmed to 3 ms before the attack, sustains capped at 3.5 s) and map.json in the engine/instruments.Sampler
format plus per-zone `art` (sus, stac, mute), `vel` (0-1 from the file's v-number), `rr`, `note` (MIDI, middle C = 60,
after the measured octave convention) and `cents` (the measured departure from equal temperament at A=440).  The
filenames use the "middle C = C3" convention (note = 12 * (octave + 2) + pitch class); pitchqa checks every file and the
set-level octave offset is written down, not assumed.  VSCO's trumpets sit 15-25 cents sharp of A=440; the bank
retunes each zone by its measured cents so sections agree.
"""
import argparse
import json
import os
import re
import sys

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)
from engine.daw import pitchqa  # noqa: E402

OUT = os.path.join(VIDEOS, "sources", "audio", "inst")
PC = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
NOTE_RE = re.compile(r"_([A-G]#?)(-?\d)_")
VEL_RE = re.compile(r"_v(\d)(?:_|\.)")
RR_RE = re.compile(r"(?:rr|_)(\d)(?:_|\.wav)")
CREDIT = "Versilian Studios (Sam Gossner, Simon Dalzell) and contributors, VSCO 2 Community Edition, CC0 1.0"

# set -> (mono?, struck?, [(subdir, art, pattern-or-None)], max_seconds, what)
SETS = {
    "horn": (True, False, [("Brass/F Horn/sus", "sus"), ("Brass/F Horn/stac", "stac"), ("Brass/F Horn/mute", "mute")], 3.5,
             "F horn, sustains, staccato and stopped"),
    "tuba": (True, False, [("Brass/Tuba/sus", "sus"), ("Brass/Tuba/stac", "stac")], 3.5, "tuba, sustains and staccato"),
    "tbn": (True, False, [("Brass/Tenor Trombone/sus", "sus"), ("Brass/Tenor Trombone/stac", "stac")], 3.5,
            "tenor trombone, sustains and staccato"),
    "tpt": (True, False, [("Brass/Trumpet/sus", "sus"), ("Brass/Trumpet/stac", "stac"), ("Brass/Trumpet/harmonM-sus", "mute")], 3.5,
            "trumpet, sustains, staccato and harmon-muted"),
    "picc": (True, False, [("Woodwinds/Piccolo/Sus", "sus"), ("Woodwinds/Piccolo/Stac", "stac")], 3.0, "piccolo"),
    "clar": (True, False, [("Woodwinds/Clarinet/susLong", "sus"), ("Woodwinds/Clarinet/stac", "stac")], 3.5, "clarinet"),
    "bsn": (True, False, [("Woodwinds/Bassoon/sus", "sus"), ("Woodwinds/Bassoon/stac", "stac")], 3.5, "bassoon"),
    "timp": (False, True, [("Percussion/Timpani", "hit")], 3.5, "timpani, five drums, hits"),
}
# unpitched percussion sets: file globs under the VSCO root -> (art)
PERC = {
    "bdrum": ([("Percussion", r"^BDrumNewhit_v(\d)_rr(\d)_Sum\.wav$", "hit")], "concert bass drum (VSCO 2), 7 velocities x 2 round robins"),
    "snare": ([("VSCO 1 Percussion/drums/snare/drum3_marching", r"^snare3_(ppp|pp|p|mp|f|fff)_(\d)\.wav$", "hit"),
               ("VSCO 1 Percussion/drums/snare/drum3_marching", r"^snare3_rimshot_(f|ff)_(\d)\.wav$", "rim")],
              "marching snare (VSCO 1), dynamics ppp-fff, rimshots"),
    "tenor": ([("VSCO 1 Percussion/drums/tenor/tenor_lower", r"^tenor_(ppp|pp|mp|mf|f|ff|fff)_(\d)\.wav$", "low"),
               ("VSCO 1 Percussion/drums/tenor/tenor_higher", r"^tenorH_(pp|p|mp|mf|f|ff|fff)_(\d)\.wav$", "high")],
              "tenor drums (quads), lower and higher heads"),
    "gbdrum": ([("VSCO 1 Percussion/drums/bass", r"^bdrum_(ppp|pp|p|mp|f|fff)_(\d)\.wav$", "hit"),
                ("VSCO 1 Percussion/drums/bass", r"^bdrum_muted_(ppp|pp|mp|mf|ff|fff)_(\d)\.wav$", "muted")],
               "marching bass drum (VSCO 1), dynamics, open and muted"),
    "anvil": ([("Percussion", r"^Anvil_Hit1_v(\d)_Sum\.wav$", "hit")], "anvil"),
}
DYN = {"ppp": 0.12, "pp": 0.22, "p": 0.36, "mp": 0.5, "mf": 0.62, "f": 0.75, "ff": 0.88, "fff": 1.0}


def to_int16(x):
    return np.clip(np.round(x * 32767), -32768, 32767).astype(np.int16)


def load(path):
    r, x = wavfile.read(path)
    if x.dtype == np.int16:
        x = x / 32768.0
    elif x.dtype == np.int32:
        x = x / 2147483648.0
    else:
        x = x.astype(float)
    if x.ndim == 1:
        x = x[:, None]
    return r, x


def trim(x, sr, maxs, fade=0.06):
    a = np.abs(x).max(1)
    thr = max(a.max() * 0.02, 1e-4)
    i = int(np.argmax(a > thr))
    i = max(0, i - int(0.003 * sr))
    y = x[i:i + int(maxs * sr)]
    k = min(int(fade * sr), len(y) // 4)
    if len(y) >= int(maxs * sr) - 2 and k:
        y = y.copy()
        y[-k:] *= np.linspace(1, 0, k)[:, None]
    return y


def parse(fn):
    m = NOTE_RE.search(fn)
    note = 12 * (int(m.group(2)) + 2) + PC[m.group(1)] if m else None
    v = VEL_RE.search(fn)
    return note, (int(v.group(1)) if v else None)


def timpani_pitch(path):
    """A kettledrum's perceived pitch: the lower of its two strongest modes when they sit at about 1 : 1.5 (the (1,1) and
    (2,1) modes of a tuned head).  The harmonic comb in pitchqa is for harmonic sounds and reads a timpani nonsense."""
    from scipy.signal import find_peaks
    r, x = wavfile.read(path)
    x = x.astype(float) / 32768
    x = x.mean(1) if x.ndim == 2 else x
    a = int(0.10 * r)
    seg = x[a:a + int(0.9 * r)]
    N = 1 << 18
    S = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), N))
    fr = np.fft.rfftfreq(N, 1 / r)
    band = (fr > 40) & (fr < 500)
    pk, _ = find_peaks(S[band], height=S[band].max() * 0.25, distance=200)
    f, h = fr[band][pk], S[band][pk]
    o = np.argsort(-h)[:4]
    cand = sorted(f[o])
    pick = cand[0]
    for lo in cand:
        if any(abs(hi / lo - 1.5) < 0.06 for hi in cand):
            pick = lo
            break
    return 69 + 12 * np.log2(pick / 440.0)


def ingest_pitched(name, spec, root, measure):
    mono, struck, parts, maxs, what = spec
    d = os.path.join(OUT, f"c6_{name}")
    os.makedirs(d, exist_ok=True)
    zones = []
    for sub, art in parts:
        p = os.path.join(root, sub)
        if not os.path.isdir(p):
            print(f"  {name}: missing {sub}", file=sys.stderr)
            continue
        for fn in sorted(os.listdir(p)):
            if not fn.endswith(".wav"):
                continue
            note, v = parse(fn)
            if note is None and name != "timp":
                continue
            r, x = load(os.path.join(p, fn))
            x = trim(x, r, maxs)
            if mono:
                x = x.mean(1, keepdims=True)
            tm = re.search(r"Timpani(\d)_Hit_v(\d)_rr(\d)", fn)
            rr = 1
            m = re.search(r"_rr(\d)", fn)
            if m:
                rr = int(m.group(1))
            elif re.search(r"_v\d_(\d)\.wav", fn):
                rr = int(re.search(r"_v\d_(\d)\.wav", fn).group(1))
            if tm:
                v, rr = int(tm.group(2)), int(tm.group(3))
            out = f"{len(zones):03d}_{art}_{fn.replace(' ', '_')}"
            wavfile.write(os.path.join(d, out), r, to_int16(x))
            zones.append({"file": out, "src": os.path.join(sub, fn), "art": art, "vel_n": v, "rr": rr, "note": note,
                          "struck": bool(struck or art == "stac" or art == "hit"), "drum": int(tm.group(1)) if tm else None,
                          "sr": r, "dur": round(len(x) / r, 3)})
    vmax = {}
    for z in zones:
        vmax[z["art"]] = max(vmax.get(z["art"], 1), z["vel_n"] or 1)
    for z in zones:
        z["vel"] = round((z["vel_n"] or vmax[z["art"]]) / vmax[z["art"]], 3)
    # measure: the timpani's pitch is the drum's tuning (each of five drums), everything else is checked against its name
    if measure:
        for z in zones:
            wp = os.path.join(d, z["file"])
            if name == "timp":
                z["_fm"] = float(timpani_pitch(wp))
                z["conf"] = 0.5
            elif z["note"] is not None:
                c = pitchqa.check(wp, z["note"], struck=z["struck"])
                z["cents"], z["octave_err"], z["conf"], z["measured_midi"] = c["cents"], c["octave"], c["conf"], c["measured_midi"]
        if name == "timp":                        # one tuning per drum: the median over its hits
            for dn in {z["drum"] for z in zones}:
                zz = [z for z in zones if z["drum"] == dn]
                fm = float(np.median([z["_fm"] for z in zz]))
                for z in zz:
                    z["note"], z["cents"] = int(round(fm)), round((fm - round(fm)) * 100, 1)
                    z.pop("_fm", None)
        errs = [z["octave_err"] for z in zones if "octave_err" in z and z["conf"] >= 0.25]
        off = int(round(float(np.median(errs)))) if errs else 0
        good = [z["cents"] for z in zones if "cents" in z and z.get("conf", 0) >= 0.25 and z.get("octave_err", 0) == off]
        med = float(np.median(good)) if good else 0.0
        for z in zones:
            if name != "timp" and "cents" in z and (z.get("conf", 0) < 0.25 or abs(z["cents"] - med) > 40):
                z["cents"] = round(med, 1)        # a short or noisy file: use the set's measured tuning
                z["cents_from"] = "set median"
    else:
        off, med = 0, 0.0
    if measure and off:
        for z in zones:
            if z["note"] is not None and name != "timp":
                z["note"] += 12 * off
    info = {"name": f"c6_{name}", "what": what, "source": "VSCO", "credit": CREDIT, "licence": "CC0 1.0",
            "repo": "https://github.com/sgossner/VSCO-2-CE", "octave_offset_applied": off,
            "convention": "filenames C3 = middle C (MIDI 60); measured", "set_cents_median": round(med, 1),
            "sr": zones[0]["sr"] if zones else 44100, "release": 0.25, "zones": zones}
    json.dump(info, open(os.path.join(d, "map.json"), "w"), indent=1)
    sz = sum(os.path.getsize(os.path.join(d, z["file"])) for z in zones) / 1e6
    print(f"  c6_{name}: {len(zones)} zones, {sz:.1f} MB, octave offset {off}, tuning median {med:+.1f} c")


def ingest_perc(name, spec, root):
    rules, what = spec
    d = os.path.join(OUT, f"c6_{name}")
    os.makedirs(d, exist_ok=True)
    zones = []
    for sub, rx, art in rules:
        p = os.path.join(root, sub)
        if not os.path.isdir(p):
            print(f"  {name}: missing {sub}", file=sys.stderr)
            continue
        for fn in sorted(os.listdir(p)):
            m = re.match(rx, fn)
            if not m:
                continue
            g = m.groups()
            a = g[0]
            v = DYN[a] if a in DYN else None
            vn = int(a) if a.isdigit() else None
            rr = int(g[1]) if len(g) > 1 else 1
            r, x = load(os.path.join(p, fn))
            x = trim(x, r, 3.0)
            out = f"{len(zones):03d}_{art}_{fn.replace(' ', '_')}"
            wavfile.write(os.path.join(d, out), r, to_int16(x))
            zones.append({"file": out, "src": os.path.join(sub, fn), "art": art, "vel_n": vn, "vel": v, "rr": rr,
                          "unpitched": True, "sr": r, "dur": round(len(x) / r, 3)})
    vmax = max((z["vel_n"] for z in zones if z["vel_n"]), default=1)
    for z in zones:
        if z["vel"] is None:
            z["vel"] = round((z["vel_n"] or vmax) / vmax, 3)
    info = {"name": f"c6_{name}", "what": what, "source": "VSCO", "credit": CREDIT, "licence": "CC0 1.0",
            "repo": "https://github.com/sgossner/VSCO-2-CE", "sr": 44100, "release": 0.3, "zones": zones}
    json.dump(info, open(os.path.join(d, "map.json"), "w"), indent=1)
    sz = sum(os.path.getsize(os.path.join(d, z["file"])) for z in zones) / 1e6
    print(f"  c6_{name}: {len(zones)} zones, {sz:.1f} MB")


def ingest_men():
    """The Karoryfer 'Hadzi-Fia' AH samples already in sources/audio/choir (CC0): one baritone singing a steady vowel.
    The file names say A3 A4 C4 D4 E4 G4; they sound an octave lower AND 12-60 cents flat of A=440 (measured, and
    every harmonic agrees with the fundamental, so it is the singer's pitch and not an estimator error).  BANK read
    them as women at C4.  Here each keeps its measured pitch and cents, so a men's unison can be tuned to the key."""
    src = os.path.join(VIDEOS, "sources", "audio", "choir")
    d = os.path.join(OUT, "c6_men")
    os.makedirs(d, exist_ok=True)
    zones = []
    for fn in sorted(os.listdir(src)):
        if not fn.endswith(".wav"):
            continue
        r, x = load(os.path.join(src, fn))
        x = x.mean(1, keepdims=True)
        x = trim(x, r, 6.0, fade=0.3)
        out = f"{len(zones):03d}_{fn}"
        wavfile.write(os.path.join(d, out), r, to_int16(x))
        m = pitchqa.f0_file(os.path.join(d, out))
        # a steady sung vowel: read the fundamental from the 3rd-6th partials (the comb is unreliable on its own here)
        note = int(round(m["midi"]))
        zones.append({"file": out, "src": "choir/" + fn, "art": "sus", "vel": 1.0, "rr": 1, "note": note,
                      "cents": round((m["midi"] - note) * 100, 1), "conf": m["conf"], "vowel": "ah", "sr": r,
                      "dur": round(len(x) / r, 3), "name_says": fn.split("_")[-1][:-4]})
    info = {"name": "c6_men", "what": "one baritone, sustained AH, six pitches (A2-A3), measured", "source": "Karoryfer Samples, Hadzi-Fia (via sfzinstruments/legato_vocal_tutorial)",
            "credit": "Karoryfer Samples (Hadzi-Fia), CC0 1.0", "licence": "CC0 1.0", "octave_offset_applied": 0, "sr": 44100,
            "release": 0.4, "zones": zones}
    json.dump(info, open(os.path.join(d, "map.json"), "w"), indent=1)
    print("  c6_men:", [(z["name_says"], z["note"], z["cents"]) for z in zones])


def ingest_throat(path):
    """A CC0 throat singer (Adrian Wolfe, archive.org 'ThroatSinging'): a steady kargyraa-like drone near D3 (150.6 Hz),
    kept as a loopable drone with its measured pitch, to be tuned to the song's C."""
    import subprocess
    ff = "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
    d = os.path.join(OUT, "c6_throat")
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "_t.wav")
    subprocess.run([ff, "-v", "error", "-y", "-ss", "1.0", "-t", "13.5", "-i", path, "-ac", "1", "-ar", "44100", tmp], check=True)
    r, x = load(tmp)
    os.remove(tmp)
    x = x / (np.abs(x).max() + 1e-9) * 0.7
    wavfile.write(os.path.join(d, "drone.wav"), r, to_int16(x))
    m = pitchqa.f0_file(os.path.join(d, "drone.wav"))
    note = int(round(m["midi"]))
    info = {"name": "c6_throat", "what": "throat singer, steady drone, 13.5 s", "source": "archive.org ThroatSinging, Adrian Wolfe",
            "credit": "Adrian Wolfe (archive.org ThroatSinging), CC0 1.0", "licence": "CC0 1.0", "sr": r, "release": 0.6,
            "zones": [{"file": "drone.wav", "art": "sus", "vel": 1.0, "rr": 1, "note": note, "cents": round((m["midi"] - note) * 100, 1),
                       "conf": m["conf"], "dur": round(len(x) / r, 3)}]}
    json.dump(info, open(os.path.join(d, "map.json"), "w"), indent=1)
    print("  c6_throat:", info["zones"][0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vsco", default=None, help="VSCO 2 CE checkout (not needed for --only men,throat)")
    ap.add_argument("--only")
    ap.add_argument("--throat", help="path to the CC0 throat-singing recording (archive.org ThroatSinging)")
    ap.add_argument("--no-measure", action="store_true")
    a = ap.parse_args()
    only = set(a.only.split(",")) if a.only else None
    for n, spec in SETS.items():
        if a.vsco and (only is None or n in only):
            ingest_pitched(n, spec, a.vsco, not a.no_measure)
    for n, spec in PERC.items():
        if a.vsco and (only is None or n in only):
            ingest_perc(n, spec, a.vsco)
    if only is None or "men" in only:
        ingest_men()
    if a.throat and (only is None or "throat" in only):
        ingest_throat(a.throat)


if __name__ == "__main__":
    main()
