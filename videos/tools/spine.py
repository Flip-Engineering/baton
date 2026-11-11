#!/usr/bin/env python3
"""spine: the order, pacing and coherence of a piece's argument across words, music and picture, on one tall board.

Report only. It never fails a piece, judges nothing and is wired into no gate. The client, 1 Oct: "guidance/steering
applied to free form content, not rigid regularization, rulings, and gating". The board is for a director to look at; the
notes it prints are facts (a card that misses the song event its author marked, years that go backwards on screen, a card
OCR cannot find or that stays past its clear).

Directions it carries in words, never as flags:
    a stop the argument hasn't asked for reads as the piece losing its place: watch every silence and empty screen and decide;
    when the words push, the music and picture should not fall away unless the slowdown is meant;
    a hold has to be carried by something: a move, a build, or a silence the piece asked for;
    an answer lands best after the problem has peaked; a setup belongs before the escalation;
    give a card the time a first-time viewer needs to read it on a phone; a quotation is given room and never trimmed; a
    flash too fast to read is a choice, not an accident.

One timeline, time running DOWN, one row a beat, 1080 wide (Eisenstein's vertical-montage chart for Nevsky, turned on its side
so it reads on a phone):
    time     beats and seconds, the song's phrases and events (stop / turn / arrival; declared or measured)
    picture  thumbnails (after render)
    cards    an outline sized to the hold, a rough reading time (glance .. first read, engine/score/reading.py) marked on
             it as information, the author's role and, where it differs, the tool's proposal
    argument the level the role sequence gives (escalation steps up, an answer resolves, a turn reopens, the payoff peaks)
    music    energy bar, onsets a beat (dots), two-bar trend (arrow), novelty (Foote 2000: a repeating loop has none)
    picture  optical-flow motion (Farneback; sees a slow zoom that frame difference reads as zero), cuts: declared (script
             frames, card changes) and detected (flow residual + global colour shift), and where the two disagree
    notes    in the right margin, pinned to a span; full sentences listed under the board, with the silences and empty
             screens to watch and the shot lengths in order

Two modes, one JSON schema ("spine/1"):
    plan     script (+ song wav, + hits.json, + song module): before anything is rendered; the picture lane says so
    render   + the rendered mp4: thumbnails, motion, detected cuts, and an OCR check that each card is on screen when the
             script says (tesseract, when installed)

    python3 tools/spine.py board SCRIPT.json [--wav SONG.wav] [--hits H.json] [--video V.mp4] [--song songs2/x.py]
                                  [--out DIR] [--name NAME] [--no-ocr]
    python3 tools/spine.py roles SCRIPT.json                   # the author's roles beside the tool's proposals, with why
    python3 tools/spine.py suggest BOARD.json                  # the notes as sentences
    python3 tools/spine.py diff A.spine.json B.spine.json      # what changed: plan vs render, or version vs version
    python3 tools/spine.py --selftest

Script fields read (research/scripts_final format): bpm, thesis, hook, closer_beat, words[] {beat, text (null = clear),
emphasis, verbatim, kind, hold, source}, frames[] {beat, section, picture, sound}. New, optional (the author's; the tool
proposes but never writes them back): words[].role = setup | escalation | answer | turn | payoff, words[].pace = deliberate,
words[].meets = arrival | stop | turn (a song event the card is meant to land on).
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)

from engine.score import reading as RD  # noqa: E402

try:
    from engine.score import cards as CARDS  # noqa: E402
except Exception:  # noqa: BLE001
    CARDS = None

SCHEMA = "spine/1"
ROLES = ("setup", "escalation", "answer", "turn", "payoff")
PUSHING = ("escalation", "turn")
FLOOR_DB = -50.0
STALL_DB = -45.0             # a beat this quiet counts as the song stopping (silence detection)
FPS_DEFAULT = 30.0


def ffmpeg():
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        pass
    for p in ("/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux",):
        if os.path.exists(p):
            return p
    return "ffmpeg"


_FONT = {}


def font(sz, bold=False):
    k = (sz, bold)
    if k not in _FONT:
        p = "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if bold else "")
        _FONT[k] = ImageFont.truetype(p, sz) if os.path.exists(p) else ImageFont.load_default()
    return _FONT[k]


STOP = set("a an the of to in on at by for from with and or but nor so as is are was were be been it its this that these those "
           "their our your his her my we you they he she i not no now then than there here into onto over under all any each "
           "every own one two does doesn't don't do did has have had will would can could".split())


def stems(text):
    out = set()
    for w in re.findall(r"[a-z']+", (text or "").lower()):
        w = w.strip("'")
        if len(w) < 3 or w in STOP:
            continue
        for suf in ("ings", "ing", "ers", "er", "ed", "es", "s"):
            if w.endswith(suf) and len(w) - len(suf) >= 3:
                w = w[: -len(suf)]
                break
        out.add(w)
    return out


# ============================================================================ script
def load_script(path):
    s = json.load(open(path))
    bpm = float(s.get("bpm") or 120)
    words = sorted([w for w in s.get("words", []) if w.get("beat") is not None], key=lambda w: float(w["beat"]))
    return s, bpm, words


def script_cards(path, s, words, end_beat):
    """Every word entry as a span: cards (text) and clears (null text), each until the next entry, its hold, or the end."""
    kinds = {}
    if CARDS is not None:
        try:
            for c in CARDS.from_script(path):
                kinds[round(c.beat, 3)] = c.kind
        except Exception:  # noqa: BLE001
            pass
    out = []
    for i, w in enumerate(words):
        b0 = float(w["beat"])
        b1 = float(words[i + 1]["beat"]) if i + 1 < len(words) else float(end_beat)
        if isinstance(w.get("hold"), (int, float)) and w["hold"] > 0:
            b1 = min(b1, b0 + float(w["hold"]))
        text = w.get("text")
        e = dict(i=len(out), beat=b0, end=b1, text=text, clear=not text, role=w.get("role"), pace=w.get("pace"),
                 meets=w.get("meets"), emphasis=bool(w.get("emphasis")), verbatim=bool(w.get("verbatim")),
                 source=w.get("source"))
        if text:
            k = w.get("kind") if w.get("kind") in RD.KINDS else None
            if not k and str(w.get("source", "")).lower().startswith("credit"):
                k = "cite"
            e["kind"] = k or kinds.get(round(b0, 3)) or RD.infer_kind(text)
            e["kind_src"] = "script" if (w.get("kind") in RD.KINDS or k) else ("cards.py" if round(b0, 3) in kinds else "reading.py")
        out.append(e)
    # a gap before the first entry, or a hold that ends before the next entry, leaves the screen empty: record it as a clear
    filled = []
    for i, e in enumerate(out):
        filled.append(e)
        nxt = out[i + 1]["beat"] if i + 1 < len(out) else float(end_beat)
        if e["end"] < nxt - 1e-6:
            filled.append(dict(i=-1, beat=e["end"], end=nxt, text=None, clear=True, role=None, pace=None, meets=None,
                               emphasis=False, verbatim=False, source="hold ends"))
    for i, e in enumerate(filled):
        e["i"] = i
    return filled


# ============================================================================ roles
TURN_LEADS = {"now", "but", "yet", "today", "still", "instead", "except", "unless"}
STEP_LEADS = {"then", "and", "so", "soon", "until"}
SETTLE = {"agreed", "agree", "won", "win", "passed", "pass", "solved", "ended", "settled", "fixed", "built", "made", "chose",
          "decided", "signed", "answer", "answered", "united"}


def propose_roles(entries, s, end_beat):
    """Deterministic, explained proposals. -> {i: (role, why)}. Never written back into a script."""
    thesis = stems(s.get("thesis") or "")
    cards = [e for e in entries if not e["clear"]]
    if not cards:
        return {}
    opening_cut = max(cards[0]["beat"] + 1e-6, 0.10 * end_beat)
    opening = set()
    for c in cards:
        if c["beat"] <= opening_cut:
            opening |= stems(c["text"])
    opening |= stems(s.get("hook") or "")
    out = {}
    last = cards[-1]
    seen_push = False
    for c in cards:
        t = c["text"]
        ws = re.findall(r"[A-Za-z']+", t.lower())
        st = stems(t)
        lead = ws[0] if ws else ""
        has_year = bool(re.search(r"\b1[5-9]\d\d\b|\b20\d\d\b", t))
        call = sorted(st & opening)
        th = sorted(st & thesis)
        if c.get("kind") == "cite":
            r, why = "credit", "a credit: carries no step in the argument"
        elif c is last or c.get("meets") == "arrival":
            r, why = "payoff", "the last card" if c is last else "marked to meet the arrival"
            if call:
                why += f"; calls back the opening ({', '.join(call)})"
        elif c["beat"] <= opening_cut and not seen_push:
            r, why = "setup", "opens the piece"
        elif lead in TURN_LEADS:
            r, why = "turn", f"opens on {lead.upper()}: a change of frame"
        elif (st & SETTLE) and (has_year or any(ch.isdigit() for ch in t)):
            r, why = "answer", f"a date and a settlement ({', '.join(sorted(st & SETTLE))})"
        elif lead in STEP_LEADS:
            r, why = "escalation", f"opens on {lead.upper()}: the story moves"
        elif "?" in t:
            r, why = "escalation", "a question raises the stakes"
        elif c.get("verbatim"):
            r, why = "escalation", "quoted evidence"
        elif th:
            r, why = "escalation", f"presses the thesis ({', '.join(th)})"
        elif call:
            r, why = "escalation", f"returns to the opening ({', '.join(call)})"
        else:
            r, why = "aside?", "shares no term with the thesis or the opening (weak: words, not meaning)"
        if r in PUSHING:
            seen_push = True
        out[c["i"]] = (r, why)
    return out


def argument_levels(entries, nb):
    """Per-beat argument level from the role sequence (author's role, else the proposal), and per-entry levels."""
    lvl, peak, pushed = 1.0, 1.0, False
    per = np.ones(nb)
    for e in entries:
        r = e.get("role_used")
        if r == "setup":
            lvl = max(1.0, lvl - 1.0) if pushed else 1.0
        elif r == "escalation":
            lvl += 1.0
            pushed = True
        elif r == "answer":
            lvl = max(1.0, lvl - 2.0)
        elif r == "turn":
            lvl += 0.5
            pushed = True
        elif r == "payoff":
            lvl = max(lvl, peak) + 1.0
        peak = max(peak, lvl)
        e["level"] = round(lvl, 2)
        b0, b1 = int(math.floor(e["beat"])), int(math.ceil(e["end"]))
        per[max(0, b0):min(nb, b1)] = lvl
    return per


# ============================================================================ music
def music_lanes(wav, bpm, nb, song=None):
    from engine.score import measure as M
    from engine.score import phrase as PH
    x, sr = M.read_wav(wav)
    spb = 60.0 / bpm
    db = np.full(nb, -120.0)
    for b in range(nb):
        seg = x[int(b * spb * sr):int((b + 1) * spb * sr)]
        if len(seg):
            db[b] = 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-6)
    top = float(np.percentile(db, 95))
    floor = top - 36.0
    energy = np.clip((db - floor) / (top - floor), 0, 1)
    t, s = M.onset_strength(x, sr=sr)
    pk = [i for i in range(1, len(s) - 1) if s[i] >= 3.0 and s[i] >= s[i - 1] and s[i] > s[i + 1]]
    pkt, last = [], -1.0
    for i in pk:
        if t[i] - last >= 0.05:
            pkt.append(t[i])
            last = t[i]
    pkt = np.array(pkt)
    onsets = np.array([int(((pkt >= b * spb) & (pkt < (b + 1) * spb)).sum()) for b in range(nb)]) if len(pkt) else np.zeros(nb, int)
    onsets = np.where(db < STALL_DB, 0, onsets)
    dens = np.clip(onsets / 4.0, 0, 1)
    tension = 0.6 * energy + 0.4 * dens
    ts = np.convolve(np.pad(tension, 1, mode="edge"), np.ones(3) / 3, mode="valid")
    trend = np.zeros(nb)
    for b in range(nb):
        a0, a1 = max(0, b - 4), min(nb, b + 4)
        if a1 - a0 >= 3:
            xs = np.arange(a0, a1)
            trend[b] = np.polyfit(xs, ts[a0:a1], 1)[0] * 4.0      # change a bar
    # beat-synchronous features for novelty and repetition: chroma, a 4-slot onset pattern, the level
    tc, C = PH._chroma(x, sr)
    F = []
    for b in range(nb):
        m = (tc >= b * spb) & (tc < (b + 1) * spb)
        ch = C[:, m].mean(axis=1) if np.any(m) else np.zeros(12)
        ch = ch / (np.linalg.norm(ch) + 1e-9)
        slots = []
        for q in range(4):
            mm = (t >= (b + q / 4) * spb) & (t < (b + (q + 1) / 4) * spb)
            slots.append(float(s[mm].max()) if np.any(mm) else 0.0)
        sl = np.log1p(np.array(slots))
        sl = sl / (np.linalg.norm(sl) + 1e-9)
        F.append(np.concatenate([ch, sl * 0.8, [energy[b] * 1.5]]))
    F = np.array(F)
    Fn = F / (np.linalg.norm(F, axis=1, keepdims=True) + 1e-9)
    S = Fn @ Fn.T
    L = 4
    g = np.exp(-0.5 * (np.arange(-L, L) + 0.5) ** 2 / (L / 2.0) ** 2)
    sign = np.sign(np.arange(-L, L) + 0.5)
    K = np.outer(g * sign, g * sign)
    K /= np.abs(K).sum()
    Sp = np.pad(S, L, mode="edge")
    novelty = np.array([float((K * Sp[b:b + 2 * L, b:b + 2 * L]).sum()) for b in range(nb)])
    novelty = np.clip(novelty * 2.0, 0, 1)
    rep = np.zeros(nb)
    for b in range(8, nb):
        rep[b] = float(np.mean([S[b - k, b - k - 8] for k in range(0, min(8, b - 7))]))
    pm = PH.read(wav, bpm, song=song, beats=nb, floor_db=FLOOR_DB)
    silent = db < STALL_DB
    return dict(db=db, energy=energy, onsets=onsets, tension=tension, trend=trend, novelty=novelty, repeat=rep,
                silent=silent, phrases=pm["phrases"], events=[e for e in pm["events"] if e["kind"] != "hit"])


def hits_events(hits, bpm):
    """The song's own declared events from a hit map (out/.<scene>.hits.json shape)."""
    spb = 60.0 / bpm
    ev = []
    for ch, kind in (("arrival", "arrival"), ("stop", "stop"), ("riser", "riser"), ("turn", "turn"), ("drop", "drop")):
        for t in hits.get("hits", {}).get(ch, []):
            ev.append(dict(beat=round(float(t) / spb * 4) / 4, kind=kind, size=0, src="declared (hits)"))
    p = hits.get("payoff") or {}
    if p.get("beat") is not None:
        ev.append(dict(beat=float(p["beat"]), kind="payoff", size=0, src="declared (hits)"))
    return ev


def hits_density(hits, bpm, nb):
    spb = 60.0 / bpm
    n = np.zeros(nb)
    for ch, ts in hits.get("hits", {}).items():
        if ch in ("arrival", "stop", "riser", "turn", "drop"):
            continue
        for t in ts:
            b = int(float(t) / spb)
            if 0 <= b < nb:
                n[b] += 1
    return n


# ============================================================================ picture
def decode_small(video, w=135, h=240):
    r = subprocess.run([ffmpeg(), "-hide_banner", "-v", "error", "-i", video, "-an", "-vf", f"scale={w}:{h}:flags=area",
                        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True)
    a = np.frombuffer(r.stdout, np.uint8)
    n = len(a) // (w * h * 3)
    rr = subprocess.run([ffmpeg(), "-hide_banner", "-i", video], capture_output=True, text=True).stderr
    m = re.search(r"(\d+(?:\.\d+)?) fps", rr)
    fps = float(m.group(1)) if m else FPS_DEFAULT
    m = re.search(r"Video: .*?, (\d{2,5})x(\d{2,5})", rr)
    wh = (int(m.group(1)), int(m.group(2))) if m else None
    return a[: n * w * h * 3].reshape(n, h, w, 3), fps, wh


def picture_lanes(video, bpm, nb):
    import cv2
    V, fps, wh = decode_small(video)
    n, H, W = V.shape[:3]
    spb = 60.0 / bpm
    G = [cv2.cvtColor(v, cv2.COLOR_RGB2GRAY) for v in V]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    mag = np.zeros(n)
    res = np.zeros(n)
    for i in range(1, n):
        f = cv2.calcOpticalFlowFarneback(G[i - 1], G[i], None, 0.5, 3, 15, 3, 5, 1.2, 0)
        mag[i] = float(np.hypot(f[..., 0], f[..., 1]).mean())
        wc = cv2.remap(G[i], xx + f[..., 0], yy + f[..., 1], cv2.INTER_LINEAR)
        res[i] = float(np.abs(wc.astype(np.float32) - G[i - 1]).mean())
    bh, bw = H // 12, W // 9
    B = V[:, : bh * 12, : bw * 9].astype(np.float32).reshape(n, 12, bh, 9, bw, 3).mean((2, 4))
    shift = np.zeros(n)
    shift[1:] = np.abs(np.median(np.diff(B, axis=0).reshape(n - 1, -1, 3), axis=1)).max(1)

    def loc(v, i, k=6):
        nbh = np.r_[v[max(0, i - k):i], v[i + 1:i + 1 + k]]
        return float(np.median(nbh)) if len(nbh) else 0.0

    cuts, cut_frames = [], set()
    for i in range(1, n):
        if (res[i] > 2 and res[i] > 3 * loc(res, i) + 1) or (shift[i] > 4 and shift[i] > 3 * loc(shift, i) + 1):
            tt = i / fps
            if not cuts or tt - cuts[-1] > 0.1:
                cuts.append(round(tt, 3))
                cut_frames.add(i)
    pct = mag / W * fps * 100.0                    # % of the frame's width a second
    motion = np.zeros(nb)
    for b in range(nb):
        i0, i1 = int(b * spb * fps) + 1, int((b + 1) * spb * fps) + 1
        idx = [i for i in range(i0, min(i1, n)) if i not in cut_frames]
        motion[b] = float(np.mean(pct[idx])) if idx else 0.0
    thumbs = {}
    for b in range(0, nb, 2):
        i = min(n - 1, int((b + 1) * spb * fps))
        thumbs[b] = V[i]
    return dict(fps=fps, size=wh, frames=n, motion=motion, cuts=cuts, thumbs=thumbs)


def ocr_check(video, entries, bpm, fps):
    """Is each card on screen when the script says? tesseract on the frame a little after it starts and a little before
    it ends, and (for the card before a clear or a stall) a little after it should have gone."""
    tess = shutil.which("tesseract")
    if not tess:
        return None
    spb = 60.0 / bpm
    tmp = tempfile.mkdtemp(prefix="spine_ocr_")
    out = {}

    def ocr(p, psm):
        try:      # one thread: tesseract's OpenMP stalls for minutes on a busy 4-core box
            r = subprocess.run([tess, p, "-", "--psm", psm], capture_output=True, text=True, timeout=20,
                               env=dict(os.environ, OMP_THREAD_LIMIT="1"))
            return re.sub(r"[^A-Z0-9]", "", r.stdout.upper())
        except subprocess.TimeoutExpired:
            return ""

    def grab(t, words):
        """fraction of the card's words found in the OCR text (letters only, so ITFOLLOWSTHE still counts)."""
        p = os.path.join(tmp, "f.png")
        subprocess.run([ffmpeg(), "-v", "error", "-y", "-ss", f"{max(0, t):.3f}", "-i", video, "-frames:v", "1",
                        "-vf", "format=gray", p], capture_output=True)
        if not os.path.exists(p):
            return 0.0
        ws = [re.sub(r"[^A-Z0-9]", "", w.upper()) for w in words.split()]
        ws = [w for w in ws if len(w) >= 2] or [re.sub(r"[^A-Z0-9]", "", words.upper())]
        best = 0.0
        for psm in ("3", "11"):          # 3 reads a card over a busy picture; 11 finds scattered type
            txt = ocr(p, psm)
            best = max(best, sum(1 for w in ws if w in txt) / len(ws))
            if best >= 0.75:
                break
        os.remove(p)
        return best

    try:
        for i, e in enumerate(entries):
            if e["clear"]:
                continue
            t0, t1 = e["beat"] * spb, e["end"] * spb
            a = grab(t0 + min(0.15, (t1 - t0) / 3), e["text"])
            z = grab(t1 - min(0.15, (t1 - t0) / 3), e["text"])
            d = dict(start=round(a, 2), end=round(z, 2))
            nxt = entries[i + 1] if i + 1 < len(entries) else None
            if nxt is not None and nxt["clear"]:
                d["after"] = round(grab(t1 + 0.2, e["text"]), 2)
            out[e["i"]] = d
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


# ============================================================================ analysis
def flag(kind, b0, b1, short, text, card=None, evidence=None):
    """A note: a fact pinned to a span (no weight, no verdict)."""
    return dict(kind=kind, b0=round(float(b0), 2), b1=round(float(b1), 2), short=short, text=text, card=card,
                evidence=evidence or {})


def analyse(script_path, wav=None, hits_path=None, video=None, song=None, ocr=True, name=None):
    s, bpm, words = load_script(script_path)
    spb = 60.0 / bpm
    hits = json.load(open(hits_path)) if hits_path else None
    if hits and not s.get("bpm") and hits.get("bpm"):
        bpm, spb = float(hits["bpm"]), 60.0 / float(hits["bpm"])
    # length: the song wins, then the hit map, then the closer, then the last card + 2 bars
    dur = None
    if wav:
        from engine.score import measure as M
        x, sr = M.read_wav(wav)
        dur = len(x) / sr
    elif hits and hits.get("duration"):
        dur = float(hits["duration"])
    last = max([float(w["beat"]) for w in words] or [0])
    nb = int(math.floor(dur / spb + 1e-6)) if dur else int(max(last + 8, float(s.get("closer_beat") or 0) + 4))
    entries = script_cards(script_path, s, words, nb)
    props = propose_roles(entries, s, nb)
    prev_role = None
    for e in entries:
        p = props.get(e["i"])
        e["proposed"], e["why"] = (p if p else (None, None))
        if e["clear"]:
            e["role_used"] = e["role"]
            e["role_src"] = "author" if e["role"] else None
        else:
            e["role_used"] = e["role"] or (e["proposed"] if e["proposed"] in ROLES else None)
            e["role_src"] = "author" if e["role"] else ("proposed" if e["role_used"] else None)
        if not e["clear"]:
            hold = (e["end"] - e["beat"]) * spb
            b = RD.band(e["text"], kind=e["kind"], verbatim=e["verbatim"])
            e["hold_s"] = round(hold, 2)
            e["need"] = b
        prev_role = e["role_used"] or prev_role
    level = argument_levels(entries, nb)

    music = None
    if wav:
        music = music_lanes(wav, bpm, nb, song=song)
    events = list(music["events"]) if music else []
    if hits:
        events += hits_events(hits, bpm)
    events.sort(key=lambda e: e["beat"])
    pic = None
    if video:
        pic = picture_lanes(video, bpm, nb)
    ocr_res = ocr_check(video, entries, bpm, pic["fps"]) if (video and ocr) else None

    # declared picture changes: the script's frames[] and every card change (a card changing IS a picture change here)
    declared = sorted({round(float(f["beat"]), 2) for f in s.get("frames", []) if f.get("beat") is not None} |
                      {round(e["beat"], 2) for e in entries})
    declared = [b for b in declared if 0 < b < nb]
    cut_report = None
    if pic:
        det_b = [round(t / spb, 2) for t in pic["cuts"]]
        tol = 0.1 / spb
        matched = [b for b in declared if any(abs(b - d) <= tol for d in det_b)]
        unseen = [b for b in declared if b not in matched]
        extra = [d for d in det_b if not any(abs(b - d) <= tol for b in declared)]
        cut_report = dict(declared=len(declared), detected=len(det_b), matched=len(matched), declared_unseen=unseen,
                          detected_undeclared=extra)
    changes = sorted(declared)
    if pic:                      # a detected cut within 0.15 s of a declared change is the same change
        changes = sorted(set(changes) | {round(t / spb, 2) for t in pic["cuts"]
                                          if not any(abs(t / spb - d) * spb < 0.15 for d in declared)})
    shot_beats = [b1 - b0 for b0, b1 in zip([0.0] + changes, changes + [float(nb)]) if b1 - b0 > 1e-6]
    shots = dict(n=len(shot_beats), lengths=[round(x * spb, 2) for x in shot_beats]) if shot_beats else None

    flags = []
    cards = [e for e in entries if not e["clear"]]

    # ---- silences and empty screens, listed for a director to watch (no verdict on them)
    stalls = []
    if music is not None:
        sil = music["silent"] | (music["energy"] < 0.08)
        b = 0
        while b < nb:
            if sil[b]:
                b1 = b
                while b1 < nb and sil[b1]:
                    b1 += 1
                if b1 - b >= 1 and b1 < nb - 1:
                    stalls.append([b, b1, "the song stops"])
                b = b1
            else:
                b += 1
    for e in entries:
        if e["clear"] and e["end"] - e["beat"] >= 2 and e["end"] < nb - 1:
            hit = [st for st in stalls if st[0] < e["end"] and st[1] > e["beat"]]
            if hit:
                hit[0][0], hit[0][1] = min(hit[0][0], e["beat"]), max(hit[0][1], e["end"])
                hit[0][2] = "the song stops and the screen clears"
            else:
                stalls.append([e["beat"], e["end"], "the screen is empty"])
    merged = []
    for st in sorted(stalls):
        if merged and st[0] <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], st[1])
            if "clears" in st[2] or "clears" in merged[-1][2]:
                merged[-1][2] = "the song stops and the screen clears"
        else:
            merged.append(list(st))
    stall_out = [dict(b0=b0, b1=b1, what=what, deliberate=any(e.get("pace") == "deliberate" for e in entries
                                                         if e["beat"] < b1 and e["end"] > b0))
                 for b0, b1, what in merged]

    # ---- meets: the author's own plan (a card marked to land on a song event)
    for e in cards:
        if e.get("meets"):
            ev = [x for x in events if x["kind"] == e["meets"] or (e["meets"] == "arrival" and x["kind"] == "payoff")]
            near = [x for x in ev if abs(x["beat"] - e["beat"]) <= 1.0]
            if not near and ev:
                flags.append(flag("meets", e["beat"], e["end"], f"misses its {e['meets']}",
                                  f"{e['text']} is marked to meet the {e['meets']}, but the song's nearest {e['meets']} is at "
                                  f"b{min(ev, key=lambda x: abs(x['beat'] - e['beat']))['beat']:g}.", card=e["i"]))
            elif near:
                e["met"] = dict(beat=near[0]["beat"], src=near[0]["src"])

    # ---- chronology? (weak): years named out of order
    yrs = []
    for e in cards:
        for y in re.findall(r"\b(1[5-9]\d\d|20\d\d)\b", e["text"]):
            yrs.append((e["beat"], int(y), e))
    for (b0, y0, e0), (b1, y1, e1) in zip(yrs, yrs[1:]):
        if y1 < y0:
            flags.append(flag("chronology", b1, e1["end"], f"dates go back: {y0} then {y1}",
                              f"{y0} (b{b0:g}) comes before {y1} (b{b1:g}) on screen. Fine for a flashback; weak because only "
                              "years written as digits are seen, and it cannot tell what the passage means.", card=e1["i"]))

    # ---- render checks: is each card on screen as scripted?
    if ocr_res:
        for e in cards:
            o = ocr_res.get(e["i"])
            if not o:
                continue
            e["ocr"] = o
            if o["start"] < 0.3 and o["end"] < 0.3:
                flags.append(flag("render", e["beat"], e["end"], "OCR can't read the card",
                                  f"OCR does not find {e['text']} on screen during its scripted span (start {o['start']:.0%}, end "
                                  f"{o['end']:.0%} of its words). OCR fails on busy pictures, so this is weak; check the card "
                                  "rendered and that the script's beat matches the scene.",
                                  card=e["i"]))
            elif o.get("after", 0) >= 0.5:
                flags.append(flag("render", e["end"], e["end"] + 1, "card stays past its clear",
                                  f"{e['text']} is still on screen after the script clears it at b{e['end']:g}.", card=e["i"]))

    flags.sort(key=lambda f: f["b0"])
    for k, f in enumerate(flags):
        f["n"] = k + 1
    cannot = ["whether a claim is true, or a date right (only years written as digits are compared)",
              "what a card means: role proposals count words",
              "whether the pacing works, a hold is carried or a card reads in its time: watch it at phone size",
              "whether a shot shows what the script says it shows",
              "how the piece feels at full speed: watch it"]
    out = dict(schema=SCHEMA, mode="render" if video else "plan", name=name or os.path.splitext(os.path.basename(script_path))[0],
               sources=dict(script=script_path, wav=wav, hits=hits_path, video=video, song=song), bpm=bpm, beats=nb,
               duration=round(nb * spb, 2), thesis=s.get("thesis"),
               entries=[{k: v for k, v in e.items()} for e in entries], argument=[round(float(v), 2) for v in level],
               music=None, picture=None, events=events, stalls=stall_out, flags=flags, shots=shots, cuts=cut_report,
               reading=dict(model="engine/score/reading.py", sources=RD.SOURCES), cannot_see=cannot)
    if music is not None:
        out["music"] = {k: [round(float(v), 3) for v in music[k]] for k in ("db", "energy", "onsets", "tension", "trend",
                                                                            "novelty", "repeat")}
        out["music"]["phrases"] = music["phrases"]
    elif hits:
        out["music"] = dict(onsets=[float(v) for v in hits_density(hits, bpm, nb)], phrases=[], from_hits=True)
    if pic is not None:
        out["picture"] = dict(status="measured", fps=pic["fps"], size=pic["size"], motion=[round(float(v), 2) for v in pic["motion"]],
                              cuts=[round(t / spb, 2) for t in pic["cuts"]], declared=declared)
        out["_thumbs"] = pic["thumbs"]
    else:
        out["picture"] = dict(status="not rendered", declared=declared)
    return out


# ============================================================================ drawing
BG = (18, 17, 16)
INK = (232, 228, 218)
DIM = (150, 145, 135)
GRID = (36, 34, 32)
BAR = (62, 58, 54)
ROLE_COL = {"setup": (110, 150, 205), "escalation": (232, 128, 50), "answer": (90, 180, 115), "turn": (180, 120, 205),
            "payoff": (235, 70, 55), "credit": (130, 130, 130), "aside?": (160, 160, 110), None: (120, 120, 120)}
NOTE_COL = (200, 175, 90)
COL = dict(time=10, thumb=58, card=96, arg=470, mus=528, pic=718, flag=846)
ROW = 26
TOP = 232


def wrap(dr, text, f, maxw):
    lines, cur = [], ""
    for w in str(text).split():
        t = (cur + " " + w).strip()
        if dr.textlength(t, font=f) <= maxw:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw(board, path):
    nb = board["beats"]
    spb = 60.0 / board["bpm"]
    flags = [f for f in board["flags"]]
    W = 1080
    # footer: the full flag sentences
    tmp = Image.new("RGB", (W, 10))
    dt = ImageDraw.Draw(tmp)
    foot = []
    for f in flags:
        head = f"[{f['n']}] b{f['b0']:g}-{f['b1']:g}  {f['kind']}"
        foot.append((head, wrap(dt, f["text"], font(14), W - 60), f))
    stalls = board.get("stalls") or []
    foot_h = sum(24 + 18 * len(x[1]) + 6 for x in foot) + 260 + 18 * len(stalls)
    H = TOP + nb * ROW + 30 + foot_h
    img = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(img)
    Y = lambda b: TOP + b * ROW  # noqa: E731
    mode = board["mode"]
    dr.text((14, 12), f"SPINE  {board['name']}", font=font(28, True), fill=INK)
    sub = (f"{mode.upper()} board: {'script + song' if mode == 'plan' else 'script + song + render'}   "
           f"{board['bpm']:g} BPM, {nb} beats, {board['duration']:.1f} s")
    dr.text((14, 50), sub, font=font(15), fill=DIM)
    dr.text((14, 74), f"{len(flags)} notes. Thesis: {board.get('thesis') or '-'}", font=font(15), fill=INK)
    sh = board.get("shots")
    if sh:
        dr.text((14, 98), f"shots: {sh['n']} (lengths in order under the board)", font=font(13), fill=DIM)
    cr = board.get("cuts")
    if cr:
        dr.text((14, 118), f"cuts: {cr['declared']} declared (frames + card changes), {cr['detected']} detected, {cr['matched']} agree; "
                f"{len(cr['declared_unseen'])} declared not seen, {len(cr['detected_undeclared'])} seen not declared",
                font=font(13), fill=DIM)
    leg = [("card", "outline = hold; thin bar on top = rough reading time, glance..first read (information)"),
           ("arg", "argument level from roles"), ("music", "energy bar, onset dots, trend arrow, novelty tick (yellow)"),
           ("picture", "motion bar (log), cuts: white declared, cyan detected")]
    yy = 140
    for k, v in leg:
        dr.text((14, yy), f"{k}: {v}", font=font(12), fill=DIM)
        yy += 15
    for k, x0 in COL.items():
        dr.text((x0, TOP - 18), k, font=font(13, True), fill=INK)
    # grid
    for b in range(nb + 1):
        dr.line([(10, Y(b)), (W - 10, Y(b))], fill=GRID if b % 4 else BAR)
        if b % 4 == 0 and b < nb:
            dr.text((COL["time"], Y(b) + 3), f"b{b}", font=font(12, True), fill=INK)
            dr.text((COL["time"], Y(b) + 17), f"{b * spb:.1f}s", font=font(11), fill=DIM)
    # phrases and events in the time lane
    mus = board.get("music") or {}
    for p in mus.get("phrases", []):
        dr.line([(COL["time"], Y(p["start"])), (COL["thumb"] - 6, Y(p["start"]))], fill=(200, 160, 90), width=2)
    for ev in board.get("events", []):
        if ev["kind"] in ("stop", "arrival", "turn", "payoff", "drop", "riser"):
            c = {"stop": (235, 80, 70), "arrival": (110, 210, 120), "payoff": (110, 210, 120)}.get(ev["kind"], (170, 165, 150))
            if ev["kind"] in ("turn", "drop", "riser") and "declared" not in ev["src"]:
                continue
            yb = Y(ev["beat"])
            dr.polygon([(COL["mus"] + 176, yb - 5), (COL["mus"] + 186, yb), (COL["mus"] + 176, yb + 5)], fill=c)
            dr.text((COL["mus"] + 128, yb - 7), ev["kind"][:7], font=font(10), fill=c)
    # thumbnails
    th = board.get("_thumbs") or {}
    for b, a in th.items():
        im = Image.fromarray(a).resize((28, 50))
        img.paste(im, (COL["thumb"], Y(b) + 1))
    if not th:
        dr.text((COL["thumb"], TOP + 6), "not\nren-\ndered", font=font(11), fill=DIM)
    # cards
    smax = 6.0
    cw = COL["arg"] - COL["card"] - 10
    for e in board["entries"]:
        b0, b1 = e["beat"], e["end"]
        rc = ROLE_COL.get(e.get("role_used"), ROLE_COL[None])
        if e["clear"]:
            lab = "(clear" + (f", {e['role']}" if e.get("role") else "") + (f", pace: {e['pace']}" if e.get("pace") else "") + ")"
            dr.text((COL["card"] + 4, Y(b0) + 5), lab, font=font(12), fill=DIM)
            continue
        hold = e["hold_s"]
        nd = e["need"]
        x0 = COL["card"]
        xw = lambda s: x0 + int(min(s, smax) / smax * cw)  # noqa: E731
        dr.rectangle([x0, Y(b0) + 2, max(xw(hold), x0 + 6), Y(b1) - 2], outline=rc, width=2)
        dr.rectangle([xw(nd["glance"]), Y(b0) + 2, max(xw(nd["read"]), xw(nd["glance"]) + 3), Y(b0) + 5], fill=DIM)
        if hold > smax:
            dr.text((xw(smax) - 14, Y(b0) + 8), "»", font=font(14, True), fill=rc)
        role = e.get("role_used") or "-"
        tag = role + ("" if e.get("role_src") != "proposed" else " (tool)")
        if e.get("role") and e.get("proposed") and e["proposed"] != e["role"]:
            tag += f"  · tool: {e['proposed']}"
        dr.text((x0 + 5, Y(b0) + 8), f"{tag}   {hold:.2f}s / {nd['glance']:.1f}-{nd['read']:.1f}s", font=font(12), fill=rc)
        rows = max(1, int((b1 - b0) * ROW - 24) // 16)
        ls = wrap(dr, e["text"], font(13, True), cw - 8)
        if len(ls) > rows:
            ls = ls[:rows]
            ls[-1] = ls[-1][: max(0, len(ls[-1]) - 1)] + "…"
        for k, ln in enumerate(ls):
            dr.text((x0 + 5, Y(b0) + 23 + k * 16), ln, font=font(13, True), fill=INK)
    # argument
    arg = board["argument"]
    amax = max(arg) if arg else 1
    pts = []
    for b, v in enumerate(arg):
        x = COL["arg"] + 4 + (v - 1) / max(1, amax - 1) * 46
        pts += [(x, Y(b)), (x, Y(b + 1))]
    if pts:
        dr.line(pts, fill=(235, 140, 60), width=3)
    # music
    if mus.get("energy"):
        for b in range(nb):
            e = mus["energy"][b]
            dr.rectangle([COL["mus"], Y(b) + 3, COL["mus"] + int(e * 80), Y(b + 1) - 3], fill=(70, 120, 205))
            n = int(mus["onsets"][b])
            for k in range(min(n, 6)):
                dr.ellipse([COL["mus"] + 84 + k * 7, Y(b) + 10, COL["mus"] + 89 + k * 7, Y(b) + 15], fill=(165, 205, 255))
            tr = mus["trend"][b]
            if abs(tr) >= 0.05:
                dr.text((COL["mus"] + 128, Y(b) + 5), "▲" if tr > 0 else "▼", font=font(12),
                        fill=(140, 205, 140) if tr > 0 else (235, 95, 80))
            nv = mus["novelty"][b]
            if nv > 0.02:
                dr.rectangle([COL["mus"] + 150, Y(b) + 4, COL["mus"] + 150 + int(nv * 22), Y(b + 1) - 4], fill=(230, 210, 80))
    elif mus.get("onsets"):
        for b in range(nb):
            n = int(mus["onsets"][b])
            for k in range(min(n, 8)):
                dr.ellipse([COL["mus"] + 4 + k * 7, Y(b) + 10, COL["mus"] + 9 + k * 7, Y(b) + 15], fill=(165, 205, 255))
        dr.text((COL["mus"], TOP + 4), "hits only (no wav)", font=font(11), fill=DIM)
    else:
        dr.text((COL["mus"], TOP + 4), "no song given", font=font(12), fill=DIM)
    # picture
    pic = board.get("picture") or {}
    for b in pic.get("declared", []):
        dr.line([(COL["pic"] + 92, Y(b)), (COL["pic"] + 112, Y(b))], fill=(240, 240, 240), width=2)
    if pic.get("status") == "measured":
        for b in range(nb):
            m = pic["motion"][b]
            w = int(math.log1p(m) / math.log1p(250) * 86)
            dr.rectangle([COL["pic"], Y(b) + 3, COL["pic"] + max(w, 1), Y(b + 1) - 3], fill=(155, 110, 175))
        for b in pic.get("cuts", []):
            dr.line([(COL["pic"] + 100, Y(b)), (COL["pic"] + 124, Y(b))], fill=(80, 220, 230), width=2)
    else:
        dr.text((COL["pic"], TOP + 4), "picture not\nrendered:\ndeclared\nchanges only", font=font(11), fill=DIM)
    # notes in the margin
    fx = COL["flag"]
    nexty = 0
    for f in flags:
        y0, y1 = Y(f["b0"]), Y(min(f["b1"], nb))
        dr.rectangle([fx, y0 + 1, fx + 4, max(y1 - 1, y0 + 6)], fill=NOTE_COL)
        ty = max(y0 + 1, nexty)
        ls = wrap(dr, f"[{f['n']}] {f['short']}", font(12), W - fx - 22)
        for k, ln in enumerate(ls[:3]):
            dr.text((fx + 12, ty + k * 15), ln, font=font(12), fill=NOTE_COL)
        nexty = ty + 15 * min(3, len(ls)) + 4
    # footer
    y = TOP + nb * ROW + 24
    dr.text((14, y), "Notes", font=font(18, True), fill=INK)
    y += 30
    for head, ls, f in foot:
        dr.text((14, y), head, font=font(14, True), fill=NOTE_COL)
        y += 22
        for ln in ls:
            dr.text((30, y), ln, font=font(14), fill=INK)
            y += 18
        y += 6
    if stalls:
        y += 4
        dr.text((14, y), "Silences and empty screens, to watch", font=font(16, True), fill=INK)
        y += 24
        for st in stalls:
            dr.text((30, y), f"b{st['b0']:g}-{st['b1']:g}: {st['what']}" + (" (marked pace: deliberate)" if st.get("deliberate") else ""),
                    font=font(13), fill=DIM)
            y += 18
    y += 8
    dr.text((14, y), "What this board cannot see", font=font(16, True), fill=INK)
    y += 24
    for c in board["cannot_see"]:
        dr.text((30, y), "- " + c, font=font(13), fill=DIM)
        y += 18
    y += 6
    if sh:
        dr.text((14, y), "shot lengths in order (s): " + " ".join(f"{x:g}" for x in sh["lengths"][:60]), font=font(12), fill=DIM)
        y += 18
    dr.text((14, y), "reading time: engine/score/reading.py, information (" + "; ".join(board["reading"]["sources"][:2]) + ")",
            font=font(11), fill=DIM)
    img = img.crop((0, 0, W, min(H, y + 30)))
    img.save(path)
    return path


# ============================================================================ suggest / diff
def suggest(board):
    """The notes as sentences, in order. Nothing is applied to a script."""
    return [f"b{f['b0']:g}: {f['text']}" for f in board["flags"]]


def _cardkey(t):
    return re.sub(r"[^A-Z0-9 ]", "", (t or "").upper()).strip()


def diff(a, b):
    lines = [f"spine diff: {a['name']} ({a['mode']}) -> {b['name']} ({b['mode']})",
             f"  length {a['beats']} -> {b['beats']} beats ({a['duration']:.1f} -> {b['duration']:.1f} s)"]
    ca = [e for e in a["entries"] if not e["clear"]]
    cb = [e for e in b["entries"] if not e["clear"]]
    ka = {_cardkey(e["text"]): e for e in ca}
    kb = {_cardkey(e["text"]): e for e in cb}
    lines.append("  cards:")
    reworded = set()
    for k, e in ka.items():
        if k in kb:
            f = kb[k]
            ch = []
            if abs(f["beat"] - e["beat"]) > 1e-6:
                ch.append(f"b{e['beat']:g} -> b{f['beat']:g}")
            if abs(f["hold_s"] - e["hold_s"]) > 1e-6:
                ch.append(f"hold {e['hold_s']:.2f} -> {f['hold_s']:.2f} s")
            if (f.get("role_used") or "") != (e.get("role_used") or ""):
                ch.append(f"role {e.get('role_used')} -> {f.get('role_used')}")
            if e.get("ocr") or f.get("ocr"):
                if (e.get("ocr") or {}) != (f.get("ocr") or {}):
                    ch.append(f"on screen {e.get('ocr')} -> {f.get('ocr')}")
            if ch:
                lines.append(f"    {e['text'][:48]:<48} " + "; ".join(ch))
        else:
            import difflib
            parts = [x for x in cb if _cardkey(x["text"]) and _cardkey(x["text"]) in k and x["text"] != e["text"]
                     and _cardkey(x["text"]) not in ka]
            near = max(((difflib.SequenceMatcher(None, k, _cardkey(x["text"])).ratio(), x) for x in cb
                        if _cardkey(x["text"]) not in ka), default=(0, None), key=lambda r: r[0])
            if len(parts) == 1 or (not parts and near[0] >= 0.75):
                x = parts[0] if len(parts) == 1 else near[1]
                lines.append(f"    {e['text'][:48]:<48} reworded: {x['text']} (b{e['beat']:g} -> b{x['beat']:g}, "
                             f"{x['hold_s']:.2f}s, role {x.get('role_used')})")
                reworded.add(_cardkey(x["text"]))
            elif parts:
                lines.append(f"    {e['text'][:48]:<48} split into: " + " | ".join(f"{p['text']} ({p['hold_s']:.2f}s)" for p in parts))
            else:
                lines.append(f"    {e['text'][:48]:<48} removed")
    for k, f in kb.items():
        if k not in ka and not any(k in x for x in ka) and k not in reworded:
            lines.append(f"    {f['text'][:48]:<48} added at b{f['beat']:g}")
    order_a = [_cardkey(e["text"]) for e in ca if _cardkey(e["text"]) in kb]
    order_b = [k for k in [_cardkey(e["text"]) for e in cb] if k in ka]
    if order_a != order_b:
        lines.append("  order changed: " + " / ".join(kb[k]["text"][:24] for k in order_b))
    lines.append("  notes:")
    for f in a["flags"]:
        lines.append(f"    before  [{f['n']}] b{f['b0']:g}-{f['b1']:g} {f['short']}")
    for f in b["flags"]:
        lines.append(f"    after   [{f['n']}] b{f['b0']:g}-{f['b1']:g} {f['short']}")
    if a.get("picture", {}).get("status") != b.get("picture", {}).get("status"):
        lines.append(f"  picture: {a['picture']['status']} -> {b['picture']['status']}")
    if a.get("cuts") or b.get("cuts"):
        lines.append(f"  cuts: {a.get('cuts') and a['cuts']['detected']} -> {b.get('cuts') and b['cuts']['detected']} detected")
    if a.get("shots") and b.get("shots"):
        lines.append(f"  shots: {a['shots']['n']} -> {b['shots']['n']}")
    if a.get("music") and b.get("music") and a["music"].get("tension") and b["music"].get("tension"):
        def by_role(bd):
            out = {}
            for e in bd["entries"]:
                r = e.get("role_used")
                if not r:
                    continue
                seg = bd["music"]["tension"][int(e["beat"]):max(int(e["beat"]) + 1, int(e["end"]))]
                out.setdefault(r, []).extend(seg)
            return {r: round(float(np.mean(v)), 2) for r, v in out.items() if v}
        ra, rb = by_role(a), by_role(b)
        lines.append("  music tension under each role: " + ", ".join(f"{r} {ra.get(r, '-')} -> {rb.get(r, '-')}" for r in ROLES))
    return "\n".join(lines)


# ============================================================================ cli
def save(board, out_dir, name=None):
    os.makedirs(out_dir, exist_ok=True)
    nm = name or board["name"]
    png = os.path.join(out_dir, f"{nm}.spine.png")
    js = os.path.join(out_dir, f"{nm}.spine.json")
    draw(board, png)
    b = {k: v for k, v in board.items() if not k.startswith("_")}
    json.dump(b, open(js, "w"), indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o))
    return png, js


def roles_text(board):
    lines = [f"roles: {board['name']} (author | tool proposal | why)"]
    for e in board["entries"]:
        if e["clear"]:
            if e.get("role") or e.get("pace"):
                lines.append(f"  b{e['beat']:<6g} (clear)  {e.get('role') or '-':<11}  pace {e.get('pace')}")
            continue
        mark = "" if not e.get("role") or e.get("proposed") == e.get("role") else "   <- differs"
        lines.append(f"  b{e['beat']:<6g} {(e.get('role') or '-'):<11} | {(e.get('proposed') or '-'):<10} | {e.get('why') or ''}"
                     f"   {e['text'][:44]}{mark}")
    return "\n".join(lines)


def selftest():
    """A tiny synthetic piece: a fast card, a silence, years out of order and a missed `meets`, from a script and a
    generated wav. No repo files."""
    import wave
    tmp = tempfile.mkdtemp(prefix="spine_selftest_")
    try:
        sc = dict(bpm=120, thesis="The clock moved.", words=[
            dict(beat=0, text="THE CLOCK STOOD STILL.", role="setup"),
            dict(beat=4, text="THEN EVERY TOWN ON THE LINE HAD TO CHANGE ITS NOON AT ONCE.", role="escalation"),
            dict(beat=5, text="IT MOVED.", role="escalation"),
            dict(beat=12, text=None, pace="deliberate", role="escalation"),
            dict(beat=16, text="THE CLOCK MOVED IN 1883.", role="payoff", meets="arrival"),
            dict(beat=20, text="BY 1840 IT HAD NOT.", role="setup")])
        sp = os.path.join(tmp, "t.json")
        json.dump(sc, open(sp, "w"))
        sr = 22050
        n = int(24 * 0.5 * sr)
        x = np.zeros(n)
        rng = np.random.default_rng(1)
        for b in range(24):
            if 12 <= b < 16:
                continue
            i = int(b * 0.5 * sr)
            k = np.sin(2 * np.pi * 60 * np.arange(3000) / sr) * np.exp(-np.arange(3000) / 600) * (0.3 if b < 12 else 0.6)
            x[i:i + 3000] += k
            x[i + 2000:i + 2600] += 0.05 * rng.standard_normal(600)
        wp = os.path.join(tmp, "t.wav")
        with wave.open(wp, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes((np.clip(x, -1, 1) * 32000).astype(np.int16).tobytes())
        bd = analyse(sp, wav=wp, ocr=False)
        kinds = [f["kind"] for f in bd["flags"]]
        assert "chronology" in kinds, kinds
        assert not any("weight" in f or "earned" in f for f in bd["flags"]), bd["flags"]
        assert bd["stalls"] and all(set(st) == {"b0", "b1", "what", "deliberate"} for st in bd["stalls"]), bd["stalls"]
        assert all("fit" not in e for e in bd["entries"]), "no reading verdict on a card"
        png, js = save(bd, tmp)
        assert os.path.getsize(png) > 1000
        plan = analyse(sp, ocr=False)
        assert plan["picture"]["status"] == "not rendered" and plan["music"] is None
        b = RD.band("THE SUN SET THE CLOCK.")
        assert b["glance"] < 1.5 < b["read"] < 2.2, b
        print("spine selftest ok: notes", ", ".join(kinds) or "none", "; silences", len(bd["stalls"]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", nargs="?", choices=["board", "roles", "suggest", "diff"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--wav")
    ap.add_argument("--hits")
    ap.add_argument("--video")
    ap.add_argument("--song")
    ap.add_argument("--out", default=".")
    ap.add_argument("--name")
    ap.add_argument("--no-ocr", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if a.cmd == "board":
        bd = analyse(a.args[0], wav=a.wav, hits_path=a.hits, video=a.video, song=a.song, ocr=not a.no_ocr, name=a.name)
        png, js = save(bd, a.out, a.name)
        for f in bd["flags"]:
            print(f"[{f['n']:>2}] b{f['b0']:<5g}-{f['b1']:<5g} {f['kind']:<10} {f['short']}")
        print(f"wrote {png}\n      {js}")
    elif a.cmd == "roles":
        bd = analyse(a.args[0], ocr=False)
        print(roles_text(bd))
    elif a.cmd == "suggest":
        bd = json.load(open(a.args[0]))
        for k, ln in enumerate(suggest(bd)):
            print(f"{k + 1}. {ln}")
    elif a.cmd == "diff":
        print(diff(json.load(open(a.args[0])), json.load(open(a.args[1]))))
    else:
        ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
