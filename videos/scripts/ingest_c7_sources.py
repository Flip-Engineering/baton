"""MUSIC c7: build sources/audio/inst/c7_men, a men's chorus of DIFFERENT MEN (not one baritone copied).

    python3 videos/scripts/ingest_c7_sources.py [--vs DIR] [--csd DIR]

  VocalSet (Wilkins, Seetharaman, Wahl, Pardo, ISMIR 2018; Zenodo 1193957; CC BY 4.0): 11 men, long tones on AH and OH,
      'forte' and 'straight'.  Every held note (>= 1.2 s, steady within 0.7 semitone) of each man becomes a zone.
  Choral Singing Dataset (Cuesta, Gomez, Martorell, Loaiciga, 2018; Zenodo 2649950; CC BY 4.0): 4 basses of the Anton
      Bruckner Choir, each recorded alone ("Nino Dios"): the sung notes >= 0.7 s become zones, tagged with their measured
      F1/F2 so the player can prefer open (AH) or rounded (OH) vowels.
Both zips are 2 GB / 1 GB: fetch single members by HTTP range (remotezip), see the notes in research/capabilities/music.md.
Output: wav (mono, 44.1 kHz, 16-bit) per zone plus map.json (engine/daw.bank.Bank format, art 'sus', vel 1.0, plus
'man', 'vowel', 'f1', 'f2', 'kind').
"""
import glob, json, os, sys, wave
import numpy as np
import pyworld as pw
from scipy.io import wavfile
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
OUT = os.path.join(VIDEOS, "sources", "audio", "inst", "c7_men")
SR = 44100


def rd(p):
    r, x = wavfile.read(p)
    x = x.astype(np.float64)
    if x.dtype != np.float64 or np.abs(x).max() > 2:
        x = x / 32768.0
    if x.ndim > 1:
        x = x.mean(1)
    if r != SR:
        x = resample_poly(x, SR, r)
    return x


def f1f2(x):
    """Mean WORLD envelope of a held note, first two formant peaks (Hz)."""
    f0, t = pw.harvest(x, SR, f0_floor=60, f0_ceil=500, frame_period=10.0)
    sp = pw.cheaptrick(x, f0, t, SR)
    m = np.log(sp[f0 > 0].mean(0) + 1e-12)
    fr = np.arange(sp.shape[1]) * SR / 2 / (sp.shape[1] - 1)
    from scipy.ndimage import gaussian_filter1d
    m = gaussian_filter1d(m, 6)
    pk = [i for i in range(2, len(m) - 2) if m[i] > m[i - 1] and m[i] >= m[i + 1] and 250 < fr[i] < 3000]
    pk = sorted(pk, key=lambda i: fr[i])
    f1 = fr[pk[0]] if pk else 0.0
    f2 = fr[pk[1]] if len(pk) > 1 else 0.0
    return float(f1), float(f2)


def stable_notes(x, min_len=1.2, tol=0.7):
    f0, t = pw.harvest(x, SR, f0_floor=60, f0_ceil=500, frame_period=10.0)
    m = np.where(f0 > 0, 69 + 12 * np.log2(np.maximum(f0, 1) / 440), np.nan)
    out, i = [], 0
    while i < len(m):
        if np.isnan(m[i]):
            i += 1
            continue
        j = i
        while j + 1 < len(m) and not np.isnan(m[j + 1]) and abs(m[j + 1] - np.nanmedian(m[i:j + 1])) < tol:
            j += 1
        if (j - i) * 0.01 >= min_len:
            out.append((i * 0.01, (j + 1) * 0.01, float(np.nanmedian(m[i:j + 1]))))
        i = j + 1
    return out


def main():
    vs = sys.argv[sys.argv.index("--vs") + 1] if "--vs" in sys.argv else "vs"
    csd = sys.argv[sys.argv.index("--csd") + 1] if "--csd" in sys.argv else "csd/ChoralSingingDataset"
    os.makedirs(OUT, exist_ok=True)
    zones = []

    def add(x, name, note, man, vowel, kind, src):
        x = x / (np.abs(x).max() + 1e-9) * 0.7
        fn = f"{len(zones):03d}_{name}.wav"
        wavfile.write(os.path.join(OUT, fn), SR, (x * 32767).astype(np.int16))
        f1, f2 = f1f2(x)
        n = int(round(note))
        zones.append({"file": fn, "src": src, "art": "sus", "vel": 1.0, "rr": 1, "note": n, "cents": round(100 * (note - n), 1),
                      "man": man, "vowel": vowel, "kind": kind, "f1": round(f1), "f2": round(f2), "dur": round(len(x) / SR, 2)})

    for p in sorted(glob.glob(os.path.join(vs, "FULL", "male*", "long_tones", "*", "*.wav"))):
        b = os.path.basename(p)                         # m6_long_forte_a.wav
        man, _, style, v = b[:-4].split("_")
        if v not in ("a", "o"):
            continue
        x = rd(p)
        for (a, z, note) in stable_notes(x):
            seg = x[int((a + 0.30) * SR):int((z - 0.12) * SR)]      # the attack and the release are re-made by the player
            if len(seg) < 0.7 * SR:
                continue
            add(seg, f"vs_{man}_{style}_{v}_{int(round(note))}", note, man, "ah" if v == "a" else "oh", "vocalset", os.path.relpath(p, vs))
    for k in (1, 2, 3, 4):
        p = os.path.join(csd, f"CSD_ND_bass_{k}.wav")
        if not os.path.exists(p):
            continue
        x = rd(p)
        lab = np.loadtxt(os.path.join(csd, "CSD_ND_bass_notes.lab"))
        for t0, hz, d in lab:
            if d < 0.7 or hz <= 0:
                continue
            seg = x[int((t0 + 0.18) * SR):int((t0 + d - 0.08) * SR)]
            if len(seg) < 0.35 * SR:
                continue
            note = 69 + 12 * np.log2(hz / 440.0)
            f0, _ = pw.harvest(seg, SR, f0_floor=60, f0_ceil=400, frame_period=10.0)
            v = f0[f0 > 0]
            if len(v) < 0.6 * len(f0):
                continue
            mdn = 69 + 12 * np.log2(np.median(v) / 440)
            if abs(mdn - note) > 0.6 or np.std(69 + 12 * np.log2(v / 440)) > 0.5:
                continue
            f1, f2 = f1f2(seg)
            vow = "ah" if f1 > 560 else "oh" if f1 > 330 else "oo"
            add(seg, f"csd_bass{k}_{int(round(mdn))}_{int(t0 * 10)}", mdn, f"csd_bass{k}", vow, "csd_bass", f"CSD_ND_bass_{k}.wav @{t0:.2f}s")
    info = {"name": "c7_men", "what": "men of many voices: 11 VocalSet men (AH/OH, C3-F4) and 4 CSD basses (F2-G3), one recorded singer per zone, NOT copies",
            "source": "VocalSet (Zenodo 1193957); Choral Singing Dataset (Zenodo 2649950)",
            "credit": "VocalSet: Wilkins, Seetharaman, Wahl, Pardo, 'VocalSet: a singing voice dataset', ISMIR 2018 (CC BY 4.0). Choral Singing Dataset: Cuesta, Gomez, Martorell, Loaiciga, 2018 (CC BY 4.0).",
            "licence": "CC BY 4.0 (credit must travel with a published piece)", "sr": SR, "release": 0.4, "zones": zones}
    json.dump(info, open(os.path.join(OUT, "map.json"), "w"), indent=1)
    men = sorted({z["man"] for z in zones})
    print(len(zones), "zones", len(men), "singers:", {m: sum(1 for z in zones if z["man"] == m) for m in men})
    from collections import Counter
    print(Counter((z["kind"], z["note"]) for z in zones))


if __name__ == "__main__":
    main()
