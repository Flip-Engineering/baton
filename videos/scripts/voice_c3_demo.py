#!/usr/bin/env python3
"""VOICE c3 demo (phone first, short reels). Outputs to review/studio_voice_c3/after/.

    python3 scripts/voice_c3_demo.py call|announcer|intimate     # one reel per register: real ref, then per voice RAW / c2 template / c3
    python3 scripts/voice_c3_demo.py answers                     # the crowd answers as hits: four worlds, beside the c2 wash
    python3 scripts/voice_c3_demo.py ready                       # the READY call in the c9 bed: slot/no slot, raw/c3, phone copies
    python3 scripts/voice_c3_demo.py figure                      # before/after spectrogram sheet
    python3 scripts/voice_c3_demo.py all

c2 is loaded from git (commit 7b56651) as /tmp/vc3/prosody_c2.py so the c2 template is the real c2 layer.
The reels are for the ears of the client or an operator; nothing here scores them (8 Oct: the word-score, HNR, step,
tail and pitch-correlation metrics are removed with tools/voice_c3_probe.py). notes.json keeps the guard and transfer facts.
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path[:0] = [VIDEOS, HERE, os.path.join(VIDEOS, "tools")]

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import voice_c2_demo as D  # noqa: E402
from engine.voice import models as M, prosody as P, gang as G, judge as J, mix as MX, refs as R  # noqa: E402

OUT = os.path.join(VIDEOS, "review", "studio_voice_c3", "after")
os.makedirs(os.path.join(OUT, "sheets"), exist_ok=True)
SR = 44100
BED = os.environ.get("READY_BED", "/tmp/ready_bed_c9/.ready_c9.wav")
MP = os.path.join(OUT, "notes.json")


def _c2():
    import importlib.util
    f = "/tmp/vc3/prosody_c2.py"
    if not os.path.exists(f):
        os.makedirs("/tmp/vc3", exist_ok=True)
        open(f, "w").write(subprocess.check_output(["git", "-C", VIDEOS, "show", "7b56651:videos/engine/voice/prosody.py"], text=True))
    sp = importlib.util.spec_from_file_location("prosody_c2", f)
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


def metrics():
    try:
        return json.load(open(MP))
    except Exception:  # noqa: BLE001
        return {}


def save(key, val):
    m = metrics()
    m[key] = val
    json.dump(m, open(MP, "w"), indent=1, default=float)


# ------------------------------------------------------------------ one register reel
def register_reel(reg, text, syls, voices, refname, kw, stem, refs_extra=(), c3_extra=()):
    c2 = _c2()
    items, rows, met = [], [], {}
    w, wsr = D.ref(refname)
    items.append((f"REAL ref: {refname} (measured only, never cloned), 9 s", w, wsr))
    rows.append((f"REAL {refname}", w, wsr))
    met["ref"] = dict(name=refname, **{k: round(v, 2) for k, v in R.profile(refname).items() if k != "windows"})
    for m, v in voices:
        nm = f"{m}:{v}"
        x, sr = D.take(m, text, v)
        y2, meta2 = c2.perform(x, sr, syls, reg, **kw)
        y3, meta3 = P.perform_checked(x, sr, syls, reg, text, tol=0.1, **kw)
        g = meta3["guard"]
        met[nm] = dict(guard=g, transfer=meta3["transfer"])
        items.append((f"{nm} RAW model read", x, sr))
        items.append((f"{nm} c2 template", y2, sr))
        items.append((f"{nm} c3 transfer (ref {met[nm]['transfer'].get('ref', 'off')}, step {g['chosen']})", y3, sr))
        rows += [(f"{nm}\nraw", x, sr), (f"{nm}\nc2", y2, sr), (f"{nm}\nc3", y3, sr)]
        for ex in c3_extra:                               # the same take under another reference: the piece picks its own
            y4, meta4 = P.perform(x, sr, syls, reg, analysis=None, **dict(kw, **ex))
            items.append((f"{nm} c3 with {ex}", y4, sr))
            rows.append((f"{nm}\nc3 {list(ex.values())[0]}", y4, sr))
    J.reel(items, os.path.join(OUT, stem), sr=SR)
    D.sheet(rows, os.path.join(OUT, "sheets", stem.replace("reel_", "") + "_spectrograms.png"),
            f"{reg.upper()}: raw / c2 template / c3 transfer, beside a real recording")
    return met


def reel_call():
    lines, bpm = D.ready_lines()
    text = D.group_text(lines, 1, 4)
    syls = P.syls_from_lines(lines[1:4], bpm)
    voices = [("kokoro1", "af_heart"), ("kokoro1", "am_fenrir"), ("piper", 6)]
    save("call", register_reel("call", text, syls, voices, "wilson_1912", {}, "reel_call", c3_extra=[dict(ref="apollo15")]))


def reel_announcer():
    text = "Gary, Indiana. Twenty thirty-six. The furnace is relit. The shift is short. The city is built."
    syls = D._announcer_syls()
    voices = [("kokoro1", "af_heart"), ("kokoro1", "am_fenrir"), ("kokoro1", "bm_fable")]
    save("announcer", register_reel("announcer", text, syls, voices, "apollo15", dict(natural=True), "reel_announcer",
                                    c3_extra=[dict(ref="librivox")]))


def reel_intimate():
    from engine.score import prosody as SP
    text = "Town by town. Hall by hall. Nobody sent us."
    syls, t = [], 0.0
    for k, s_ in enumerate(["TOWN BY TOWN.", "HALL BY HALL.", "NOBODY SENT US."]):
        for s in SP.line(s_):
            syls.append(dict(text=s.text, t=t, dur=0.25, stress=int(s.stress), word=f"{k}:{s.word}", phrase=k))
            t += 0.25
    voices = [("kokoro1", "af_heart"), ("kokoro1", "am_puck"), ("piper", 108)]
    save("intimate", register_reel("intimate", text, syls, voices, "librivox", dict(natural=True, pace=0.9), "reel_intimate"))


# ------------------------------------------------------------------ crowd answers as hits
def reel_answers():
    BEAT = 0.6
    lines, bpm = D.ready_lines()
    c2 = None
    T = [1.9 + i * BEAT for i in range(4)]
    LV = [3, 2, 3, 2]
    x, sr = D.take("kokoro1", "no one trusts the institutions", "am_fenrir")
    syls = P.syls_from_lines(lines[5:7], 100)
    call, meta = P.perform(x, sr, syls, "call", seed=1)
    call = M.to_sr(call, sr, SR)
    L = int((T[-1] + BEAT + 1.0) * SR)

    def with_call(ans):
        b = np.zeros(L)
        i0 = int(0.25 * SR)
        b[i0:i0 + len(call)] += call[:L - i0] * 0.45
        n = min(L, len(ans))
        b[:n] += ans[:n].mean(axis=1) if ans.ndim == 2 else ans[:n]
        return b

    items, met = [], {}
    c2_ans = G.real_answer(T, G.cast(1), seed=1, length=L / SR)
    c2_ans = c2_ans / (np.abs(c2_ans).max() + 1e-9) * 0.8
    items.append(("c2 ANSWER: real cast of one seed, washes (the critic's measure: attack 55-125 ms, held most of the beat)", with_call(c2_ans), SR))
    met["c2_wash"] = G.answer_shape(c2_ans, T, BEAT)
    lay = {}
    for world, label in (("yard", "READY: shift change in a yard, men and women, near, a slap off the wall"),
                         ("plain", "HORDE: an open plain, many, far, low, no room"),
                         ("hall", "COMMON WEALTH: a union hall, room tone, a held vowel"),
                         ("heave", "GIANT: the heave, short and effortful, a breath before")):
        cst = G.hit_cast(world, seed=3)
        a = G.hit_answer(T, cst, world, levels=LV, beat=BEAT, seed=5, length=L / SR)
        a = a / (np.abs(a).max() + 1e-9) * 0.8
        lay[world] = a
        sh = G.answer_shape(a, T, BEAT)
        met[world] = dict(performers=[k for k, _ in cst], n=len(cst), hits=sh,
                          attack_ms_median=float(np.median([h["attack_ms"] for h in sh])),
                          within10_ms_median=float(np.median([h["within10dB_ms"] for h in sh])))
        items.append((f"c3 ANSWER {label}", with_call(a), SR))
    # difference on the answer layers themselves (c2's band-timbre vector, z-scored over the set)
    names = ["c2_wash"] + list(lay)
    vecs = [D._mfcc_vec(c2_ans.mean(axis=1), SR)] + [D._mfcc_vec(lay[k].mean(axis=1), SR) for k in lay]
    V = np.array(vecs)
    Z = (V - V.mean(0)) / (V.std(0) + 1e-9)
    C = np.array([[float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)) for b in Z] for a in Z])
    met["timbre_cosine_z"] = dict(names=names, matrix=np.round(C, 2).tolist())
    J.reel(items, os.path.join(OUT, "reel_answers"), sr=SR, gap=0.8)
    # the envelope picture
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axs = plt.subplots(len(items), 1, figsize=(12, 1.25 * len(items) + 0.5), sharex=True)
    for ax, (lab, b, _) in zip(axs, items):
        e = 20 * np.log10(np.sqrt(np.convolve(b ** 2, np.ones(441) / 441, "same")) + 1e-6)
        ax.plot(np.arange(len(e))[::220] / SR, e[::220], lw=0.8)
        ax.set_ylim(-60, 0)
        for t in T:
            ax.axvline(t, color="#c33", lw=0.6)
        ax.set_ylabel(lab.split(":")[0][:12], rotation=0, ha="right", fontsize=7)
        ax.tick_params(labelsize=6)
    fig.suptitle("crowd answers on four beats (red lines; envelope dB): c2 wash then c3 hits by world", fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "sheets", "answers_envelopes.png"), dpi=70)
    plt.close(fig)
    save("answers", met)


# ------------------------------------------------------------------ the READY call in the c9 bed
def reel_ready():
    import pyloudnorm as pln
    lines, bpm = D.ready_lines()
    S16 = 60 / bpm / 4
    bed, bsr = sf.read(BED)
    assert bsr == SR, bsr
    c9 = __import__("engine.score", fromlist=["abc"])
    from engine.score import abc, scansion
    sc = abc.parse(open(os.path.join(VIDEOS, "web", "audio", "scores", "ready_c9.abc")).read(), "ready")
    lines = scansion.lines_from_score(sc)
    groups = [(1, 4), (5, 7), (7, 9), (9, 11)]
    OV = {(9, 11): "people can't afford to live"}        # the c2 text helper drops the second 'to' of the score's syllables
    gt = lambda a, b: D.group_text(lines, a, b, OV.get((a, b)))  # noqa: E731
    voices = [("kokoro1", "am_fenrir"), ("kokoro1", "af_heart")]
    meter = pln.Meter(SR)
    end = 14.8
    bed = bed[: int(end * SR)]
    met, items, phone_items = {}, [], []
    results = {}
    for m, v in voices:
        raw_lane = np.zeros(len(bed))
        c3_lane = np.zeros(len(bed))
        wins, per = [], []
        for a, b in groups:
            text = gt(a, b)
            syls = P.syls_from_lines(lines[a:b], bpm)
            x, sr = D.take(m, text, v)
            y, meta = P.perform_checked(x, sr, syls, "call", text, tol=0.1, seed=a)
            y44 = M.to_sr(y, sr, SR)
            t0 = float(lines[a].syls[0].t) * S16
            MX.place(c3_lane, y44, SR, t0, meta["pcenter"])
            # raw: first vowel of the read on the first syllable's time
            A_ = P.analyse(x, sr)
            seg = P.segment(A_, len(syls))
            lead = seg[0][0] - A_["pad"]
            MX.place(raw_lane, M.to_sr(x, sr, SR), SR, t0, lead)
            wins.append((t0 - 0.35, float(lines[b - 1].syls[-1].t + lines[b - 1].syls[-1].dur) * S16 + 0.3))
            per.append(dict(text=text, guard=meta["guard"]))
        for label, lane in (("raw", raw_lane), ("c3", c3_lane)):
            for slot_name, kw in (("noslot", dict(depth_db=0, duck_db=0, over_db=0)), ("slot", dict(depth_db=16, duck_db=10, over_db=9)),
                                  ("deepslot", dict(depth_db=26, duck_db=12, over_db=9))):
                if label == "raw" and slot_name == "noslot":
                    continue
                mx = MX.mix_voice(bed, lane, SR, wins, **kw)
                l = meter.integrated_loudness(mx)
                mx = np.tanh((mx * 10 ** ((-9.0 - l) / 20)) * 0.9) / np.tanh(0.9)
                key = f"{v}:{label}:{slot_name}"
                met[key] = dict(slot=kw)
                stem = f"ready_call_{v}_{label}_{slot_name}"
                wav = f"/tmp/vc3/{stem}.wav"
                sf.write(wav, np.clip(mx, -1, 1).astype(np.float32), SR, subtype="PCM_16")
                J._ff(["-i", wav, "-c:a", "aac", "-b:a", "160k", os.path.join(OUT, stem + ".m4a")])
                J._ff(["-i", wav, "-af", J.PHONE_AF, "-ac", "1", "-c:a", "aac", "-b:a", "64k", os.path.join(OUT, stem + "_phone.m4a")])
                os.remove(wav)
                print(key, met[key], flush=True)
        met[f"{v}:guard"] = per
    save("ready", met)


# ------------------------------------------------------------------ a before/after picture
def figure():
    c2 = _c2()
    lines, bpm = D.ready_lines()
    text = D.group_text(lines, 1, 4)
    syls = P.syls_from_lines(lines[1:4], bpm)
    rows = []
    for m, v in (("kokoro1", "am_fenrir"), ("kokoro1", "af_heart")):
        x, sr = D.take(m, text, v)
        y2, _ = c2.perform(x, sr, syls, "call")
        y3, _ = P.perform(x, sr, syls, "call")
        rows += [(f"{v}\nraw", x, sr), (f"{v}\nc2", y2, sr), (f"{v}\nc3", y3, sr)]
    D.sheet(rows, os.path.join(OUT, "sheets", "layer_before_after.png"),
            "READY call through the layer: raw / c2 (reverse tail block at the end, hard gaps) / c3 (soft joins, clean tail, own contour)")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    fns = dict(call=reel_call, announcer=reel_announcer, intimate=reel_intimate, answers=reel_answers, ready=reel_ready, figure=figure)
    for k in (list(fns) if what == "all" else [what]):
        fns[k]()
        print(k, "done", flush=True)
