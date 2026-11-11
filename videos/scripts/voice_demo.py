"""Voice demo reel for the client: four approaches to the words, over each piece's own song, so they can choose per piece.

    cd videos && python3 scripts/voice_demo.py [piece ...] [--measure-only | --reel-only | --no-measure | --no-reel]
      -> review/voice_demo/<piece>_{none,old,A,B,C,D}.wav   the song window with each approach (none = what is
                                                           live now, voices off; old = the formant voice)
         review/voice_demo/<piece>_{A,B,C,D}_vox.wav       the vocal alone (placed exactly as in the mix)
         review/voice_demo/voice_demo_reel.{wav,m4a}      every piece: none -> A -> B -> C -> D (spoken labels)
         review/voice_demo/voice_demo_30s.{wav,m4a}       20-30 s: the recommended approach for each piece
         review/voice_demo/metrics.json                   intelligibility / timing / loudness / clipping per clip

A  performance   neural takes performed: LEAD hype-man, GANG 4-8, CROWD 20-60 (voice_neural.lead/gang/crowd)
B  instrument    the words as an instrument: talkbox chant on the song's own notes (voice_neural.sing), RED WEDGE:
                 the montagem chop melody cut from a neural OURS
C  texture       a crowd the words emerge from (voice_neural.crowd_texture)
D  non-verbal    no words: HEY / HO / HUT vocables, breaths and roar on the words' beats (voice_neural.nonverbal)

The song is rendered with its own engine and master (songs2/<key>.py), bars cut to a window, every old vocal stem
removed; the new vocal goes in as a '_stem' (so it runs through the song's vox bus, sidechain and master) at the
same beat with its vowel onset on the grid. No scene or song file is changed and voices stay OFF in the songs.
"""
import importlib
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)
sys.path.insert(0, os.path.join(VIDEOS, "web", "audio"))

from engine import audio as A  # noqa: E402
from engine import voice_neural as V  # noqa: E402
from engine import voice_metrics as M  # noqa: E402

A.allow_voices(True)    # a voice A/B demo: the one place worded synthesis is meant to sound (engine voice guard)

SR = A.SR
OUT = os.path.join(VIDEOS, "review", "voice_demo")
FF = "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
PERSIST = ("_root", "_transpose", "_key", "_room", "_riders")
REF_LUFS = -10.0          # pre-master vocal loudness where the song has no old stem to match (the others sit -8..-12)

# every frame line the pieces voice: the forced-choice pool for the ASR line-ID test
POOL = ["all of it", "coast to coast", "every mile", "try us", "saddle up", "already here", "ours", "one more", "hit it",
        "every last bolt", "the ai too", "adult daycare", "timber", "the whole planet", "for good", "everybody",
        "always has been", "shut the fuck up", "about europe", "shut the fuck up about europe", "coming home", "to build",
        "a civilization", "the world", "shipped out", "guard duty", "one road", "our party", "we all unite", "a hall",
        "lights up", "it calls", "the next town", "common wealth", "the heartland", "goes red", "small farmers"]


# ================================================================ pieces
def _b(bpm):
    return 60.0 / bpm


def horde_lines(bpm):
    s = _b(bpm)
    # whole phrases with later words pinned to the grid, marks = (word, dt) or (word, syllable, dt) (word-by-word
    # takes stitched at 170 BPM lose the words: even a single lead fails the ASR line-ID test that way)
    return {"ALL OF IT.": [("All of it", 0.0, 0.26, ((1, 0.5 * s), (2, 1.0 * s)))],
            "COAST TO COAST.": [("Coast to coast", 0.0, 0.3, ((1, 0.5 * s), (2, 1.0 * s)))]}


def red_wedge_lines(bpm):
    s = _b(bpm)
    return {"OURS.": [("Ours", 0.0, 0.3)],
            "ONE MORE.": [("One more", 0.0, 0.4, ((1, 0.5 * s),))],
            "ALWAYS HAS BEEN.": [("Always has been", 0.0, 0.5, ((1, 1.0 * s), (2, 2.0 * s)))]}


def empire_lines(bpm):
    s = _b(bpm)
    return {"SHUT THE FUCK UP ABOUT EUROPE.": [("Shut the fuck up about Europe", 0.0, 0.3,
                                                ((2, 0.5 * s), (4, 1.0 * s), (5, 1, 1.5 * s)))]}


def commonwealth_lines(bpm):
    s = _b(bpm)
    return {"ONE ROAD.": [("One road", 0.0, 0.45, ((1, 1.0 * s),))],
            "OUR PARTY.": [("Our party", 0.0, 0.4, ((1, 0.5 * s),))]}


PIECES = {
    # key: title, window bars [b0, b1), the frame texts voiced (text in the song -> our line), styles per approach
    "horde": dict(title="HORDE", bars=(12, 16), voiced={"ALL OF IT.": "ALL OF IT.", "COAST TO COAST.": "COAST TO COAST."},
                  lines=horde_lines, notes={"ALL OF IT.": [[50, 43], [48, 41], [51, 44]],
                                            "COAST TO COAST.": [[51, 44], [49, 42], [51, 44]]},
                  A={"*": "crowd"}, colour="stadium",
                  D={"ALL OF IT.": [("ho", 0), ("ho", 0.5), ("hey", 1)], "COAST TO COAST.": [("hey", 0), ("ho", 0.5), ("hey", 1)]},
                  pick="A"),
    "red_wedge": dict(title="RED WEDGE", bars=(12, 16), voiced={"OURS.": "OURS.", "ONE MORE.": "ONE MORE.",
                                                               "ALWAYS HAS BEEN.": "ALWAYS HAS BEEN."},
                      lines=red_wedge_lines, notes={"OURS.": [[57, 52]], "ONE MORE.": [[45, 52]],
                                                    "ALWAYS HAS BEEN.": [[45, 49, 52]]},
                      A={"OURS.": "gang", "ONE MORE.": "gang", "ALWAYS HAS BEEN.": "lead"}, colour="room",
                      D={"OURS.": [("oi", 0)], "ONE MORE.": [("hup", 0), ("hup", 0.5)], "ALWAYS HAS BEEN.": [("oh", 0)]},
                      pick="A"),
    "empire": dict(title="CIVILIZATION", bars=(0, 2),
                   voiced={"SHUT THE FUCK UP": "SHUT THE FUCK UP ABOUT EUROPE.", "ABOUT EUROPE.": None},
                   lines=empire_lines, notes={"SHUT THE FUCK UP ABOUT EUROPE.": [[49, 53, 56], [49, 53, 56], [54, 58, 49], [54, 58, 49]]},
                   A={"*": "lead"}, colour="hall",
                   D={"SHUT THE FUCK UP ABOUT EUROPE.": [("hut", 0), ("hut", 0.5), ("hup", 1), ("hey", 1.5)]},
                   pick="A"),
    # script v11 (27 Sep) dropped ONE ROAD.; it is voiced on its old beat (b22) for the demo, OUR PARTY. on its frame (b24)
    "commonwealth": dict(title="COMMON WEALTH", bars=(4, 8), voiced={"ONE ROAD.": "ONE ROAD.", "OUR PARTY.": "OUR PARTY."},
                         extra=[(22, "ONE ROAD.")],
                         lines=commonwealth_lines, notes={"ONE ROAD.": [[53, 46], [58, 53, 46]], "OUR PARTY.": [[58, 53, 46]]},
                         A={"ONE ROAD.": "lead+gang", "OUR PARTY.": "gang+lead"}, colour="hall",
                         gang_word={"ONE ROAD.": ("Road", 1.0)},
                         D={"ONE ROAD.": [("hey", 0), ("hey", 1)], "OUR PARTY.": [("oh", 0)]},
                         pick="A"),
}
V.VOCABLES.setdefault("hut", "Hut")


# ================================================================ song window
def build(key):
    mod = importlib.import_module("songs2." + key)
    return mod.song()


def window(orig, b0, b1, keep_stems=False):
    """Bars b0..b1 of the song's bars (plus one empty lead-in bar), persistent state carried in, stems dropped."""
    state = {}
    for bar in orig[:b0]:
        for k in PERSIST:
            if k in bar:
                state[k] = bar[k]
    bars = []
    for i, bar in enumerate(orig[b0:b1]):
        nb = {k: v for k, v in bar.items() if (k != "_stem" or keep_stems) and k not in ("_flash", "_freeze")}
        if i == 0:
            for k, v in state.items():
                nb.setdefault(k, v)
        bars.append(nb)
    return [dict((k, v) for k, v in state.items())] + bars


def stems_in(song, b0, b1):
    """[(bar_rel (1-based: the lead-in is bar 0), step, text, onset, gain, sig)] for the text stems in the window."""
    out = []
    for b in range(b0, b1):
        for e in song.bars[b].get("_stem", ()):
            if isinstance(e[0], np.ndarray) and len(e) > 3 and e[3]:
                out.append((b - b0 + 1, e[1], e[3], e[4] if len(e) > 4 else 0.0, e[2] if len(e) > 2 else 1.0, e[0]))
    return out


def render(song, bars, voices=None):
    song.bars = bars
    song.dur = len(bars) * 16 * song.step + 2.5
    song.loop, song.sections, song.sting = False, None, None
    if voices is not None:
        song.voices = voices
    out, _, _ = song.render()
    return out


# ================================================================ vocals per approach
def _mix(parts):
    """[(stereo, pcenter, gain)] aligned on their anchors -> (stereo, pcenter)."""
    pre = max(p for _, p, _ in parts)
    L = max(int(round((pre - p) * SR)) + len(s) for s, p, _ in parts)
    out = np.zeros((L + 8, 2))
    for s, p, g in parts:
        i = int(round((pre - p) * SR))
        out[i:i + len(s)] += s * g
    return out, pre


def vocal(cfg, line, approach, seed, bpm):
    lines = cfg["lines"](bpm)
    ws = lines[line]
    s = _b(bpm)
    if approach == "A":
        style = cfg["A"].get(line, cfg["A"].get("*"))
        col = cfg["colour"]
        if style == "crowd":
            c, cm = V.crowd(ws, n=40, seed=seed, colour_="room")
            g, gm = V.gang(ws, n=5, seed=seed + 7, colour_="room")        # a front row (with its leader): the words' edge
            return _mix([(c, cm["pcenter"], 1.0), (g, gm["pcenter"], 0.45)])
        if style == "gang":
            st, m = V.gang(ws, n=6, seed=seed, colour_="room")
            return st, m["pcenter"]
        if style == "lead":
            st, m = V.lead(ws, seed=seed, colour_="room" if col in ("stadium", "room") else col)
            return st, m["pcenter"]
        if style == "lead+gang":                       # the lead calls the line, the gang lands its last word
            st, m = V.lead(ws, seed=seed, colour_="room")
            word, at = cfg["gang_word"][line]
            g, gm = V.gang(word, n=6, seed=seed, colour_="room")
            return _mix([(st, m["pcenter"], 1.0), (g, gm["pcenter"] - at * s, 0.8)])
        if style == "gang+lead":
            g, gm = V.gang(ws, n=7, seed=seed, colour_="room")
            st, m = V.lead(ws, seed=seed + 1, colour_="room")
            return _mix([(g, gm["pcenter"], 1.0), (st, m["pcenter"], 0.55)])
    if approach == "B":
        nts = cfg["notes"][line]
        style = "lead" if cfg["A"].get(line, cfg["A"].get("*")) == "lead" else "gang"
        st, m = V.sing(ws, nts, style=style, n=6, seed=seed, kind="saw", colour_="room")
        return st, m["pcenter"]
    if approach == "C":
        st, m = V.crowd_texture(ws, n=48, seed=seed, colour_="stadium")
        return st, m["pcenter"]
    if approach == "D":
        beats = [(k, b * s) for k, b in cfg["D"][line]]            # (vocable, beats after the anchor)
        st, m = V.nonverbal(beats, n=20 if cfg["colour"] == "stadium" else 12, seed=seed,
                            style="crowd" if cfg["colour"] == "stadium" else "gang",
                            colour_="room",
                            roar=0.35 if line in ("ALWAYS HAS BEEN.",) or cfg["colour"] == "stadium" else 0.15)
        return st, m["pcenter"]
    raise ValueError(approach)


def _lufs(x):
    return A.lufs(x) if np.abs(x).max() > 0 else -99.0


# ================================================================ one piece
class Ctx:
    """A piece's song, window, the old stems' events and the clip cut."""

    def __init__(self, key):
        self.key, self.cfg = key, PIECES[key]
        b0, b1 = self.b0, self.b1 = self.cfg["bars"]
        self.song = build(key)
        self.bpm, self.step = self.song.bpm, self.song.step
        self.orig = self.song.bars
        self.events = [e for e in stems_in(self.song, b0, b1) if e[2] in self.cfg["voiced"]]
        self.has_stems = bool(self.events)
        if not self.events:                                  # no voiced stems (words OFF in the song): the frames'
            for b in range(b0, b1):                          # '_line' text hits give the beats
                ln = self.orig[b].get("_line")
                if not ln:
                    continue
                for st, txt in ([ln] if isinstance(ln[0], (int, float)) else ln):
                    if txt in self.cfg["voiced"]:
                        self.events.append((b - b0 + 1, st, txt, 0.0, 1.0, None))
        for beat, txt in self.cfg.get("extra", ()):          # a demo line the current script no longer has
            b = int(beat // 4)
            self.events.append((b - b0 + 1, (beat - 4 * b) * 4, txt, 0.0, 1.0, None))
        self.events.sort(key=lambda e: (e[0], e[1]))
        self.t_start = 16 * self.step - 2 * 60 / self.bpm          # clips start two beats before the window

    def cut(self, x):
        n = int(((self.b1 - self.b0) * 16 * self.step + 2 * 60 / self.bpm + 1.2) * SR)
        y = x[int(self.t_start * SR): int(self.t_start * SR) + n]
        return np.pad(y, ((0, n - len(y)), (0, 0)))

    def place(self, ap):
        """-> (bars with the new vocals as '_stem', the vocal alone as placed (pre-master level), [(t, line)],
        {line: (isolated vocal, pcenter)})."""
        bars = [dict(b) for b in window(self.orig, self.b0, self.b1)]
        vox = np.zeros((len(bars) * 16 * int(self.step * SR) + 3 * SR, 2))
        placed, iso = [], {}
        k = 0
        for br, st, txt, on, g, sig in self.events:
            line = self.cfg["voiced"][txt]
            if line is None:
                continue
            new, pc = vocal(self.cfg, line, ap, seed=k % 2, bpm=self.bpm)   # two takes alternate (never the same sample)
            k += 1
            iso.setdefault(line, (new, pc))
            # loudness: the old stem's loudness x its song gain (keeps the song's designed vocal balance)
            ref = _lufs(sig) + 20 * np.log10(max(g, 1e-6)) if sig is not None else REF_LUFS
            gain = 10 ** ((ref - _lufs(new)) / 20) if ref > -60 else 1.0
            if ap == "D":
                gain *= 10 ** (-2 / 20)
            bars[br].setdefault("_stem", []).append((new, st, gain, txt, pc))
            t_beat = self.song._time(br, st)                  # (the lead-in bar is bar 0)
            i = int(round((t_beat - pc) * SR))
            seg = new[: len(vox) - i] * gain
            vox[i:i + len(seg)] += seg
            placed.append((t_beat - self.t_start, line))
        return bars, vox, placed, iso


def piece(key):
    """Render the six variants of a piece to review/voice_demo/."""
    c = Ctx(key)
    print(f"== {c.cfg['title']} ({key}) bars {c.b0}-{c.b1 - 1}", flush=True)
    os.makedirs(OUT, exist_ok=True)
    A.write_wav(os.path.join(OUT, f"{key}_none.wav"), c.cut(render(c.song, window(c.orig, c.b0, c.b1))))
    if c.has_stems:
        A.write_wav(os.path.join(OUT, f"{key}_old.wav"), c.cut(render(c.song, window(c.orig, c.b0, c.b1, keep_stems=True))))
    elif os.path.exists(os.path.join(OUT, f"{key}_old.wav")):
        os.remove(os.path.join(OUT, f"{key}_old.wav"))       # the song no longer has the old voice
    for ap in "ABCD":
        bars, vox, placed, _ = c.place(ap)
        mix = render(c.song, bars, voices=True if (key == "red_wedge" and ap == "B") else None)
        c.song.voices = None
        A.write_wav(os.path.join(OUT, f"{key}_{ap}.wav"), c.cut(mix))
        v = c.cut(vox)
        A.write_wav(os.path.join(OUT, f"{key}_{ap}_vox.wav"), v / (np.abs(v).max() + 1e-9) * 0.89)   # peak -1 dBFS
        print(f"  {ap} rendered", flush=True)


def _asr(line, iso, mix, t):
    ref = " ".join(M._clean(line))
    a, b = int(max(0, t - 0.4) * SR), int((t + 1.6) * SR)
    so, mo = M.asr_open(iso), M.asr_open(mix[a:b])
    return {"line": line, "iso_open": so, "iso_wer": round(M.wer(ref, so), 2), "iso_choice": M.asr_choice(iso, ref, POOL)[1],
            "mix_open": mo, "mix_wer": round(M.wer(ref, mo), 2), "mix_choice": M.asr_choice(mix[a:b], ref, POOL)[1]}


def measure(key):
    """Metrics from the rendered clips (+ the cached vocals): intelligibility (ASR open / line-ID, isolated and in
    the mix), vowel-onset timing vs the beat, vocal vs bed loudness and 1-4 kHz margin, clipping / true peak,
    spectrum, and f0 naturalness of the isolated vocals."""
    c = Ctx(key)
    none = _read(os.path.join(OUT, f"{key}_none.wav"))
    res = {"title": c.cfg["title"], "bpm": c.bpm, "bars": [c.b0, c.b1], "none_lufs": round(A.lufs(none), 2), "clips": {}}
    for ap in list("ABCD") + (["old"] if c.has_stems else []):
        mix = _read(os.path.join(OUT, f"{key}_{ap}.wav"))
        vin = mix - none[: len(mix)]                        # the vocal as it sits in the master (approx.)
        if ap == "old":
            placed = [(c.song._time(br, st) - c.t_start, c.cfg["voiced"][txt]) for br, st, txt, *_ in c.events
                      if c.cfg["voiced"][txt]]
            iso = {}
            for br, st, txt, on, g, sig in c.events:
                if c.cfg["voiced"][txt] and sig is not None:
                    iso.setdefault(c.cfg["voiced"][txt], (sig, on))
            vox = None
        else:
            _, vox, placed, iso = c.place(ap)
            vox = c.cut(vox)
            A.write_wav(os.path.join(OUT, f"{key}_{ap}_vox.wav"), vox / (np.abs(vox).max() + 1e-9) * 0.89)
        wins = [(max(0.0, t - 0.25), t + 0.6) for t, _ in placed]
        r = {"mix_lufs": round(A.lufs(mix), 2), "clip_mix": M.clip(mix),
             "vox_vs_bed": M.vox_vs_mix(vin, mix, wins[:6]),
             "asr": [_asr(ln, x, mix, next(t for t, l in placed if l == ln)) for ln, (x, _) in iso.items()],
             "spectrum_iso": {ln: M.spectrum(x) for ln, (x, _) in iso.items()},
             "naturalness_iso": {ln: M.naturalness(x) for ln, (x, _) in iso.items()}}
        # the beat contract per line: the isolated vocal's first vowel onset vs its pcenter (where the beat lands)
        r["onset_err_iso_ms"] = {ln: M.onsets(x, [(pc, ln)])[0][1] for ln, (x, pc) in iso.items()}
        r["energy_onset_iso_ms"] = {ln: M.energy_onsets(x, [(pc, ln)])[0][1] for ln, (x, pc) in iso.items()}
        if vox is not None:
            r["onset_err_ms"] = M.onsets(vox, placed)
            r["clip_iso"] = {ln: M.clip(x) for ln, (x, _) in iso.items()}
        res["clips"][ap] = r
        print(f"  {ap}: asr " + json.dumps(r["asr"]) + " | onsets iso " + json.dumps(r["onset_err_iso_ms"]) +
              " in-mix " + json.dumps(r.get("onset_err_ms")) +
              f" | mix TP {r['clip_mix']['tp_db']} clipped {r['clip_mix']['clipped']} | vox-bed 1-4k " +
              json.dumps([w["vox_minus_bed_1_4k_db"] for w in r["vox_vs_bed"]]), flush=True)
    return res


# ================================================================ reel
def _label(text):
    st, m = V.spoken(text, voice="bm_george", speed=1.0, colour_="dry")
    return st * 0.7


def _read(path):
    import wave
    w = wave.open(path)
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, 2).astype(float) / 32768
    return x


def _enc(wav, m4a):
    # AAC overshoots the -1.2 dBTP masters by 1-1.5 dB: -1.3 dB and a -2 dBFS limiter keep the house <= -1 dBTP ceiling
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", wav, "-af", "volume=-1.3dB,alimiter=limit=0.794:level=false",
                    "-c:a", "aac", "-b:a", "256k", m4a], check=True)


def reel(keys):
    gap = np.zeros((int(0.35 * SR), 2))
    names = {"none": "as it is now, no voice", "A": "A. performance", "B": "B. instrument", "C": "C. crowd texture",
             "D": "D. no words"}
    parts, cues, t = [], [], 0.0
    for key in keys:
        cfg = PIECES[key]
        lab = _label(cfg["title"].title() + ".")
        parts += [lab, gap]
        t += (len(lab) + len(gap)) / SR
        for v in ("none", "A", "B", "C", "D"):
            p = os.path.join(OUT, f"{key}_{v}.wav")
            if not os.path.exists(p):
                continue
            lab = _label(names[v])
            x = _read(p)
            x = A._fade(x, 0.005, 0.25)
            parts += [lab, gap * 0.5, x, gap]
            cues.append({"t": round(t + (len(lab) + len(gap) * 0.5) / SR, 2), "piece": cfg["title"], "variant": v})
            t += (len(lab) + len(gap) * 0.5 + len(x) + len(gap)) / SR
    full = np.concatenate(parts)
    A.write_wav(os.path.join(OUT, "voice_demo_reel.wav"), full)
    _enc(os.path.join(OUT, "voice_demo_reel.wav"), os.path.join(OUT, "voice_demo_reel.m4a"))
    # the 20-30 s demo: the recommended approach per piece, back to back
    short, sc, t = [], [], 0.0
    for key in keys:
        cfg = PIECES[key]
        x = _read(os.path.join(OUT, f"{key}_{cfg['pick']}.wav"))
        x = A._fade(x[: int(min(len(x) / SR, 7.0) * SR)], 0.005, 0.3)
        sc.append({"t": round(t, 2), "piece": cfg["title"], "variant": cfg["pick"]})
        short += [x, gap * 0.6]
        t += (len(x) + len(gap) * 0.6) / SR
    s = np.concatenate(short)
    A.write_wav(os.path.join(OUT, "voice_demo_30s.wav"), s)
    _enc(os.path.join(OUT, "voice_demo_30s.wav"), os.path.join(OUT, "voice_demo_30s.m4a"))
    return cues, sc, len(full) / SR, len(s) / SR


if __name__ == "__main__":
    keys = [a for a in sys.argv[1:] if not a.startswith("--")] or list(PIECES)
    mpath = os.path.join(OUT, "metrics.json")
    allm = json.load(open(mpath)) if os.path.exists(mpath) else {}
    if "--measure-only" not in sys.argv and "--reel-only" not in sys.argv:
        for k in keys:
            piece(k)
    if "--reel-only" not in sys.argv and "--no-measure" not in sys.argv:
        for k in keys:
            allm[k] = measure(k)
            os.makedirs(OUT, exist_ok=True)
            json.dump(allm, open(mpath, "w"), indent=1, default=float)
    if "--no-reel" not in sys.argv:
        cues, sc, L, Ls = reel([k for k in PIECES if os.path.exists(os.path.join(OUT, f"{k}_A.wav"))])
        allm["_reel"] = {"cues": cues, "dur": round(L, 1), "demo30": sc, "demo30_dur": round(Ls, 1)}
        json.dump(allm, open(mpath, "w"), indent=1, default=float)
        print(f"reel {L:.1f} s, demo {Ls:.1f} s -> {OUT}")
