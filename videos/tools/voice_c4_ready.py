#!/usr/bin/env python3
"""VOICE c4 READY review build: the natural-read call, real-voice answers and a real-source held layer in READY c10's bed, beside the published READY.

    python3 tools/voice_c4_ready.py mix         # the voiced builds (m4a + phone copies) to listen to
    python3 tools/voice_c4_ready.py held        # the held bar before (c9's synthesized choir) and after (real voices), as listening copies
    python3 tools/voice_c4_ready.py lab         # the found-voice bridge on a neutral PD recording (1946 newsreel narrator) in a lab bed, with its provenance json
    python3 tools/voice_c4_ready.py sheet       # the spectrogram sheet

Needs the beds from tools/voice_c4_bed.py (pub, c9, c10) in review/studio_voice_c4/after/bed*/. The m4a files are for the client or an operator to
listen to on a phone; nothing here scores them (8 Oct: the word-score and band-number metrics are removed). REVIEW BUILD ONLY: no piece's scene or
published song is edited.
"""
import hashlib
import json
import os
import pickle
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path[:0] = [VIDEOS, os.path.join(VIDEOS, "scripts"), os.path.join(VIDEOS, "tools"), os.path.join(VIDEOS, "web", "audio")]

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy.signal import butter, sosfilt  # noqa: E402

import voice_c2_demo as D  # noqa: E402
from engine.voice import models as M, prosody as P, mix as MX, judge as J, natural as N, found as F, sustain as SU  # noqa: E402

OUT = os.path.join(VIDEOS, "review", "studio_voice_c4", "after")
SR = 44100
BPM = 100
S16 = 60 / BPM / 4
SPB = 60 / BPM
BEDS = dict(pub=os.path.join(OUT, "bed_pub", ".ready.wav"), c9=os.path.join(OUT, "bed", ".ready_c9.wav"),
            c10=os.path.join(OUT, "bed_c10", ".ready_c9.wav"), c10choir=os.path.join(OUT, "bed_c10choir", ".ready_c9.wav"), c10t=os.path.join(OUT, "bed_c10t", ".ready_c9.wav"))
CLIPS = os.path.join(OUT, "lab", "clips")
CACHE = "/tmp/c4cache"
os.makedirs(CACHE, exist_ok=True)
PAY = 50 * SPB                  # REA, the payoff (30.0 s)
NA = None                       # the 'NA' of NAtion, from the score


def bed(k):
    x, sr = sf.read(BEDS[k])
    assert sr == SR, sr
    return x


def lines_():
    from engine.score import abc, scansion
    sc = abc.parse(open(os.path.join(VIDEOS, "web", "audio", "scores", "ready_c9.abc")).read(), "ready")
    return scansion.lines_from_score(sc)


def take(model, text, voice):
    k = hashlib.sha1(f"{model}|{voice}|{text}".encode()).hexdigest()[:16]
    f = os.path.join(CACHE, k + ".pkl")
    if os.path.exists(f):
        return pickle.load(open(f, "rb"))
    x, sr = M.synth(model, text, voice)
    pickle.dump((x, sr), open(f, "wb"))
    return x, sr


# ------------------------------------------------------------------ levels (for placing a layer, not for judging it)
def band_rms(x, lo=300, hi=3400, sr=SR):
    m = x.mean(1) if x.ndim == 2 else x
    sos = butter(4, [lo / (sr / 2), hi / (sr / 2)], "band", output="sos")
    return float(np.sqrt(np.mean(sosfilt(sos, m) ** 2) + 1e-14))


def to_lufs(mx, target=-9.0):
    import pyloudnorm as pln
    l = pln.Meter(SR).integrated_loudness(mx)
    return np.tanh((mx * 10 ** ((target - l) / 20)) * 0.9) / np.tanh(0.9)


def write(name, mx, phone=True):
    wav = f"/tmp/c4cache/{name}.wav"
    sf.write(wav, np.clip(mx, -1, 1).astype(np.float32), SR, subtype="PCM_16")
    J._ff(["-i", wav, "-c:a", "aac", "-b:a", "160k", os.path.join(OUT, name + ".m4a")])
    if phone:
        J._ff(["-i", wav, "-af", J.PHONE_AF, "-ac", "1", "-c:a", "aac", "-b:a", "64k", os.path.join(OUT, name + "_phone.m4a")])
    os.remove(wav)


# ------------------------------------------------------------------ the call (natural read) and the found answers
GROUPS = [(1, 4), (5, 7), (7, 9), (9, 11)]
OV = {(9, 11): "people can't afford to live"}


def call_lane(n, voice, lines, tone=2.0, effort=0.6):
    lane = np.zeros(n)
    wins, per = [], []
    for a, b in GROUPS:
        text = D.group_text(lines, a, b, OV.get((a, b)))
        syls = P.syls_from_lines(lines[a:b], BPM)
        x, sr = take("kokoro1", text, voice)
        y, meta = N.anchored_checked(x, sr, syls, text, tol=0.1, seed=a, tone=tone, effort=effort)
        t0 = float(lines[a].syls[0].t) * S16
        ta = t0 + meta["anchors"][0][2]
        MX.place(lane, M.to_sr(y, sr, SR), SR, ta, meta["pcenter"])
        end = t0 + max(s["t"] + s["dur"] for s in syls)
        wins.append((ta - 0.45, max(end, ta + meta["dur"] - meta["pcenter"] - 0.1) + 0.2))
        from engine.voice import refs as RF
        pr, pr_raw = RF.stats(y, sr), RF.stats(x, sr)
        per.append(dict(text=text, pitch_sd_syl_st=None if not pr else round(pr["sd_syl"], 2), pitch_sd_syl_raw=None if not pr_raw else round(pr_raw["sd_syl"], 2),
                        guard=meta["guard"], anchors=[(t, w, g) for _, t, w, g in meta["anchors"]], dropped=meta["dropped"],
                        pauses=meta["pauses"], rates=meta["rate"], transfer=meta["transfer"]))
    return lane, wins, per


def na_beat():
    from songs2 import answers_c5 as A
    from songs2 import ready_c10 as C10
    W = A.read(C10.C9.SCORE)
    cues = C10.answer_cues(W)
    return [b for k, b in cues if k == "hey"][0]


def place_found(mx, ref_win, n, nation_db=4.0, pad_db=3.0, phrase_db=2.0, pad_shift=None, pad_on=True, phrase_on=True, nation_on=True):
    """Add the real-voice answer ('nation') at the NA-tion cue and the held layer (sustained crowd + 'liberty and justice for all') to a bed. -> mx, notes"""
    notes = []
    bedx = mx.copy()
    ref = band_rms(bedx[int(ref_win[0] * SR): int(ref_win[1] * SR)])
    # 1. NATION on the NA-tion cue, replacing the troupe's HEY-HAH
    c = F.load(os.path.join(CLIPS, "crowd1941_nation.wav"))
    y, meta = F.phrase(c, film="newsreel", gate_db=6.0)
    t = na_beat() * SPB
    lane = np.zeros(len(bedx))
    F.place(lane, y, t, meta)
    g = ref * 10 ** (nation_db / 20) / (band_rms(y[y != 0]) + 1e-12)
    lane = lane * g * (1.0 if nation_on else 0.0)
    bedx, _ = F.slot(bedx, lane, meta, depth_db=3.0 if nation_on else 0.0)
    bedx = bedx + np.stack([lane, lane], 1)
    if nation_on:
        F.record(meta, t, "READY c10 answer at NA-tion (replaces the troupe's HEY-HAH)")
    notes.append(dict(what="nation", on=nation_on, t=round(t, 3), gain_vs_ref_db=nation_db, meta=_slim(meta)))
    # 2. the held layer: a sustained crowd from the same mass (real voices, dissolved into a vowel chorus) + the phrase on top
    c2 = F.load(os.path.join(CLIPS, "crowd1941_one_nation_to_all.wav"))
    pad, pm = SU.crowd_pad(c2, (2.9, 6.3), dur=3.6, root_hz=146.83, shift=pad_shift, swell=0.55)
    ph = np.zeros(len(bedx))
    t_pad = PAY + 0.25
    i0 = int(t_pad * SR)
    seg = pad[: len(bedx) - i0]
    gp = ref * 10 ** (pad_db / 20) / (band_rms(pad) + 1e-12)
    if pad_on:
        bedx[i0: i0 + len(seg)] += seg * gp
    if pad_on:
        F.record(dict(pm, window=pm["window"]), t_pad, "READY c10 held arrival: sustained crowd (paulstretch of real voices), replaces the synthesized choir")
    c3 = F.load(os.path.join(CLIPS, "crowd1941_liberty_justice_all.wav"))
    y3, m3 = F.phrase(c3, film="newsreel", gate_db=6.0)
    lane3 = np.zeros(len(bedx))
    t3 = PAY + 0.6
    F.place(lane3, y3, t3, m3)
    lane3 = lane3 * (ref * 10 ** (phrase_db / 20) / (band_rms(y3[y3 != 0]) + 1e-12)) * (1.0 if phrase_on else 0.0)
    bedx, _ = F.slot(bedx, lane3, m3, depth_db=3.0)
    bedx = bedx + np.stack([lane3, lane3], 1)
    if phrase_on:
        F.record(m3, t3, "READY c10 held arrival: the crowd's phrase on the sustained layer")
    notes += [dict(what="held pad", on=pad_on, t=round(t_pad, 3), gain_vs_ref_db=pad_db, meta=pm), dict(what="liberty and justice for all", on=phrase_on, t=round(t3, 3), gain_vs_ref_db=phrase_db, meta=_slim(m3))]
    return bedx, notes


def _slim(m):
    return {k: v for k, v in m.items() if k not in ("source_path",)}


BUILDS = {   # name -> (bed, place_found kwargs): what is laid under/over the call
    "": ("c10t", dict(phrase_on=False, nation_on=False)),             # main: the troupe answers as before; the held bar carries the real-source crowd layer
    "_worded": ("c10", dict(phrase_on=False)),                       # the same with a real crowd saying NATION at NA-tion (for the client's ear)
}


def cmd_mix():
    lines = lines_()
    res = {}
    n = len(bed("c10t"))
    for voice in ("af_heart", "am_fenrir"):
        lane, wins, per = call_lane(n, voice, lines)
        res[f"{voice}:calls"] = per
        for suffix, (bk, kw) in BUILDS.items():
            base = bed(bk)
            for tag, mk in (("slot", dict(depth_db=10, duck_db=6, over_db=9)), ("deep", dict(depth_db=16, duck_db=10, over_db=9))):
                from engine.audio import voice_stats_reset
                voice_stats_reset()
                mx = MX.mix_voice(base, lane, SR, wins, **mk)
                mx, notes = place_found(mx, (20, 30), n, **kw)
                mx = to_lufs(mx)
                from engine import audio as A
                key = f"{voice}{suffix}:{tag}"
                res[key] = dict(voices_found=A.voice_report()["found"], guards=[p["guard"] for p in per])
                print(key, "built", flush=True)
                write(f"ready_c10{suffix}_{voice}" if tag == "deep" else f"ready_c10{suffix}_{voice}_lightslot", mx)
            if not suffix:
                mx0 = to_lufs(MX.mix_voice(base, lane, SR, wins, depth_db=16, duck_db=10, over_db=9))
                write(f"ready_c10_{voice}_callonly", mx0)
        res["found"] = notes
    # the references: the published bed alone, the c4 bed alone
    write("ready_published_bed", to_lufs(bed("pub")))
    write("ready_c10_bed_only", to_lufs(bed("c10t")))


# ------------------------------------------------------------------ the held bar, before and after
def cmd_held():
    """The held arrival (and the 20-36 s run that carries it), BEFORE c9's synthesized choir (crowd kit 'ah', a stand-in) against AFTER variants built from real voices,
    written as listening copies (26-36 s, with phone copies). No call, so the layer is heard alone. V1 adds the real-crowd NATION answer, V3 also the crowd's phrase."""
    n = len(bed("c10"))
    vars_ = {"before_synth_choir": (bed("c10choir"), None),
             "after_real_pad": (bed("c10"), dict(phrase_on=False, nation_on=False)),
             "after_pad_down5": (bed("c10"), dict(phrase_on=False, nation_on=False, pad_shift=-5.0)),
             "after_pad_plus_nation": (bed("c10"), dict(phrase_on=False)),
             "after_pad_nation_phrase": (bed("c10"), dict()),
             "nothing_added": (bed("c10"), dict(phrase_on=False, nation_on=False, pad_on=False))}
    for k, (b, kw) in vars_.items():
        mx = b if kw is None else place_found(b, (20, 30), n, **kw)[0]
        mx = to_lufs(mx)
        write(f"held_{k}", mx[int(26 * SR): int(36 * SR)], phone=True)
        print(k, "written", flush=True)


# ------------------------------------------------------------------ the found-voice bridge in a lab
def cmd_lab():
    """A neutral public-domain recording (the 1946 newsreel narrator: 'the wheels of the country's railroads grind slowly to a halt ...') placed in a lab bed
    (READY's c10 bed at 12-26 s, not in a piece). Shows: band-limit to the film, gate between words, anchor on the first stressed syllable at a bar line,
    the slot (300-3400, 3.5 dB), the provenance json and the hits.json 'voices' block."""
    from engine import audio as A
    clip = F.load(os.path.join(CLIPS, "newsreel1946_rail_narrator.wav"))
    A.voice_stats_reset()
    y, meta = F.phrase(clip, film="newsreel", gate_db=9.0, lufs=-20.0)
    st = stresses = F.stresses(y, SR, 4)
    base = bed("c10")
    t0 = 12 * 2.4                  # a bar line (bar 3 of the drop) at 28.8 s is the last; use 12.0 s = b20 (the ALL AT ONCE strobe) is too busy: take bar 12.0 s
    t0 = 7.2                       # b12 = 7.2 s, in drop 1
    seg0, seg1 = 6.0, 20.0
    lane = np.zeros(len(base))
    F.place(lane, y, t0, meta)
    lane = lane * (band_rms(base[int(seg0 * SR): int(seg1 * SR)]) * 10 ** (7.0 / 20) / (band_rms(y[y != 0]) + 1e-12))
    mixed, k = F.slot(base, lane, meta)
    mixed = mixed + np.stack([lane, lane], 1)
    F.record(meta, t0, "lab: neutral PD test recording over READY c10's drop 1 (not a piece)")
    rep = A.voice_report()
    ct = F.contour(y, SR)
    lab = dict(anchor_s=t0, pcenter=meta["pcenter"], contour_median_hz=round(ct["median_hz"], 1),
               voices_block={k_: rep[k_] for k_ in ("found", "found_items", "synth_audible", "on")}, rights_warning=F.check_rights(meta))
    out = to_lufs(mixed[int(seg0 * SR): int(seg1 * SR)])
    write("lab_found_bridge", out)
    print(lab)
    json.dump(dict(hits_voices=rep, phrase=_slim(meta), contour_note="semitones against the speaker's median: engine.voice.found.contour"),
              open(os.path.join(OUT, "lab", "found_bridge_hits_voices.json"), "w"), indent=1, default=float)


def cmd_sheet():
    """Phone-copy spectrograms (0-4 kHz) to look at beside the listening copies: the published bed, c3's voiced call in c9's bed (30 Sep, 14.8 s), c4's voiced build."""
    import subprocess
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()

    def dec(path):
        return np.frombuffer(subprocess.run([ff, "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True).stdout, np.float32)
    items = [("published READY bed (songs2/ready.py), phone copy, no voice", os.path.join(OUT, "ready_published_bed_phone.m4a"), 29.0),
             ("c3: call on the score's grid in c9's bed (30 Sep), phone copy, af_heart", os.path.join(VIDEOS, "review", "studio_voice_c3", "after", "ready_call_af_heart_c3_slot_phone.m4a"), 15.0),
             ("c4: natural read + re-built riff + real-voice answer and held layer, phone copy, af_heart", os.path.join(OUT, "ready_c10_af_heart_phone.m4a"), 36.0)]
    fig, ax = plt.subplots(len(items), 1, figsize=(15, 3.1 * len(items)))
    for a, (title, f, dur) in zip(ax, items):
        if not os.path.exists(f):
            a.set_title(title + " (missing)")
            continue
        x = dec(f)[: int(dur * 16000)]
        a.specgram(x, NFFT=1024, Fs=16000, noverlap=768, cmap="magma", vmin=-110, vmax=-30)
        a.set_ylim(0, 4000)
        a.set_title(title, fontsize=10)
        a.set_ylabel("Hz")
        for t, lab in ((1.2, "call 1"), (5.6, "call 2"), (9.4, "call 3"), (13.5, "call 4")):
            if "c4" in title or "c3" in title:
                a.axvline(t, color="w", lw=0.4, alpha=0.5)
        if "c4" in title:
            a.axvline(na_beat() * SPB, color="c", lw=1.0)
            a.text(na_beat() * SPB, 3700, "NA-tion (crowd)", color="c", fontsize=8)
            a.axvline(PAY + 0.25, color="y", lw=1.0)
            a.text(PAY + 0.3, 3700, "held crowd layer", color="y", fontsize=8)
    ax[-1].set_xlabel("s")
    plt.tight_layout()
    plt.savefig(os.path.join(OUT, "sheet_ready_phone_spectrograms.jpg"), dpi=70)


if __name__ == "__main__":
    {"mix": cmd_mix, "held": cmd_held, "lab": cmd_lab, "sheet": cmd_sheet}[sys.argv[1]]()
