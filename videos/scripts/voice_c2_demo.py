#!/usr/bin/env python3
"""VOICE c2 demo: reels per register (candidates raw and through the prosody layer, a real reference, loudness-matched,
phone copy), the READY scansion sheet with a MEASURED voice lane, the crowd cast check.

    python3 scripts/voice_c2_demo.py refs          # cut the real references (LoC 1912, Apollo 15, LibriVox) from models/voice/ref
    python3 scripts/voice_c2_demo.py call|announcer|intimate|crowd
    python3 scripts/voice_c2_demo.py ready         # READY bed + performed calls, slot on/off, three-lane sheet
    python3 scripts/voice_c2_demo.py all

Outputs go to review/studio_voice_c2/after/ (reel_*.m4a, reel_*_phone.m4a, reel_*.txt, sheets/*.png, metrics.json).
Every number is an aid to listening. Nobody has listened yet (the builder is a text model without ears): the reels
are for the client and an operator to hear on a phone first.
"""
import json
import os
import pickle
import sys
import hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from engine import audio as A  # noqa: E402
from engine.voice import models as M, prosody as P, measure as ME, gang as G, judge as J, mix as MX  # noqa: E402

OUT = os.path.join(VIDEOS, "review", "studio_voice_c2", "after")
REF = os.path.join(VIDEOS, "models", "voice", "ref")
CACHE = os.environ.get("ACP_VOICE_DEMO_CACHE", "/tmp/vc2cache")
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, "sheets"), exist_ok=True)
os.makedirs(CACHE, exist_ok=True)
SR = 44100
METRICS_PATH = os.path.join(OUT, "metrics.json")


def _metrics():
    try:
        return json.load(open(METRICS_PATH))
    except Exception:  # noqa: BLE001
        return {}


def _save_metrics(m):
    json.dump(m, open(METRICS_PATH, "w"), indent=1, default=float)


def take(model, text, voice, phon=None):
    """A raw model take, cached on disk."""
    k = hashlib.sha1(f"{model}|{voice}|{text}|{phon}".encode()).hexdigest()[:16]
    f = os.path.join(CACHE, k + ".pkl")
    if os.path.exists(f):
        return pickle.load(open(f, "rb"))
    x, sr = M.synth(model, text, voice, phon=phon)
    pickle.dump((x, sr), open(f, "wb"))
    return x, sr


def stats(y, sr, text=None):
    d = dict(hnr_db=round(ME.hnr_db(y, sr), 1), flat_1_4k=round(ME.flatness(y, sr), 3),
             band_300_3400=round(ME.band_share(y, sr), 2), dur=round(len(y) / sr, 2))
    if text:
        d["asr"] = round(ME.asr_score(y, sr, text), 2)
    return d


# ------------------------------------------------------------------ real references
def _window(x, sr, dur):
    """The dur-second window with the most speech-like activity (frames above -35 dB of the file's 99th percentile)."""
    h = int(0.05 * sr)
    e = np.array([np.sqrt(np.mean(x[i:i + h] ** 2)) for i in range(0, len(x) - h, h)]) + 1e-9
    db = 20 * np.log10(e / np.percentile(e, 99))
    act = (db > -30).astype(float)
    w = int(dur / 0.05)
    cs = np.cumsum(np.r_[0, act])
    score = cs[w:] - cs[:-w]
    # avoid the first 3 s (announcements, clicks)
    lo = int(3 / 0.05)
    i = lo + int(np.argmax(score[lo:])) if len(score) > lo else 0
    return x[i * h: i * h + int(dur * sr)]


def refs():
    out = {}
    for name, fn, dur in (("wilson_1912", "wilson_labor_1912.mp3", 9.0), ("apollo15", "apollo15_a.mp3", 9.0),
                          ("librivox", "librivox_manifesto.mp3", 9.0)):
        x, sr = sf.read(os.path.join(REF, fn))
        x = x.mean(axis=1) if x.ndim > 1 else x
        w = _window(x, sr, dur)
        pickle.dump((w, sr), open(os.path.join(CACHE, f"ref_{name}.pkl"), "wb"))
        out[name] = stats(w, sr)
        print(name, out[name])
    m = _metrics()
    m["refs"] = out
    _save_metrics(m)


def ref(name):
    return pickle.load(open(os.path.join(CACHE, f"ref_{name}.pkl"), "rb"))


# ------------------------------------------------------------------ sheets
def sheet(rows, path, title):
    """rows: [(label, mono, sr)] -> one PNG: spectrogram 0-5 kHz with f0 overlay per row."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.signal import spectrogram
    n = len(rows)
    fig, axs = plt.subplots(n, 1, figsize=(13, 1.55 * n + 0.6), squeeze=False)
    for ax, (lab, x, sr) in zip(axs[:, 0], rows):
        x = np.asarray(x, dtype=np.float64)
        f, t, S = spectrogram(x, sr, nperseg=int(sr * 0.03), noverlap=int(sr * 0.024), nfft=2048)
        ax.pcolormesh(t, f, 10 * np.log10(S + 1e-11), vmin=-105, vmax=-35, shading="auto", cmap="magma")
        ax.set_ylim(0, 5000)
        A_ = P.analyse(x, sr)
        f0 = A_["f0"]
        ax2 = ax.twinx()
        ax2.plot(A_["t"] - A_["pad"], np.where(f0 > 0, f0, np.nan), ".", ms=1.6, color="#5df")
        ax2.set_ylim(60, 420)
        ax2.set_yticks([])
        ax.set_ylabel(lab, rotation=0, ha="right", va="center", fontsize=7)
        ax.set_yticks([0, 2000, 4000])
        ax.tick_params(labelsize=6)
    fig.suptitle(title, fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=70)
    plt.close(fig)


# ------------------------------------------------------------------ the READY score
def ready_lines():
    from engine.score import abc, scansion
    sc = abc.parse(open(os.path.join(VIDEOS, "web", "audio", "scores", "ready_c5.abc")).read(), "ready")
    return scansion.lines_from_score(sc), sc.bpm


GROUPS = [(0, 1, "five a m"), (1, 4, None), (4, 5, None), (5, 7, None), (7, 9, None), (9, 10, None), (10, 11, None),
          (11, 13, None), (13, 16, None), (16, 18, None)]


def group_text(lines, a, b, override=None):
    if override:
        return override
    ws = []
    for ln in lines[a:b]:
        for w in dict.fromkeys(s.word for s in ln.syls):
            ws.append(w.lower().strip(".,!?"))
    return " ".join(ws)


def call_candidates():
    return [("kokoro1", "am_fenrir"), ("kokoro1", "am_michael"), ("pocket", "alba"), ("piper", 6)]


def _perf(x, sr, syls, reg, **kw):
    return P.perform(x, sr, syls, reg, **kw)


# ------------------------------------------------------------------ reels
def reel_call():
    lines, bpm = ready_lines()
    S16 = 60 / bpm / 4
    items, rows, met = [], [], {}
    w, wsr = ref("wilson_1912")
    items.append(("REAL ref: 1912 orator (LoC National Jukebox, public domain), 9 s", w, wsr))
    rows.append(("REAL 1912 orator", w, wsr))
    met["ref_wilson_1912"] = stats(w, wsr)
    ga, gb = 1, 4
    text = group_text(lines, ga, gb)
    syls = P.syls_from_lines(lines[ga:gb], bpm)
    for m, v in call_candidates():
        x, sr = take(m, text, v)
        name = f"{m}:{v}"
        items.append((f"{name} RAW read (the model's own prosody)", x, sr))
        y, meta = _perf(x, sr, syls, "call")
        items.append((f"{name} + PROSODY call (READY grid, 100 BPM)", y, sr))
        rows += [(f"{name}\nraw", x, sr), (f"{name}\ncall", y, sr)]
        mm = ME.grid_check(y, sr, syls, meta["lead"])
        met[name] = dict(raw=stats(x, sr, text), call=stats(y, sr, text), scansion=ME.grid_scansion(mm, syls, meta["lead"]))
    # answers: real cast for three pieces, a synth gang, and the real crowd for reference
    n_ans = 4
    times = [0.0, 0.6, 1.2, 1.8]
    for seed in (1, 2, 3):
        cst = G.cast(seed, 5)
        b = G.real_answer(times, cst, seed=seed, length=3.2)
        items.append((f"ANSWER real cast for piece #{seed} ({', '.join(k for k, _ in cst)}) on four beats",
                      b.mean(axis=1), SR))
        met[f"answer_cast_{seed}"] = stats(b.mean(axis=1), SR)
    sy2 = [dict(text="HEY", t=0.0, dur=0.3, stress=3, word="hey"), dict(text="HAH", t=0.32, dur=0.45, stress=3, word="hah")]
    st, _ = G.synth_gang("hey hah", sy2, [("kokoro1", "am_fenrir"), ("kokoro1", "am_michael"), ("kokoro1", "am_puck"),
                                            ("piper", 6), ("piper", 42), ("pocket", "alba")], seed=1)
    items.append(("ANSWER synth gang, six voices, prosody 'crowd' register: HEY-HAH", st.mean(axis=1), SR))
    met["answer_synth_gang"] = stats(st.mean(axis=1), SR)
    rr = A_load("crowd_men_rallying")
    items.append(("REAL ref: men rallying (freesound CC0), 6 s", rr[: 6 * SR], SR))
    met["ref_men_rallying"] = stats(rr[: 6 * SR], SR)
    J.reel(items, os.path.join(OUT, "reel_call_answer"), sr=SR)
    sheet(rows, os.path.join(OUT, "sheets", "call_spectrograms.png"),
          "CALL register: raw model take vs the same take through the prosody layer, READY 'THINGS CANNOT GO ON...' at 100 BPM")
    return met


def A_load(name):
    from engine import samples as S
    x = S.load(name)
    return x.mean(axis=1) if x.ndim == 2 else x


def reel_announcer():
    lines = "Gary, Indiana. Twenty thirty-six. The furnace is relit. The shift is short. The city is built."
    syl_txt = [("Gary", 1), ("In", 0), ("di", 3), ("an", 0), ("a", 0)]
    from engine.score import prosody as SP
    ps = SP.line("GARY, INDIANA. TWENTY THIRTY-SIX. THE FURNACE IS RELIT. THE SHIFT IS SHORT. THE CITY IS BUILT.")
    items, rows, met = [], [], {}
    for nm in ("apollo15", "wilson_1912"):
        w, wsr = ref(nm)
        items.append((f"REAL ref: {nm} (public domain), 9 s", w, wsr))
        rows.append((f"REAL {nm}", w, wsr))
        met["ref_" + nm] = stats(w, wsr)
    cands = [("kokoro1", "bm_george"), ("kokoro1", "am_michael"), ("pocket", "javert"), ("piper", 42)]
    for m, v in cands:
        x, sr = take(m, lines, v)
        A_ = P.analyse(x, sr)
        n_syl = len(ps)
        syls = [dict(text=s.text, t=i * 0.2, dur=0.2, stress=int(s.stress), word=s.word, phrase=0) for i, s in enumerate(ps)]
        # phrase ids: a new phrase after each full stop (the score line's sentence breaks)
        ph = 0
        words = "GARY, INDIANA. TWENTY THIRTY-SIX. THE FURNACE IS RELIT. THE SHIFT IS SHORT. THE CITY IS BUILT.".split()
        y, meta = P.perform(x, sr, _announcer_syls(ps), "announcer", natural=True, analysis=A_)
        name = f"{m}:{v}"
        items.append((f"{name} RAW read", x, sr))
        items.append((f"{name} + PROSODY announcer (newsreel band)", y, sr))
        rows += [(f"{name}\nraw", x, sr), (f"{name}\nannouncer", y, sr)]
        met[name] = dict(raw=stats(x, sr, lines), announcer=stats(y, sr, lines))
    J.reel(items, os.path.join(OUT, "reel_announcer"), sr=SR)
    sheet(rows, os.path.join(OUT, "sheets", "announcer_spectrograms.png"),
          "ANNOUNCER register: raw read vs prosody announcer, beside real recordings (Apollo 15, 1912)")
    return met


_SENT = ["GARY, INDIANA.", "TWENTY THIRTY-SIX.", "THE FURNACE IS RELIT.", "THE SHIFT IS SHORT.", "THE CITY IS BUILT."]


def _announcer_syls(ps=None):
    """Syllables of the announcer text with a phrase id per sentence and the word each belongs to."""
    from engine.score import prosody as SP
    out, t, k = [], 0.0, 0
    for k, sent in enumerate(_SENT):
        for s in SP.line(sent):
            out.append(dict(text=s.text, t=t, dur=0.2, stress=int(s.stress), word=f"{k}:{s.word}", phrase=k))
            t += 0.2
    return out


def reel_intimate():
    text = "Town by town. Hall by hall. Nobody sent us."
    from engine.score import prosody as SP
    sents = ["TOWN BY TOWN.", "HALL BY HALL.", "NOBODY SENT US."]
    syls, t = [], 0.0
    for k, s_ in enumerate(sents):
        for s in SP.line(s_):
            syls.append(dict(text=s.text, t=t, dur=0.25, stress=int(s.stress), word=f"{k}:{s.word}", phrase=k))
            t += 0.25
    items, rows, met = [], [], {}
    w, wsr = ref("librivox")
    items.append(("REAL ref: LibriVox reader, close mic (public domain), 9 s", w, wsr))
    rows.append(("REAL librivox", w, wsr))
    met["ref_librivox"] = stats(w, wsr)
    for m, v in (("kokoro1", "af_heart"), ("kokoro1", "am_puck"), ("pocket", "cosette"), ("piper", 108)):
        x, sr = take(m, text, v)
        y, meta = P.perform(x, sr, syls, "intimate", natural=True, pace=0.9)
        name = f"{m}:{v}"
        items.append((f"{name} RAW read", x, sr))
        items.append((f"{name} + PROSODY intimate (close mic, breath)", y, sr))
        rows += [(f"{name}\nraw", x, sr), (f"{name}\nintimate", y, sr)]
        met[name] = dict(raw=stats(x, sr, text), intimate=stats(y, sr, text))
    J.reel(items, os.path.join(OUT, "reel_intimate"), sr=SR)
    sheet(rows, os.path.join(OUT, "sheets", "intimate_spectrograms.png"),
          "INTIMATE register: raw read vs prosody intimate, beside a real close-mic reader")
    return met


def _mfcc_vec(x, sr, lo=300, hi=4000, n=24):
    """Rough timbre vector: mean and std of log mel bands 300-4000 Hz over active frames."""
    from scipy.signal import stft
    f, t, Z = stft(x, sr, nperseg=int(0.032 * sr))
    Pw = np.abs(Z) ** 2
    m = (f >= lo) & (f <= hi)
    edges = np.geomspace(lo, hi, n + 1)
    bands = np.stack([Pw[(f >= a) & (f < b)].sum(0) for a, b in zip(edges[:-1], edges[1:])])
    L = np.log(bands + 1e-12)
    act = L.mean(0) > np.percentile(L.mean(0), 40)
    L = L[:, act]
    L = L - L.mean(0, keepdims=True)                   # remove level; keep spectral shape
    return np.r_[L.mean(1), L.std(1)]


def _cos(a, b):
    a = a - a.mean()
    b = b - b.mean()
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))


def reel_crowd():
    from engine import samples as S
    items, rows, met = [], [], {}
    rr = A_load("crowd_men_rallying")[: 6 * SR]
    items.append(("REAL ref: men rallying (freesound CC0), 6 s", rr, SR))
    rows.append(("REAL men rallying", rr, SR))
    times = [0.0, 0.5, 1.0, 1.5, 2.5, 3.0]
    vecs = {}
    # c3-style troupe hits (the dress every song got), for the same-sound check
    T = S.Troupe("horde", seed=3)
    y_t = np.zeros((int(4 * SR), 2))
    for t in times:
        h, on = T.hit("hah", passes=3, seed=int(t * 10))
        i0 = int(t * SR) - int(on * SR)
        lo = max(i0, 0)
        seg = h[lo - i0: lo - i0 + len(y_t) - lo]
        y_t[lo: lo + len(seg)] += seg
    items.append(("c3 TROUPE (the shared dress on 18 songs): six HAH hits", y_t.mean(axis=1), SR))
    rows.append(("c3 troupe", y_t.mean(axis=1), SR))
    met["c3_troupe"] = stats(y_t.mean(axis=1), SR)
    vecs["troupe"] = _mfcc_vec(y_t.mean(axis=1), SR)
    casts = {}
    for seed in (1, 2, 3, 4):
        cst = G.cast(seed, 6)
        casts[seed] = cst
        b = G.real_answer(times, cst, seed=seed, length=4.0).mean(axis=1)
        items.append((f"REAL-CAST crowd for piece #{seed}: {', '.join(k for k, _ in cst)}", b, SR))
        rows.append((f"cast #{seed}", b, SR))
        met[f"cast_{seed}"] = stats(b, SR)
        vecs[f"cast{seed}"] = _mfcc_vec(b, SR)
    # a synth gang from TTS voices, wordless-ish (HAH)
    sy = [dict(text="HAH", t=0.0, dur=0.5, stress=3, word="hah")]
    st, _ = G.synth_gang("hah", sy, [("kokoro1", "am_fenrir"), ("kokoro1", "am_michael"), ("piper", 6), ("piper", 42),
                                     ("pocket", "alba"), ("pocket", "javert")], seed=2)
    items.append(("SYNTH gang (six TTS voices through the crowd register): one HAH", st.mean(axis=1), SR))
    rows.append(("synth gang", st.mean(axis=1), SR))
    met["synth_gang"] = stats(st.mean(axis=1), SR)
    vecs["synth"] = _mfcc_vec(st.mean(axis=1), SR)
    vecs["rallying"] = _mfcc_vec(rr, SR)
    ks = list(vecs)
    met["similarity_300_4000"] = {a: {b: round(_cos(vecs[a], vecs[b]), 2) for b in ks} for a in ks}
    met["cast_overlap"] = {f"{a}-{b}": round(G.cast_overlap(casts[a], casts[b]), 2) for a in casts for b in casts if a < b}
    J.reel(items, os.path.join(OUT, "reel_crowd"), sr=SR)
    sheet(rows, os.path.join(OUT, "sheets", "crowd_spectrograms.png"), "CROWD: c3 troupe, four different real casts, a synth gang, a real rally")
    return met


# ------------------------------------------------------------------ READY in the song
def ready():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.signal import stft
    lines, bpm = ready_lines()
    S16 = 60 / bpm / 4
    bed_path = os.environ.get("READY_BED", "/tmp/ready_bed/.ready.wav")
    bed, bsr = sf.read(bed_path)
    assert bsr == SR
    voice_lane = np.zeros(len(bed))
    meas_all, met = [], {}
    voice_name = ("kokoro1", "am_fenrir")
    for a, b, ov in GROUPS:
        text = group_text(lines, a, b, ov)
        syls = P.syls_from_lines(lines[a:b], bpm)
        x, sr = take(*voice_name[:1], text, voice_name[1])
        y, meta = P.perform(x, sr, syls, "call", seed=a)
        mm = ME.grid_check(y, sr, syls, meta["lead"])
        t0 = float(lines[a].syls[0].t) * S16
        y44 = M.to_sr(y, sr, SR)
        MX.place(voice_lane, y44, SR, t0, meta["pcenter"], gain=1.0)
        for s, m_ in zip(syls, mm):
            if m_ is None:
                continue
            meas_all.append(dict(text=s["text"], level=s["stress"], grid=t0 + s["t"], onset=t0 + m_["onset"] - meta["lead"],
                                 end=t0 + m_["end"] - meta["lead"], f0_peak_t=t0 + m_["f0_peak_t"] - meta["lead"],
                                 f0_peak_hz=m_["f0_peak_hz"], group=text))
    voice_lane = M.to_sr(voice_lane, SR, SR)
    wins = []
    for a_, b_, ov in GROUPS:
        wins.append((float(lines[a_].syls[0].t) * S16 - 0.35,
                     float(lines[b_ - 1].syls[-1].t + lines[b_ - 1].syls[-1].dur) * S16 + 0.3))
    mixes = {"noslot": MX.mix_voice(bed, voice_lane, SR, wins, depth_db=0, duck_db=0, over_db=0),
             "slot": MX.mix_voice(bed, voice_lane, SR, wins, depth_db=16, duck_db=10, over_db=9)}
    # loudness: both mixes to the song's master (-9 LUFS) with a soft limiter; the same gain law for both
    import pyloudnorm as pln
    meter = pln.Meter(SR)
    for k in mixes:
        l = meter.integrated_loudness(mixes[k])
        mixes[k] = mixes[k] * 10 ** ((-9.0 - l) / 20)
        mixes[k] = np.tanh(mixes[k] * 0.9) / np.tanh(0.9)
    # ASR of each voiced group in the mix (an aid: c1 measured this at 25 % for the performed approach)
    asr = {}
    for label, m_ in mixes.items():
        vals = []
        for a, b, ov in GROUPS:
            text = group_text(lines, a, b, ov)
            ta = float(lines[a].syls[0].t) * S16 - 0.35
            tb = float(lines[b - 1].syls[-1].t + lines[b - 1].syls[-1].dur) * S16 + 0.3
            seg = m_[int(max(0, ta) * SR): int(tb * SR)].mean(axis=1)
            vals.append(ME.asr_score(seg, SR, text))
        asr[label] = round(float(np.mean(vals)), 2)
    lane_only = [ME.asr_score(voice_lane[int(max(0, float(lines[a].syls[0].t) * S16 - 0.35) * SR):
                                          int((float(lines[b - 1].syls[-1].t + lines[b - 1].syls[-1].dur) * S16 + 0.3) * SR)],
                              SR, group_text(lines, a, b, ov)) for a, b, ov in GROUPS]
    asr["voice_alone"] = round(float(np.mean(lane_only)), 2)
    # band share and voice-to-bed in the voice band during voiced windows
    def band_ratio(m_):
        mono = m_.mean(axis=1)
        f, t, Z = stft(mono, SR, nperseg=2048, noverlap=1536)
        Pw = np.abs(Z) ** 2
        return t, 10 * np.log10(Pw[(f >= 300) & (f <= 3400)].sum(0) + 1e-12), 10 * np.log10(Pw[(f >= 1000) & (f <= 4000)].sum(0) + 1e-12)
    met["asr_in_mix"] = asr
    on = np.array([m["onset"] for m in meas_all])
    grid = np.array([m["grid"] for m in meas_all])
    lv = np.array([m["level"] for m in meas_all])
    pk_in = [(m["onset"] - 0.01 <= m["f0_peak_t"] <= m["end"] + 0.01) for m in meas_all if m["level"] >= 2 and not np.isnan(m["f0_peak_t"])]
    d_s = [m["end"] - m["onset"] for m in meas_all if m["level"] >= 2]
    d_w = [m["end"] - m["onset"] for m in meas_all if m["level"] < 2]
    met["scansion"] = dict(n=len(on), onset_err_ms_median=round(float(np.median(np.abs(on - grid)) * 1000), 1),
                           onset_err_ms_p90=round(float(np.percentile(np.abs(on - grid), 90) * 1000), 1),
                           within_30ms=round(float(np.mean(np.abs(on - grid) <= 0.03)), 2),
                           f0_peak_in_stressed=round(float(np.mean(pk_in)), 2),
                           dur_ratio_stressed_to_weak=round(float(np.mean(d_s) / np.mean(d_w)), 2))
    # write the mixes (m4a only)
    for k, m_ in mixes.items():
        sf.write(os.path.join(CACHE, f"ready_{k}.wav"), np.clip(m_, -1, 1).astype(np.float32), SR, subtype="PCM_16")
        J._ff(["-i", os.path.join(CACHE, f"ready_{k}.wav"), "-c:a", "aac", "-b:a", "160k", os.path.join(OUT, f"ready_call_{k}.m4a")])
        J._ff(["-i", os.path.join(CACHE, f"ready_{k}.wav"), "-af", J.PHONE_AF, "-ac", "1", "-c:a", "aac", "-b:a", "64k",
               os.path.join(OUT, f"ready_call_{k}_phone.m4a")])
        met[f"lufs_{k}"] = round(float(meter.integrated_loudness(m_)), 1)
    # three-lane sheet
    dur = len(bed) / SR
    fig, axes = plt.subplots(4, 1, figsize=(26, 10), sharex=True, gridspec_kw=dict(height_ratios=[1.0, 1.2, 1.9, 1.2]))
    for ax in axes:
        for bb in np.arange(0, dur, 4 * 60 / bpm):
            ax.axvline(bb, color="#999", lw=0.8)
        for bb in np.arange(0, dur, 60 / bpm):
            ax.axvline(bb, color="#ddd", lw=0.5, zorder=0)
        ax.set_yticks([])
    ax = axes[0]
    for ln in lines:
        for s in ln.syls:
            ax.text(float(s.t) * S16, 0.5, s.text, fontsize=6 + 3.2 * s.stress, va="center",
                    color={3: "#b00020", 2: "#e36c0a", 1: "#777", 0: "#aaa"}[s.stress],
                    fontweight="bold" if s.stress == 3 else "normal")
    ax.set_ylabel("lane 1-2\nthe score:\nsyllable and\nstress (c5)", rotation=0, ha="right", va="center")
    ax.set_ylim(0, 1)
    ax = axes[1]                                       # measured voice lane: per-syllable bars from the rendered take
    for m in meas_all:
        col = {3: "#b00020", 2: "#e36c0a", 1: "#777", 0: "#aaa"}[m["level"]]
        ax.barh(0.25 + 0.16 * m["level"], m["end"] - m["onset"], left=m["onset"], height=0.12, color=col, alpha=0.85)
        ax.plot([m["grid"]] * 2, [0.05, 0.95], color="#1f6feb", lw=0.7, alpha=0.6)
        if not np.isnan(m["f0_peak_t"]):
            ax.plot(m["f0_peak_t"], 0.25 + 0.16 * m["level"], "k|", ms=8)
    ax.set_ylim(0, 1)
    ax.set_ylabel("lane 3\nMEASURED from the\nrendered take: bars =\nvowel onset..end,\ntick = f0 peak,\nblue = grid", rotation=0, ha="right", va="center", fontsize=8)
    ax = axes[2]
    for label, col in (("noslot", "#c33"), ("slot", "#1f6feb")):
        t_, e_, e2_ = band_ratio(mixes[label])
        ax.plot(t_, e_ - np.percentile(e_, 99.5), color=col, lw=0.8, label=f"mix {label}: 300-3400 Hz level")
        ax.plot(t_, e2_ - np.percentile(e2_, 99.5) - 40, color=col, lw=0.6, ls="--", label=f"mix {label}: 1-4 kHz level (offset)")
    f0d = np.where(voice_lane != 0, 1, 0)
    ax.legend(loc="lower right", fontsize=7, ncol=2)
    ax.set_ylabel("the mix (-9 LUFS)\nvoice band level", rotation=0, ha="right", va="center")
    ax = axes[3]
    vl_env = np.abs(voice_lane)
    ax.plot(np.arange(len(vl_env))[::441] / SR, vl_env[::441] / (vl_env.max() + 1e-9), color="#1a7f37", lw=0.6)
    ax.set_ylabel("voice lane\nlevel", rotation=0, ha="right", va="center")
    ax.set_xlim(0, dur)
    ax.set_xlabel("seconds (100 BPM; dark lines = bars)")
    fig.suptitle("READY (after VOICE c2): the c5 call voiced by Kokoro v1.0 am_fenrir through the prosody layer 'call'; lane 3 is measured "
                 f"from the rendered take. onset error median {met['scansion']['onset_err_ms_median']} ms, f0 peak inside stressed vowel "
                 f"{met['scansion']['f0_peak_in_stressed']}, stressed:weak duration {met['scansion']['dur_ratio_stressed_to_weak']}", fontsize=10)
    fig.tight_layout()
    os.makedirs(os.path.join(OUT, "scansion"), exist_ok=True)
    fig.savefig(os.path.join(OUT, "scansion", "ready_three_lane_after.png"), dpi=80)
    plt.close(fig)
    json.dump(meas_all, open(os.path.join(OUT, "scansion", "ready_measured.json"), "w"), indent=1, default=float)
    return met


def main(argv):
    what = argv[1] if len(argv) > 1 else "all"
    m = _metrics()
    todo = ["refs", "call", "announcer", "intimate", "crowd", "ready"] if what == "all" else [what]
    for w in todo:
        if w == "refs":
            refs()
            continue
        fn = {"call": reel_call, "announcer": reel_announcer, "intimate": reel_intimate, "crowd": reel_crowd,
              "ready": ready}[w]
        m = _metrics()
        m[w] = fn()
        _save_metrics(m)
        print(w, "done")


if __name__ == "__main__":
    main(sys.argv)
