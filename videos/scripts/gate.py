#!/usr/bin/env python3
"""gate.py: the publish gate (AUDIT.md §3.3.1, top-15 #3). Run it on the file you are about to publish.

    python3 videos/scripts/gate.py VIDEO.mp4 --scene SCENE [--script research/scripts_final/KEY.json] [options]
    python3 videos/scripts/gate.py out/farm/horde3_share.mp4                  # scene from the file name
    python3 videos/scripts/gate.py HORDE_v8_share.mp4 --scene auto            # scene from the piece name (PIECES)
    python3 videos/scripts/gate.py cut.mp4 --scene frontier3 --only audio,frames

The gate catches breakage and wrong facts; it never judges the work (the client, 1 Oct: "No hard rules or hard gates!
Only guidance/steering!"; 8 Oct: no numeric judgement of creative work). It stops a publish (exit 1) only on breakage:
no audio stream, or a file that won't decode. It reports, for a person:
  - delivery spec: 1080x1920, ~30 fps, true peak at or under -1 dBTP, clipping, the share copy carrying the master's
    audio stream, mono fold-down that cancels, words outside the platform's safe band (--only band);
  - broken frames: the last second blank or black, a black/blank run into the tail (WARN mid-piece), runs of digital
    silence inside the piece;
  - facts: script lines on screen (a "verbatim": true line never seen on screen is flagged), stale or client-rejected
    lines, unscripted words that persist, a declared frame-0 line ('hook_frame0': true) not on frame 0;
  - prompts for a person to look at: frame 0 black or blank, the ☭≡/acc closer not found, a three-stripe mark beside the
    gear, corner overlays, the people audit's frames (a CROTCH flag, raised forward arms), a lockup the frame edge crops;
  - plain information: runtime, integrated loudness (and what normalising platforms do to it), the voices tally.
There is no word ban. Pacing, legibility, loudness shape, the hook, the payoff, value structure and scansion are judged by
watching and listening, not here.

 1 text    OCR (tesseract, via text_check.py) at every cue of the current script, plus an end-to-end scan.
 2 audio   true peak, sample peak and clipping, integrated LUFS (information), digital-silence holes, mono fold-down,
           the share copy's audio stream.
 4 frames  frame 0, the last second, black/blank runs; the loop seam is watched, not measured.
 4b hook   only when the script declares its frame-0 line: is that line on frame 0 (OCR).
 5 brand   the ☭≡/acc lockup in the last seconds; corner overlays (WARN); every ACP mark has four stripes (stripe chains
           matched against web/assets/acp_logo.png; a three-stripe chain beside the gear is a HUMAN prompt).
 6 people  the gesture audit (out/.<scene>.people.json): frames to look at (CROTCH, raised forward arms) with crops; a
           missing or stale audit WARNs. There is no gesture ban.
 7 voices  out/.<scene>.hits.json 'voices': INFO on synthesized word vocals (voices are content to refine, not gated; 1 Oct).
 8 sheet   contact sheet of every flagged frame, labelled with the check and the reason (sheet.jpg).
 (The hits, load, values and scansion checks were removed on 8 Oct; their names are still accepted and do nothing.)

CLIP MODE (--from/--to, or automatic for render.mjs clip names <scene>_<from>-<to>.mp4): gate a test clip. --from is where the clip starts in the PIECE (seconds, or
  b<beat> e.g. --from b20); --to where it ends (default: --from + the clip's length). Only the cues whose hold midpoint
  falls inside the window are required; the thumbnail (frame 0), last-second, loop-seam and lockup checks run only when
  the window contains the piece's start / end. The piece END is the closer beat (web/audio/logo_at.json, else the
  script's closer_beat) + 1.4 s, capped at the song (scripts/piece_bounds.py), not the song length; a tail clip's loop
  seam is compared with the newest render of frame 0 (out/<scene>.mp4, out/<scene>_0-*.mp4, out/stills/<scene>_0.00.jpg); runtime is INFO. The checks above still apply inside the window. Every flagged item
  also carries piece_t (its time in the piece).

Output: videos/review/gate/<file stem>/ report.json, sheet.jpg, text/ (text_check's own report and sheet).

OPTIONS
  --scene S       scene under web/scenes (hits BPM, cue table, picture text). 'auto' maps the piece name
                  (HORDE_v8_share.mp4 -> horde3, see PIECES); default: the file stem without _share/_vN
  --script K      script key or JSON path (default: the scene minus trailing digits, text_check's rule)
  --bpm N / --offset S   override the BPM / shift every cue time: file time = piece time + offset (a published cut
                  with a 0.5 s lead-in is --offset 0.5; a clip that starts 8 s into the piece is --offset -8, but use
                  --from 8, which also windows the checks)
  --from T / --to T      clip mode (above): T in piece seconds or b<beat>
  --chant TEXT    the chant line (default: from the script's 'chant' field / its most repeated line)
  --step S        scan step in seconds for the OCR scan and the brand check (default 0.5)
  --only LIST / --skip LIST   comma list of text,audio,frames,hook,brand,band,people,voices
  --strict        unknown persistent on-screen words FAIL instead of WARN (opt-in)
  --out DIR       report dir;  --json  print the JSON report;  --jobs N  tesseract processes (default 4)
  --keep-frames   keep the full-size scan frames (default: only the flagged ones, shrunk, go in the sheet)
"""
import argparse
import glob
import json
import math
import os
import re
import shutil
import subprocess
import sys
from collections import Counter

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage, signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import text_check as tc  # noqa: E402  (OCR, script/scene context, cue scoring)
import piece_bounds  # noqa: E402  (TOOLING c4: piece end, frame-0 hook, frame-0 reference)
from script_key import script_key  # noqa: E402  (TOOLING WM1: scene -> script key, exact name first)

VIDEOS = os.path.dirname(HERE)
ROOT = os.path.dirname(VIDEOS)
ASSETS = os.path.join(VIDEOS, 'web', 'assets')
REPORTS = os.path.join(VIDEOS, 'review', 'gate')
OUT_DIR = os.path.join(VIDEOS, 'out')
FFMPEG = tc.FFMPEG
FONT = tc.FONT

# published piece name -> scene (for --scene auto and publish.sh)
PIECES = {
    'UNRECOGNIZABLE': 'unrecognizable',
    'ACCELERATE': 'intelligence2', 'ACC_IDENT': 'acc_ident', 'CIVILIZATION': 'empire5',
    'COMMON_WEALTH': 'commonwealth3', 'HORDE': 'horde3', 'IRON_IS_HOT': 'frontier3', 'MELTDOWN': 'meltdown8',
    'OWN_THE_FUTURE': 'ownfuture2', 'PEOPLES_BANK': 'bank3', 'PRODUCTIVE_FORCES': 'productive2',
    'MECHA_PROLETARIAT': 'mecha', 'REJUVENATION': 'rejuvenation3', 'RED_WEDGE': 'red_wedge2', 'THE_GIANT': 'giant', 'GIANT': 'giant_c5', 'SECOND_INDEPENDENCE_1776': 'unfinished3',
    'THE_CHASM': 'the_chasm',
    'BREAD_BREAD': 'bread',
}
STOP = set('A AN THE OF TO IN ON AT BY AND OR IT IS BE ARE WE US OUR YOU YOUR FOR ALL WITH FROM THAT THIS AS I ME MY '
           'HE HIS SHE HER THEY THEM THEIR ITS WAS WERE HAS HAVE NO NOT SO UP DO'.split())
ORDER = {'FAIL': 0, 'HUMAN': 1, 'WARN': 2, 'PASS': 3, 'INFO': 4}


# ================================================================ report plumbing
class Report:
    def __init__(self, target, dest):
        self.target, self.dest = target, dest
        self.items = []          # {check, status, msg, t?, frame?, crop?}
        self.metrics = {}

    def add(self, check, status, msg, t=None, frame=None, crop=None, **kw):
        # Only breakage stops a publish (the client, 1 Oct: "No hard rules or hard gates! Only guidance/steering!").
        # A check that would have said FAIL without breaks=True is reported as WARN, marked as such, for whoever looks.
        if status == 'FAIL' and not kw.pop('breaks', False):
            status, kw['was'] = 'WARN', 'FAIL'
        kw.pop('breaks', None)
        it = {'check': check, 'status': status, 'msg': msg}
        if t is not None:
            it['t'] = t
        if frame is not None:
            it['frame'] = frame
        if crop is not None:
            it['crop'] = [int(v) for v in crop]
        it.update(kw)
        self.items.append(it)
        return it

    def verdict(self):
        st = {i['status'] for i in self.items}
        return 'FAIL' if 'FAIL' in st else 'WARN' if st & {'WARN', 'HUMAN'} else 'PASS'


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, **kw)


def probe(path):
    r = run([FFMPEG, '-hide_banner', '-i', path], text=True)
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r.stderr)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else None
    m = re.search(r'(\d+(?:\.\d+)?) fps', r.stderr)
    fps = float(m.group(1)) if m else 30.0
    m = re.search(r'Video: .*?, (\d{2,5})x(\d{2,5})', r.stderr)
    wh = (int(m.group(1)), int(m.group(2))) if m else (1080, 1920)
    return dur, fps, wh, 'Audio:' in r.stderr


# ================================================================ decoding
def decode_frames(path, every, w, h, nframes):
    """Every `every`-th frame (plus the last one) at w x h RGB: (times, uint8 array N x h x w x 3), one pass."""
    vf = f"select='not(mod(n\\,{every}))+gte(n\\,{nframes - 2})',scale={w}:{h}:flags=area,showinfo"
    r = run([FFMPEG, '-hide_banner', '-i', path, '-an', '-vf', vf, '-fps_mode', 'passthrough', '-f', 'rawvideo',
             '-pix_fmt', 'rgb24', '-'])
    if r.returncode:
        raise SystemExit(f'ffmpeg failed decoding {path}: {r.stderr.decode()[-400:]}')
    ts = [float(x) for x in re.findall(rb'pts_time:\s*([\d.]+)', r.stderr)]
    n = len(r.stdout) // (w * h * 3)
    arr = np.frombuffer(r.stdout[:n * w * h * 3], np.uint8).reshape(n, h, w, 3)
    ts = (ts + [ts[-1] if ts else 0.0] * n)[:n]
    return ts, arr


def extract_scan(path, step, fps, dest, nframes):
    """Full-size JPEGs every `step` s (by frame number, so times are exact) plus the last frame -> {t: path}."""
    os.makedirs(dest, exist_ok=True)
    for old in glob.glob(os.path.join(dest, 's_*.jpg')):
        os.remove(old)
    every = max(1, int(round(step * fps)))
    tmp = os.path.join(dest, '_%05d.jpg')
    r = run([FFMPEG, '-y', '-hide_banner', '-i', path, '-an', '-vf', f"select='not(mod(n\\,{every}))+gte(n\\,{nframes - 1})',showinfo",
             '-fps_mode', 'passthrough', '-q:v', '2', '-start_number', '0', tmp])
    ts = [float(x) for x in re.findall(rb'pts_time:\s*([\d.]+)', r.stderr)]
    out = {}
    for k, t in enumerate(ts):
        p = tmp % k
        if os.path.exists(p):
            q = os.path.join(dest, f's_{t:07.3f}.jpg')
            os.replace(p, q)
            out[round(t, 3)] = q
    for p in glob.glob(os.path.join(dest, '_*.jpg')):
        os.remove(p)
    return out


def decode_audio(path, sr=48000):
    r = run([FFMPEG, '-hide_banner', '-i', path, '-vn', '-ac', '2', '-ar', str(sr), '-f', 'f32le', '-'])
    a = np.frombuffer(r.stdout, np.float32)
    return a.reshape(-1, 2) if a.size else None


def ebur128(path, pre=''):
    """Integrated loudness, LRA, true peak and the 100 ms momentary/short-term log, via ffmpeg's ebur128."""
    af = (pre + ',' if pre else '') + 'ebur128=peak=true:framelog=verbose'
    r = run([FFMPEG, '-hide_banner', '-nostats', '-v', 'verbose', '-i', path, '-vn', '-af', af, '-f', 'null', '-'], text=True)
    e = r.stderr
    summ = e[e.rfind('Summary:'):] if 'Summary:' in e else ''
    g = lambda pat: float(re.search(pat, summ, re.S).group(1)) if re.search(pat, summ, re.S) else None
    log = [(float(t), float(m), float(s)) for t, m, s in
           re.findall(r't:\s*([\d.]+)\s+TARGET:.*?M:\s*(-?[\d.]+|-inf)\s+S:\s*(-?[\d.]+|-inf)', e)
           if m != '-inf' and s != '-inf']
    return {'I': g(r'Integrated loudness:.*?I:\s*(-?[\d.]+)'), 'LRA': g(r'Loudness range:.*?LRA:\s*(-?[\d.]+)'),
            'TP': g(r'True peak:.*?Peak:\s*(-?[\d.]+|-inf)'), 'log': log}


# ================================================================ 1 + 3: on-screen text and text load
def chant_line(script, lines, override=None):
    if override:
        return override
    words = [w.get('text') for w in (script or {}).get('words', []) if isinstance(w, dict) and w.get('text')]
    cnt = Counter(words)
    field = str((script or {}).get('chant') or '')
    fu = ' ' + tc.fold(field) + ' '
    named = [(n, l) for l, n in cnt.items() if n >= 2 and len(tc.fold(l)) >= 2 and ' ' + tc.fold(l) + ' ' in fu]
    if named:
        return max(named)[1]
    top = cnt.most_common(1)
    return top[0][0] if top and top[0][1] >= 3 else None


def text_checks(rep, args, video, scene, key, dur, scan, clip=None):
    fb = tb = None
    if clip:                    # clip mode: text_check grabs only the cues that start inside the window
        fb, tb = clip['from'] / clip['spb'] - 1e-6, clip['to'] / clip['spb']
    ns = argparse.Namespace(out=os.path.join(rep.dest, 'text'), batch=False, cues='script', bpm=args.bpm,
                            last_hold=2.0, dry_run=False, no_blank=False, from_beat=fb, to_beat=tb,
                            offset=args.offset, samples=1, no_retry=False, threshold=args.threshold, jobs=args.jobs,
                            keep_stills=False, render_timeout=3600, min_height=0.025, min_conf=75, strict=False,
                            scan=None, verbose=False)
    trep, ctx = tc.run_check(ns, os.path.abspath(video), key, scene, True)
    rep.metrics['text'] = {'script': trep.get('script'), 'cue_source': trep.get('cue_source'), 'bpm': trep.get('bpm'),
                           'cue_frames': trep['summary']['frames'], 'cue_pass': trep['summary']['pass'],
                           'report': trep.get('report_dir')}
    for n in trep.get('notes', []):
        if clip and 'the file is' in n:
            continue
        rep.add('text', 'INFO', n)
    # the lines this file must show: all of them, or in clip mode those whose hold midpoint is inside the window
    if clip:
        def inside(c):
            # starts inside the window (text_check grabs it) and its hold midpoint is on screen before the clip ends
            mid = (c['s'] + min(c['e'], c['s'] + 4)) / 2 * ctx.spb
            return c['s'] * ctx.spb >= clip['from'] - 1e-3 and mid < clip['to'] - 0.05
        required = sorted({c['text'] for c in ctx.cues if c['text'] and inside(c)})
        win_cues = [c for c in ctx.cues if c['text'] and inside(c)]
        rep.metrics['text']['clip_lines'] = required
        in_file = lambda r: (r['t'][0] if isinstance(r['t'], list) else r['t']) < dur - 0.02
        trep['frames'] = [r for r in trep['frames'] if in_file(r) and (not r.get('expected') or r['expected'] in required)]
    else:
        required = list(ctx.script_lines)
        win_cues = [c for c in ctx.cues if c['text']]
    ocr = tc.OCR(args.jobs, os.path.join(rep.dest, '.ocr_cache.json'))
    thr = args.threshold

    # ---- the scan: every step, every script line scored, every stray classed
    samples = []
    for t in sorted(scan):
        p = scan[t]
        reads = ocr.read(p)
        beat = (t - args.offset) / ctx.spb
        live = [c for c in ctx.cues if c['text'] and c['s'] <= beat < c['e']]
        exp = live[0]['text'] if live else None
        scores = {l: tc.score_frame(reads, l, 0.025)[0] for l in ctx.script_lines}
        near = [l for l, s in scores.items() if 55 <= s < thr]
        if near:        # something like a line is there: escalate to the dark/opened/closed masks
            reads = ocr.read(p, ((0.33, 1), (0.33, 2)))
            scores = {l: tc.score_frame(reads, l, 0.025)[0] for l in ctx.script_lines}
        st = tc.strays(ctx, reads, exp, 75, 0.025)
        shown = [l for l, s in scores.items() if s >= thr]
        # a line inside a longer shown line (COMMON inside COMMON WEALTH.) is not a separate appearance
        shown = [l for l in shown if not any(o != l and ' ' + tc.fold(l) + ' ' in ' ' + tc.fold(o) + ' ' for o in shown)]
        extra = [s for s in st if s['class'] == 'EXTRA']
        present = bool(shown) or any(s['class'] in ('LEFTOVER', 'FLAGGED', 'SCRIPT') for s in st) or \
            len(extra) >= 2 or any(len(s['text']) >= 5 and s.get('conf', 0) >= 88 for s in extra)
        samples.append({'t': t, 'frame': p, 'expected': exp, 'shown': shown, 'strays': st, 'present': present,
                        'scores': scores})
    ocr.save()

    # ---- 1a: stale / flagged lines anywhere (advisory) (cue frames and the scan)
    bad = {}
    for row in trep['frames']:
        for s in row.get('strays', []):
            if s['class'] in ('LEFTOVER', 'FLAGGED'):
                t0 = row['t'][0] if isinstance(row['t'], list) else row['t']
                bad.setdefault((s['class'], s.get('line') or s['text']), []).append((t0, None, s))
    for smp in samples:
        for s in smp['strays']:
            if s['class'] in ('LEFTOVER', 'FLAGGED'):
                bad.setdefault((s['class'], s.get('line') or s['text']), []).append((smp['t'], smp['frame'], s))
    for (cls, line), hits in sorted(bad.items(), key=lambda kv: kv[1][0][0]):
        ts = sorted({round(h[0], 2) for h in hits})
        fr = next((h[1] for h in hits if h[1]), None) or nearest(scan, ts[0])
        why = hits[0][2].get('why', '')
        label = 'stale line from an older cut' if cls == 'LEFTOVER' else 'flagged line'
        if cls == 'LEFTOVER' and drawn_as_picture(line, ctx):
            rep.add('text', 'INFO', f'"{line}" read at {fmt_ts(ts)} is also drawn by the scene as picture text: not counted')
            continue
        # one reading of a short line in one frame can be OCR noise; seen twice, or a long line, it is on screen
        sure = len(ts) >= 2 or len(tc.fold(line).replace(' ', '')) >= 10 or cls == 'FLAGGED'
        # advisory since 28 Sep: a stale line may be a deliberate restoration (put it back in the script), and a
        # flagged line is a note to look at, not a ban
        note = ' (if restored on purpose, put it back in the script)' if cls == 'LEFTOVER' else ''
        rep.add('text', 'WARN' if sure else 'HUMAN', f'{label} on screen: "{line}" ({why}) at {fmt_ts(ts)}{note}'
                f'{"" if sure else " (read once: check the frame)"}', t=ts[0], frame=fr)

    # ---- 1b: every script line should appear somewhere (a FAIL only for lines the script marks "verbatim": true)
    verbatim = {w.get('text') for w in ((ctx.script or {}).get('words') or [])
                if isinstance(w, dict) and w.get('verbatim') and w.get('text')}
    rep.metrics['text_verbatim_lines'] = sorted(verbatim)
    cue_ok = {}
    for row in trep['frames']:
        if row.get('expected'):
            cue_ok.setdefault(row['expected'], []).append(row)
    seen_scan = {l: [s['t'] for s in samples if l in s['shown']] for l in ctx.script_lines}
    for line in required:
        rows = cue_ok.get(line, [])
        # a cue frame that reads its line counts as shown even when it FAILed for other text on screen
        passed = [r for r in rows if (r.get('score') or 0) >= thr]
        failed = [r for r in rows if (r.get('score') or 0) < thr]
        if not passed and not seen_scan[line]:
            r0 = max(rows, key=lambda r: r.get('score') or 0) if rows else None
            fr = os.path.join(rep.dest, 'text', r0['frame']) if r0 and r0.get('frame') else None
            t0 = (r0['t'][0] if isinstance(r0['t'], list) else r0['t']) if r0 else None
            best = max([r.get('score') or 0 for r in rows] + [s['scores'].get(line, 0) for s in samples])
            # something close was read (a stencil or script face OCR half-reads): a person decides. Only a line the
            # script marks as a verbatim source quote FAILs when it is never read (fidelity to the source); anything
            # else is a WARN (a stale render, or type the OCR can't read)
            vb = line in verbatim
            st = 'HUMAN' if best >= 55 else ('FAIL' if vb else 'WARN')
            rep.add('text', st, f'{"verbatim " if vb else ""}script line {"read only partly" if st == "HUMAN" else "never on screen"}: "{line}" '
                    f'(best score {best:.0f}; cue at {fmt_ts([t0]) if t0 is not None else "?"}'
                    f'{", read " + repr(r0.get("read")) if r0 and r0.get("read") else ""})', t=t0, frame=fr)
        elif failed:
            for r in failed:
                t0 = r['t'][0] if isinstance(r['t'], list) else r['t']
                where = seen_scan[line] or [(x['t'][0] if isinstance(x['t'], list) else x['t']) for x in passed]
                rep.add('text', 'WARN', f'"{line}" missing at its cue {t0:.2f}s (b{r["beat"]:g}, read {r.get("read")!r}); '
                        f'shown at {fmt_ts(where)}', t=t0,
                        frame=os.path.join(rep.dest, 'text', r['frame']) if r.get('frame') else None)
    # cue frames that should be blank but show a script line off its beat
    for r in trep['frames']:
        if not r.get('expected') and r['status'] == 'FAIL':
            t0 = r['t'][0] if isinstance(r['t'], list) else r['t']
            lines = sorted({s.get('line') or s['text'] for s in r.get('strays', []) if s['class'] == 'SCRIPT' and s.get('line')})
            if lines:
                rep.add('text', 'WARN', f'script line in a planned silent gap at {t0:.2f}s: {", ".join(lines)}', t=t0,
                        frame=os.path.join(rep.dest, 'text', r['frame']) if r.get('frame') else None)

    if not [i for i in rep.items if i['check'] == 'text' and i['status'] in ('FAIL', 'WARN')]:
        rep.add('text', 'PASS', (f'all {len(required)} script lines cued inside the clip seen on screen' if clip else
                                 f'all {len(ctx.script_lines)} script lines seen on screen') + '; no stale or flagged line found')
    # ---- 1c: unknown words that stay on screen (text not in the script, not a known retired line)
    runs = word_runs(samples, lambda s: {x['text'].upper() for x in s['strays'] if x['class'] == 'EXTRA'})
    persistent = {w: r for w, r in runs.items() if max(b - a for a, b in r) >= 1}
    if persistent:
        # group words seen together into lines
        groups = {}
        for w, r in persistent.items():
            groups.setdefault(tuple(r[0]), []).append(w)
        for (a, b), ws in sorted(groups.items()):
            t0, t1 = samples[a]['t'], samples[b]['t']
            rep.add('text', 'FAIL' if args.strict else 'WARN',
                    f'unscripted text on screen {t0:.2f}-{t1:.2f}s: {" ".join(sorted(ws))}', t=t0, frame=samples[a]['frame'])

    return samples, ctx


def drawn_as_picture(line, ctx):
    """The retired line is (nearly) text the scene still draws as picture: SMALL FARMERS. vs a 'Small Farmer' signature."""
    ws = [w.rstrip('S') for w in tc.fold(line).split()]
    for pl in ctx.picture_lines:
        ps = [w.rstrip('S') for w in pl.split()]
        for i in range(len(ps) - len(ws) + 1):
            if all(tc.ratio(a, b) >= 0.85 for a, b in zip(ws, ps[i:i + len(ws)])):
                return True
    return False


def word_runs(samples, words_of):
    """{word: [(first sample idx, last sample idx), ...]} runs of consecutive samples showing the word."""
    runs = {}
    prev = set()
    for i, s in enumerate(samples):
        cur = words_of(s)
        for w in cur:
            if w in prev:
                runs[w][-1] = (runs[w][-1][0], i)
            else:
                runs.setdefault(w, []).append((i, i))
        prev = cur
    return runs


def nearest(scan, t):
    if not scan or t is None:
        return None
    k = min(scan, key=lambda x: abs(x - t))
    return scan[k]


def fmt_ts(ts):
    ts = [t for t in ts if t is not None]
    s = ', '.join(f'{t:.2f}s' for t in ts[:6])
    return s + (f' (+{len(ts) - 6})' if len(ts) > 6 else '')


# ================================================================ 2: audio
def audio_checks(rep, video, dur, clip=None):
    main = ebur128(video)
    mono = ebur128(video, 'pan=mono|c0=0.5*c0+0.5*c1')
    a = decode_audio(video)
    m = {'integrated_lufs': main['I'], 'true_peak_dbtp': main['TP']}
    if a is None or main['I'] is None:
        rep.add('audio', 'FAIL', 'no audio stream / could not measure loudness', breaks=True)
        return
    peak = float(np.abs(a).max())
    m['sample_peak_dbfs'] = round(20 * math.log10(max(peak, 1e-9)), 2)
    m['clipped_samples'] = int((np.abs(a) >= 0.999).sum())
    I, TP = main['I'], main['TP']
    rep.add('audio', 'FAIL' if TP is not None and TP > -1.0 else 'PASS', f'true peak {TP:+.1f} dBTP (platforms ask for -1.0 or lower; master_audio.py fixes it)')
    if peak > 1.012 or m['clipped_samples'] >= 50:
        rep.add('audio', 'FAIL', f'clips: sample peak {m["sample_peak_dbfs"]:+.1f} dBFS, {m["clipped_samples"]} samples at full scale')
    # Loudness is a fact, reported with what the platforms do to it; it is not a target and judges nothing (8 Oct).
    rep.add('audio', 'INFO', f'integrated {I:.1f} LUFS (YouTube and Spotify turn a louder piece down to about -14 LUFS: '
            f'{min(0.0, -14.0 - I):+.1f} dB here)')
    # breakage only: runs of digital silence inside the piece (engine/finish.py holes()); whether a silence is meant is
    # the builder's call, so this is a note, not a verdict
    try:
        from engine import finish as _fin
        hs = _fin.holes(a, 48000)
    except Exception:  # noqa: BLE001
        hs = []
    if hs:
        m['holes'] = hs
        rep.add('audio', 'INFO', 'digital silence inside the piece (check it is meant): ' +
                ', '.join(f'{a_:.2f}-{b_:.2f}s' for a_, b_ in hs[:6]))
    # mono fold-down: phase-wide stereo cancels on one speaker (a technical fault)
    mono_loss = I - mono['I'] - 3.01 if mono['I'] is not None else None
    m['mono_loss_db'] = round(mono_loss, 1) if mono_loss is not None else None
    if mono_loss is not None and mono_loss > 2:
        rep.add('audio', 'WARN', f'mono fold-down loses {mono_loss:.1f} dB (phase-wide stereo cancels on one speaker)')
    share_stream_check(rep, video, m)
    rep.metrics['audio'] = m


def _audio_md5(path):
    """MD5 of the first audio stream's packets as muxed (-c copy: the encoded bytes, no decode)."""
    try:
        r = subprocess.run([FFMPEG, '-nostdin', '-v', 'error', '-i', path, '-map', '0:a:0', '-c', 'copy', '-f', 'md5', '-'],
                           capture_output=True, text=True, timeout=120)
        return r.stdout.strip().split('=')[-1] if r.returncode == 0 and r.stdout.strip() else None
    except Exception:  # noqa: BLE001
        return None


def share_stream_check(rep, video, m):
    """MUSIC c4 (and the c1 judge's open ask): a _share copy must carry its master's audio stream byte for byte
    (-c:a copy), so the published audio is the one codec-true encode that was measured. Finds the master next to the
    share (<name>.mp4 for <name>_share.mp4); WARN when the packets differ (a second audio generation), INFO when no
    master is found. Technical, advisory."""
    base = os.path.basename(video)
    if '_share' not in base:
        return
    cand = [os.path.join(os.path.dirname(video), base.replace('_share', '')),
            os.path.join(os.path.dirname(os.path.dirname(video)), base.replace('_share', ''))]
    master = next((c for c in cand if os.path.exists(c) and os.path.abspath(c) != os.path.abspath(video)), None)
    if not master:
        rep.add('audio', 'INFO', f'share audio: no master found next to {base} to compare the stream with')
        return
    hs, hm = _audio_md5(video), _audio_md5(master)
    m['share_audio_md5'], m['master_audio_md5'] = hs, hm
    if hs and hm:
        rep.add('audio', 'PASS' if hs == hm else 'WARN',
                'share audio is the master\'s stream, byte for byte (one encode)' if hs == hm else
                f'share audio differs from {os.path.basename(master)}: a second audio generation (mux with -c:a copy; '
                f'engine/codec.py)')


def band_check(rep, scan, clip=None, every=1.0, min_h=40, min_conf=70):
    """TYPE c2: a backstop band check on the SHIPPED picture. tesseract (psm 11) on ~1 fps full-size scan frames; any
    word box at least `min_h` px tall outside x 60-960 / y 270-1250 is a WARN with its time. It misses stylised type
    (the scene-side typeAudit stays primary) and is slow on this machine, so it only runs when asked (--only band)."""
    try:
        import text_check
        from PIL import Image
    except Exception as e:  # noqa: BLE001
        rep.add('band', 'INFO', f'band check could not run: {e}')
        return
    if not shutil.which('tesseract'):
        rep.add('band', 'INFO', 'band check: tesseract is not installed')
        return
    last, out, n = -1e9, [], 0
    for t in sorted(scan):
        if t - last < every - 1e-6:
            continue
        last = t; n += 1
        im = Image.open(scan[t]).convert('L')
        k = 2 if im.width >= 1080 else 1
        small_im = im.resize((im.width // k, im.height // k))
        for w in text_check.tesseract(small_im):
            bx, by, bw, bh = [v * k for v in w['box']]
            if w['conf'] < min_conf or bh < min_h or len(re.sub('[^A-Za-z0-9]', '', w['text'])) < 2:
                continue
            if bx < BAND[0] - 2 or by < BAND[1] - 2 or bx + bw > BAND[2] + 2 or by + bh > BAND[3] + 2:
                out.append({'t': t, 'text': w['text'], 'box': [bx, by, bw, bh]})
    rep.metrics['band'] = {'frames': n, 'out': out}
    for o in out[:12]:
        bx, by, bw, bh = o['box']
        rep.add('band', 'WARN', f'"{o["text"]}" at x {bx}-{bx + bw}, y {by}-{by + bh}: outside the safe band', t=o['t'], frame=scan.get(o['t']))
    if not out:
        rep.add('band', 'PASS', f'{n} frames read at ~{1 / every:g} fps: no word of {min_h} px or more outside the band (OCR backstop; stylised type can escape it)')


# ================================================================ 4: black and blank frames (breakage)
def frame_class(fr):
    y = fr.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    mean, sd, p99 = float(y.mean()), float(y.std()), float(np.percentile(y, 99.5))
    if mean < 20 and p99 < 45:
        return 'black', mean, sd
    if sd < 5:
        return 'blank', mean, sd
    return None, mean, sd


def frame_checks(rep, video, dur, fps, ts, arr, scan, clip=None, scene=None, key=None):
    head = not clip or clip['from'] <= 0.05          # the window holds the piece's first frame
    tail = not clip or clip['to'] >= clip['piece_dur'] - 0.05
    if dur and not clip:
        rep.add('frames', 'INFO', f'runtime {dur:.1f}s (a piece is as long as it needs)')
    cls = [frame_class(f) for f in arr]
    c0, mean0, sd0 = cls[0]
    if not head:
        pass
    elif c0:
        rep.add('frames', 'HUMAN', f'frame 0 (the thumbnail) is {c0}: deliberate? look at it', t=0.0,
                frame=nearest(scan, 0.0))
    else:
        rep.add('frames', 'PASS', 'frame 0 has picture')
    last1 = [(t, c) for t, c in zip(ts, cls) if t >= dur - 1.0]
    badtail = [(t, c[0]) for t, c in last1 if c[0]]
    if not tail:
        pass
    elif badtail:
        kinds = Counter(k for _, k in badtail)
        rep.add('frames', 'FAIL', f'the last second is {"/".join(kinds)} in {len(badtail)}/{len(last1)} sampled frames '
                f'(from {badtail[0][0]:.2f}s): the piece ends on an empty card', t=badtail[0][0], frame=nearest(scan, badtail[0][0]))
    else:
        rep.add('frames', 'PASS', 'the last second has picture')
    # black / blank runs before the last second
    runs, cur = [], None
    step = (ts[1] - ts[0]) if len(ts) > 1 else 1 / fps
    for t, c in zip(ts, cls):
        if t >= dur - 1.0 and tail:
            break
        if c[0] in ('black', 'blank') and t > 0:
            cur = [t, t, c[0]] if cur is None else [cur[0], t, cur[2]]
        elif cur:
            runs.append(cur)
            cur = None
    if cur:
        runs.append(cur)
    for a, b, k in runs:
        ln = b - a + step
        if ln < 0.15:
            continue
        # a black run that runs into the final second is a dead tail
        tail_run = tail and b >= dur - 1.0 - 2 * step
        st = 'FAIL' if tail_run else 'WARN'   # black mid-piece can be a weapon; a dead tail is a broken ending
        rep.add('frames', st, f'{k} run {a:.2f}-{b + step:.2f}s ({ln:.1f}s){" into the tail" if tail_run else " mid-piece"}',
                t=a, frame=nearest(scan, a + ln / 2))
    # loop seam: no measurement (8 Oct). For a piece meant to loop, watch the seam play through twice; the report names
    # the frame-0 render to watch it against when this file has no frame 0 of its own.
    if tail and not head and scene:
        hp = piece_bounds.head_reference(scene, exclude=[video])
        rep.add('frames', 'INFO', ('loop seam: watch the end play into frame 0 twice; frame 0 is in ' + os.path.relpath(hp, VIDEOS)) if hp
                else f'loop seam: no render of frame 0 newer than the scene code (node web/render.mjs {scene} --stills 0 makes one)')
    elif tail:
        rep.add('frames', 'INFO', 'loop seam: if the piece loops, watch the end play into frame 0 twice')

def hook_check(rep, scene, key, scan, clip=None, threshold=80, jobs=4):
    """TOOLING c4, a fact check: when the script declares its frame-0 line ('hook_frame0': true, or a 'hook' note
    starting 'Frame 0'), OCR frame 0 (full size, the text_check masks, escalating) and report whether that line is on it.
    HUMAN when it is only partly read (stylised flap and stencil faces misread C/G). Scripts that declare nothing get
    nothing: whether a piece opens on a line or on a picture is the builder's call."""
    if clip and clip['from'] > 0.05:
        return
    hk = piece_bounds.hook_line(key) if key else None
    if not hk or not hk.get('strict'):
        return
    p = nearest(scan, 0.0)
    if not p or min(scan) > 0.05:
        rep.add('hook', 'INFO', 'frame 0 was not scanned')
        return
    ocr = tc.OCR(jobs, os.path.join(rep.dest, '.hook_ocr.json'))
    passes, sc, got = [], 0, ''
    for ps in ((0.33, 1), (0.33, 2), (0.5, 1), (0.5, 2)):
        passes.append(ps)
        sc, got, _ = tc.score_frame(ocr.read(p, passes), hk['text'])
        if sc >= threshold:
            break
    ocr.save()
    rep.metrics['hook'] = {'text': hk['text'], 'read': got}
    if sc >= threshold:
        rep.add('hook', 'PASS', f'frame 0 carries the declared line {hk["text"]!r}')
    elif sc >= 50:
        rep.add('hook', 'HUMAN', f'frame 0 shows the declared line {hk["text"]!r} only in part (read {got!r}); '
                'check the thumbnail by eye', t=0.0, frame=p)
    else:
        rep.add('hook', 'WARN', f'the script declares {hk["text"]!r} on frame 0, and frame 0 does not show it (read {got!r})',
                t=0.0, frame=p)


def small(fr, w=54, h=96):
    return np.asarray(Image.fromarray(fr).resize((w, h), Image.BILINEAR)).astype(np.float32)


# ================================================================ 5: brand
def _hsv(a):
    return tc._hsv(a.astype(np.float32))


def brand_masks(img):
    """Binary views where a mark or lockup would be drawn: vivid red, near-white, and ink on a light ground."""
    a = img.astype(np.float32)
    h, s, v = _hsv(a)
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    red = (s > 0.45) & (v > 0.35) & ((h < 22) | (h > 338))
    light = (lum > 190) & (s < 0.4)
    out = {'red': red, 'light': light}
    if np.median(lum) > 150:
        out['ink'] = lum < 70
    return out


def ground_mask(img):
    """Pixels unlike the frame border's median colour (a closer's flat ground), or None when the border is busy."""
    a = img.astype(np.float32)
    b = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3), a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
    med = np.median(b, 0)
    if np.abs(b - med).sum(1).mean() > 30:
        return None, med
    return np.abs(a - med).sum(2) > 70, med


class Lockup:
    """☭≡/acc lockup (acc_lockup.png alpha) template, NCC over scales on 270-wide frames."""

    def __init__(self):
        a = np.asarray(Image.open(os.path.join(ASSETS, 'acc_lockup.png')).convert('RGBA'))[..., 3]
        ys, xs = np.where(a > 128)
        self.alpha = Image.fromarray(a[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
        self.aspect = self.alpha.height / self.alpha.width
        self.tmpl = {}
        for wt in np.geomspace(50, 262, 16):
            wt = int(round(wt))
            ht = max(6, int(round(wt * self.aspect)))
            t = np.asarray(self.alpha.resize((wt, ht), Image.BILINEAR)).astype(np.float32) / 255
            t = t - t.mean()
            self.tmpl[wt] = (t, float(np.sqrt((t ** 2).sum())))

    def match(self, mask):
        m = mask.astype(np.float32)
        best = (0.0, None)
        c1 = np.pad(m, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        c2 = np.pad(m * m, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        for wt, (t, tn) in self.tmpl.items():
            ht, wt_ = t.shape
            if ht >= m.shape[0] or wt_ >= m.shape[1]:
                continue
            num = signal.fftconvolve(m, t[::-1, ::-1], mode='valid')
            s1 = c1[ht:, wt_:] - c1[:-ht, wt_:] - c1[ht:, :-wt_] + c1[:-ht, :-wt_]
            s2 = c2[ht:, wt_:] - c2[:-ht, wt_:] - c2[ht:, :-wt_] + c2[:-ht, :-wt_]
            var = np.maximum(s2 - s1 * s1 / (ht * wt_), 1e-6)
            ncc = num / (tn * np.sqrt(var))
            ncc[var < 0.02 * ht * wt_] = 0            # a flat window cannot hold the lockup
            k = int(np.argmax(ncc))
            y, x = divmod(k, ncc.shape[1])
            if ncc[y, x] > best[0]:
                best = (float(ncc[y, x]), (x, y, wt_, ht))
        return best

    def find(self, img270):
        ms = brand_masks(img270)
        cands = {'light': ms['light']}
        if ms['red'].mean() < 0.3:          # a red ground is not a glyph
            cands.update({'red': ms['red'], 'light|red': ms['light'] | ms['red']})
        g, med = ground_mask(img270)
        if g is not None:
            cands['ground'] = g
        best = (0.0, None, None)
        for k, m in cands.items():
            if m.mean() < 0.002:
                continue
            sc, box = self.match(m)
            if sc > best[0]:
                best = (sc, box, k)
        return best


def stripe_template(n, pitch_px, thick=0.5):
    """n bars at the logo's geometry (right edges aligned, the logo's lengths; thickness = gap = pitch/2 in the logo,
    or the thickness the chain was measured at, for line-drawn and glowing marks)."""
    lengths = [160, 132, 137, 142][:n] if n <= 4 else [150] * n
    t = pitch_px * min(max(thick, 0.08), 0.7)
    sc = pitch_px / 46.7
    W = int(round(max(lengths) * sc)) + 2
    H = int(round(pitch_px * (n - 1) + t)) + 2
    im = np.zeros((H, W), np.float32)
    for i, L in enumerate(lengths):
        y0 = int(round(i * pitch_px))
        im[y0:y0 + max(1, int(round(t))), W - int(round(L * sc)):W] = 1
    return im


def ncc_same(a, b):
    a = a - a.mean()
    b = b - b.mean()
    d = math.sqrt(float((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / d) if d > 0 else 0.0


def stripe_chains(mask, W, H):
    """Stacked horizontal bars at a regular pitch with right edges aligned -> list of chain dicts.
    A bar survives a horizontal opening (straight, or sloped up to ~1/6 for hand-drawn or wavy stripes), is at least
    3.5x longer than thick (thickness = median column height, so glow nodes and waves do not count) and continuous."""
    L = max(8, int(0.022 * W))
    op = ndimage.binary_opening(mask, structure=np.ones((1, L), bool))
    for sl in (1, -1):         # gently sloped runs (wavy, hand-drawn stripes)
        se = np.zeros((3, L), bool)
        se[1 - sl, :L // 3] = se[1, L // 3:2 * L // 3] = se[1 + sl, 2 * L // 3:] = True
        op |= ndimage.binary_opening(mask, structure=se)
    lab, n = ndimage.label(op)
    if not n:
        return [], op
    bars = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        w = x1 - x0
        if w < 0.03 * W or (y1 - y0) > 0.06 * H:
            continue
        cols = (lab[sl] == i + 1)
        colh = cols.sum(0)
        if (colh > 0).mean() < 0.85:
            continue
        t = float(np.median(colh[colh > 0]))
        if w < 3.5 * t:
            continue
        cy = y0 + float((cols * np.arange(y1 - y0)[:, None]).sum() / max(cols.sum(), 1))
        bars.append({'x0': x0, 'x1': x1, 'y0': y0, 'y1': y1, 'h': t, 'w': w, 'cy': cy, 'id': i + 1})
    op = np.isin(lab, [b['id'] for b in bars])          # the bars only (an opening keeps any wide blob too)
    bars.sort(key=lambda b: b['cy'])
    chains = []
    used = set()
    for i, b in enumerate(bars):
        if i in used:
            continue
        ch = [i]
        dy0 = None
        while True:
            last = bars[ch[-1]]
            best = None
            for j in range(ch[-1] + 1, len(bars)):
                c = bars[j]
                dy = c['cy'] - last['cy']
                mw = max(c['w'], last['w'])
                if dy < 1.3 * max(c['h'], last['h']) or dy > 0.6 * mw:
                    continue
                if abs(c['x1'] - last['x1']) > 0.12 * mw + 2:
                    continue
                if min(c['x1'], last['x1']) - max(c['x0'], last['x0']) < 0.5 * min(c['w'], last['w']):
                    continue
                if max(c['h'], last['h']) > 2.2 * min(c['h'], last['h']) + 1:
                    continue
                if dy0 is not None and not (0.75 * dy0 <= dy <= 1.33 * dy0):
                    continue
                best = j
                break
            if best is None:
                break
            if dy0 is None:
                dy0 = bars[best]['cy'] - last['cy']
            ch.append(best)
        if len(ch) < 3:
            continue
        used.update(ch)
        bs = [bars[k] for k in ch]
        pitch0 = bs[1]['cy'] - bs[0]['cy']

        def gap(a_, b_):
            ya, yb = int(a_['y1']), int(b_['y0'])
            q = max(1, (yb - ya) // 4)
            band = mask[ya + q:yb - q, max(a_['x0'], b_['x0']):min(a_['x1'], b_['x1'])]
            return float(band.any(0).mean()) if band.size else 0.0

        def dirty(bb, below):
            p = max(2, int(0.25 * pitch0))
            ya, yb = (bb['y1'] + 1, bb['y1'] + 1 + p) if below else (max(0, bb['y0'] - 1 - p), bb['y0'] - 1)
            band = mask[ya:yb, bb['x0']:bb['x1']]
            return band.size > 0 and band.any(0).mean() > 0.3
        # what lies between consecutive bars: a clean gap, or fill (an outlined stripe drawn as its two edges)
        gaps = [gap(a_, b_) for a_, b_ in zip(bs, bs[1:])]
        outlined = len(bs) % 2 == 0 and len(bs) >= 4 and all(g < 0.15 for g in gaps[1::2]) and \
            float(np.mean(gaps[0::2])) > 0.3
        if outlined:
            bs = [dict(x, y1=y['y1'], cy=(x['cy'] + y['cy']) / 2, h=y['y1'] - x['y0']) for x, y in zip(bs[0::2], bs[1::2])]
            gaps = gaps[1::2]
        else:
            # the gap between two stripes is clean. A bar with letter strokes beyond it (the A C P tops and
            # bottoms), or across a dirty gap from the rest, is type: trim it from the ends of the chain
            # (only on a clean ground: where every gap carries texture, glow dots or particles, nothing is trimmed)
            while len(bs) >= 3 and max(gaps[:-1]) < 0.15 and (gaps[-1] > 0.3 or dirty(bs[-1], True)):
                bs, gaps = bs[:-1], gaps[:-1]
            while len(bs) >= 3 and max(gaps[1:]) < 0.15 and (gaps[0] > 0.3 or dirty(bs[0], False)):
                bs, gaps = bs[1:], gaps[1:]
        if len(bs) >= 3:
            dys = np.diff([x['cy'] for x in bs])
            pitch = float(np.mean(dys))
            mlen = float(np.mean([x['w'] for x in bs]))
            if mlen < 2.2 * pitch:
                continue       # letters (E, ≡-like strokes of type) are short for their pitch; the stripes are long
            # other bars around the chain: hatching, engraving, blinds, a page of rules. A mark stands on its own
            cx0, cx1 = min(x['x0'] for x in bs), max(x['x1'] for x in bs)
            cy0, cy1 = min(x['y0'] for x in bs), max(x['y1'] for x in bs)
            hh = cy1 - cy0
            ids = {x['id'] for x in bs}
            wmin = min(x['w'] for x in bs)
            crowd = sum(1 for x in bars if x['id'] not in ids and x['w'] >= 0.6 * wmin
                        and cx0 - hh <= (x['x0'] + x['x1']) / 2 <= cx1 + hh and cy0 - hh <= x['cy'] <= cy1 + hh)
            chains.append({'n': len(bs), 'bars': bs, 'crowd': crowd, 'x0': min(x['x0'] for x in bs), 'x1': max(x['x1'] for x in bs),
                           'y0': min(x['y0'] for x in bs), 'y1': max(x['y1'] for x in bs), 'pitch': pitch,
                           'pitch_cv': float(np.std(dys) / pitch), 'len_pitch': mlen / pitch,
                           'thick_pitch': float(np.mean([x['h'] for x in bs])) / pitch, 'outlined': outlined,
                           'clean_gaps': all(g < 0.15 for g in gaps), 'gaps': [round(g, 2) for g in gaps],
                           'left_aligned': (max(x['x0'] for x in bs) - min(x['x0'] for x in bs)) < 0.08 * max(x['w'] for x in bs)})
    return chains, op


def pool(m, k):
    if k <= 1:
        return m
    h, w = (m.shape[0] // k) * k, (m.shape[1] // k) * k
    return m[:h, :w].reshape(h // k, k, w // k, k).any(axis=(1, 3))


_GEAR = None


def gear_score(mask, box):
    """NCC of the blob against the gear, hammer and sickle of acp_logo.png (its red layer left of the stripes)."""
    global _GEAR
    if _GEAR is None:
        a = np.asarray(Image.open(os.path.join(ASSETS, 'acp_logo.png')).convert('RGBA')).astype(int)
        red = (a[..., 3] > 128) & (a[..., 0] > 150) & (a[..., 1] < 80)
        _GEAR = Image.fromarray((red[60:232, 36:218] * 255).astype(np.uint8))
    x, y, w, h = [int(round(v)) for v in box]
    crop = mask[max(0, y):y + h, max(0, x):x + w].astype(np.float32)
    if crop.size < 16:
        return 0.0
    blur = lambda im: ndimage.uniform_filter(im, max(1, int(min(im.shape) / 12)))
    t = np.asarray(_GEAR.resize((crop.shape[1], crop.shape[0]), Image.BILINEAR)).astype(np.float32) / 255
    return ncc_same(blur(crop), blur(t))


def gear_beside(mask, op, ch):
    """The gear, hammer and sickle: the largest compact blob about the chain's height that sits left of the bars
    (the logo) or above their left half (a stacked variant). Returns its box or None."""
    H = max(ch['y1'] - ch['y0'], ch['pitch'] * ch['n'])
    pad = int(1.5 * H) + 4
    y0, y1 = max(0, ch['y0'] - pad), min(mask.shape[0], ch['y1'] + int(0.3 * H))
    x0, x1 = max(0, ch['x0'] - pad), min(mask.shape[1], ch['x1'])
    bars = op[y0:y1, x0:x1].copy()
    for bb in ch['bars']:        # the stripes' whole boxes (an outlined stripe's fill too)
        bars[max(0, int(bb['y0']) - y0):max(0, int(bb['y1']) - y0), max(0, int(bb['x0']) - x0):max(0, int(bb['x1']) - x0)] = True
    sub = mask[y0:y1, x0:x1] & ~ndimage.binary_dilation(bars, iterations=2)
    it = max(2, int(ch['pitch'] * 0.25))
    lab, n = ndimage.label(ndimage.binary_closing(sub, iterations=it))
    best, bsz = None, 0
    cw = ch['x1'] - ch['x0']
    for i, sl in enumerate(ndimage.find_objects(lab)):
        by0, by1, bx0, bx1 = y0 + sl[0].start, y0 + sl[0].stop, x0 + sl[1].start, x0 + sl[1].stop
        bh, bw = by1 - by0, bx1 - bx0
        if not (0.6 * H <= bh <= 1.9 * H) or not (0.55 <= bh / max(bw, 1) <= 1.8):
            continue
        area = int((lab[sl] == i + 1).sum())
        if area < 0.2 * bh * bw:
            continue
        cx = (bx0 + bx1) / 2
        left = cx < ch['x0'] + 0.25 * cw and bx1 > ch['x0'] - 0.5 * H and min(by1, ch['y1']) - max(by0, ch['y0']) > 0.4 * min(bh, H)
        above = ch['x0'] - 0.3 * H < cx < ch['x0'] + 0.6 * cw and 0 <= ch['y0'] - by1 + 0.2 * H < 0.9 * H
        if (left or above) and area > bsz:
            best, bsz = (bx0, by0, bw, bh), area
    return best


def slash_right(mask, ch):
    """A '/' just right of the bars: the ≡ of the ☭≡/acc lockup, not a mark."""
    H = ch['y1'] - ch['y0']
    x0, x1 = ch['x1'], min(mask.shape[1], ch['x1'] + int(1.0 * H) + 4)
    y0, y1 = max(0, ch['y0'] - int(0.6 * H)), min(mask.shape[0], ch['y1'] + int(0.6 * H))
    if x1 - x0 < 3:
        return False
    lab, n = ndimage.label(mask[y0:y1, x0:x1])
    for i, sl in enumerate(ndimage.find_objects(lab)):
        bh, bw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if 0.9 * H <= bh <= 2.2 * H and 1.2 <= bh / max(bw, 1) <= 5:
            return True
    return False


_LOCKUP = None


def analyse_brand_frame(path):
    """One scan frame: the lockup match (270-wide) and every stripe chain (full size), classified. Picklable."""
    global _LOCKUP
    _LOCKUP = _LOCKUP or Lockup()
    im = Image.open(path).convert('RGB')
    full = np.asarray(im)
    Hf, Wf = full.shape[:2]
    i270 = np.asarray(im.resize((270, 480), Image.BILINEAR))
    cls = frame_class(i270)[0]
    sc, box, via = _LOCKUP.find(i270) if cls not in ('black', 'blank') else (0.0, None, None)
    lbox = [v * Wf / 270 for v in box] if box else None
    found = []
    for mk, m in brand_masks(full).items():
        if m.mean() < 0.0003 or m.mean() > 0.6:
            continue
        chains, op = stripe_chains(m, Wf, Hf)
        for ch in chains:
            if ch['n'] > 4 or ch['crowd'] > 3:
                continue       # book lines, blinds, flags, engraving: the mark has four, on its own
            gear = gear_beside(m, op, ch)
            gs = round(gear_score(m, gear), 2) if gear else None
            if gear and gs < 0.18:
                gear = None        # a blob, but not shaped like the gear, hammer and sickle (engraving, texture)
            if lbox and sc >= 0.5:
                bx, by, bw, bh = lbox
                if bx - 8 <= ch['x0'] and ch['x1'] <= bx + bw + 8 and by - 8 <= ch['y0'] and ch['y1'] <= by + bh + 8:
                    continue       # the ≡ of ☭≡/acc
            if ch['n'] == 3 and ch['left_aligned'] and slash_right(m, ch):
                continue           # the ≡ of ☭≡/acc (its / follows)
            if not gear and (ch['n'] == 4 or ch['thick_pitch'] < 0.3 or not ch['clean_gaps'] or ch['crowd'] > 0
                             or (ch['x1'] - ch['x0']) > 0.5 * Wf):
                continue           # no gear: only solid, logo-like bars are worth a human look
            # template: the logo's stripe band (acp_logo.png geometry) with 3 and with 4 stripes at this pitch
            pad = int(ch['pitch'] * 0.3) + 2
            y0, y1 = int(max(0, ch['y0'] - pad)), int(min(Hf, ch['y1'] + pad))
            x0, x1 = int(max(0, ch['x0'] - pad)), int(min(Wf, ch['x1'] + pad))
            crop = m[y0:y1, x0:x1].astype(np.float32)
            scores = {}
            for k in (3, 4):
                tpl = stripe_template(k, max(ch['pitch'], 2), ch['thick_pitch'])
                tpl = np.asarray(Image.fromarray((tpl * 255).astype(np.uint8)).resize(
                    (crop.shape[1], crop.shape[0]), Image.BILINEAR)).astype(np.float32) / 255
                scores[k] = round(ncc_same(crop, tpl), 2)
            regular = ch['pitch_cv'] < 0.15
            other = 4 if ch['n'] == 3 else 3
            conf = 'high' if gear and gs >= 0.3 and regular and (scores[ch['n']] >= 0.4 and scores[ch['n']] >= scores[other]
                                                   or scores[ch['n']] >= scores[other] + 0.15) else 'low'
            found.append({'mask': mk, 'n': ch['n'], 'gear': bool(gear), 'gear_match': gs, 'regular': regular, 'match': scores,
                          'conf': conf, 'box': [x0, y0, x1 - x0, y1 - y0], 'gearbox': list(gear) if gear else None})
    uniq = []            # the same chain read in two masks counts once (keep the confident reading)
    for f in sorted(found, key=lambda f: (f['conf'] != 'high', -f['n'])):
        if not any(iou(f['box'], u['box']) > 0.3 for u in uniq):
            uniq.append(f)
    return {'frame': path, 'lockup': (sc, lbox, via), 'marks': uniq}


def acp_text_in(tail):
    """The closer's look may vary (28 Sep): OCR the tail frames for the ACP sign-off. Returns (t, text, frame) or None."""
    for p in reversed(tail):
        try:
            im = Image.open(p['frame']).convert('L')
            im = im.resize((im.width // 2, im.height // 2))
            for w in tc.tesseract(im):
                t = re.sub('[^A-Z.]', '', w['text'].upper())
                if w['conf'] >= 60 and t.startswith('ACP'):
                    return (p['t'], w['text'], p['frame'])
        except Exception:  # noqa: BLE001
            continue
    return None


def brand_checks(rep, video, dur, fps, wh, scan, ts, arr, jobs=4, last_s=3.5, clip=None):
    W0, H0 = wh
    lk = Lockup()
    from concurrent.futures import ProcessPoolExecutor
    tl = sorted(scan)
    with ProcessPoolExecutor(max(1, jobs)) as ex:
        res = list(ex.map(analyse_brand_frame, [scan[t] for t in tl]))
    per = [dict(r, t=t) for t, r in zip(tl, res)]

    # ---- lockup at the end, inside the frame
    tail = [p for p in per if p['t'] >= dur - last_s]
    hit = [p for p in tail if p['lockup'][0] >= 0.5]
    rep.metrics['brand'] = {'lockup_best_tail': round(max((p['lockup'][0] for p in tail), default=0), 2)}
    if clip and clip['to'] < clip['piece_dur'] - 0.05:
        rep.add('brand', 'INFO', 'clip mode: the window stops before the closer, so the lockup is not checked')
    elif not hit:
        weak = max(tail, key=lambda p: p['lockup'][0]) if tail else None
        if weak and weak['lockup'][0] >= 0.35:
            rep.add('brand', 'HUMAN', f'☭≡/acc lockup not clearly found in the last {last_s:g}s (best match '
                    f'{weak["lockup"][0]:.2f} at {weak["t"]:.2f}s): restyled, cropped or covered?', t=weak['t'], frame=weak['frame'],
                    crop=weak['lockup'][1])
        else:
            # the closer's look may vary: before failing, look for the ACP sign-off as text in the tail frames
            found = acp_text_in(tail)
            if found:
                rep.add('brand', 'HUMAN', f'☭≡/acc lockup not matched by template, but "{found[1]}" reads at {found[0]:.2f}s: '
                        'a restyled closer? check it signs off with the mark and ACP.US', t=found[0], frame=found[2])
            else:
                # CLOSER c1 (1 Oct): a piece may hold the mark back or sign off in its own world, so this asks a person
                rep.add('brand', 'HUMAN', f'no ☭≡/acc closer found in the last {last_s:g}s (no lockup match and no ACP text): '
                        'held back or signed off in-world on purpose? look at the last frames',
                        t=tail[-1]['t'] if tail else None, frame=tail[-1]['frame'] if tail else None)
    else:
        p = max(hit, key=lambda p: p['lockup'][0])
        x, y, w, h = p['lockup'][1]
        mx = min(x, W0 - (x + w)) / W0
        my = min(y, H0 - (y + h)) / H0
        first = min(q['t'] for q in hit)
        rep.add('brand', 'PASS', f'☭≡/acc lockup at the end ({first:.2f}s on)', t=p['t'])
        if x <= 1 or y <= 1 or x + w >= W0 - 1 or y + h >= H0 - 1:
            rep.add('brand', 'WARN', 'the frame edge crops the lockup', t=p['t'], frame=p['frame'], crop=p['lockup'][1])
        # its ground is direction, not a reading (8 Oct): the mark reads red on white by default, and a piece's own
        # material behind it can be better still; look at the last frames

    # ---- ACP marks: four stripes
    groups = []
    for p in per:
        for f in p['marks']:
            g = next((g for g in groups if g['n'] == f['n'] and iou(g['box'], f['box']) > 0.2 and p['t'] - g['t1'] <= 1.01), None)
            if g:
                g['t1'] = p['t']
                g['count'] += 1
                if f['conf'] == 'high' and g['conf'] != 'high':
                    g.update({'conf': 'high', 'frame': p['frame'], 'box': f['box'], 'match': f['match'], 'gear': f['gear']})
            else:
                groups.append(dict(f, t0=p['t'], t1=p['t'], count=1, frame=p['frame']))
    four = [g for g in groups if g['n'] == 4 and g['gear']]
    unsure = []
    for g in groups:
        where = f"{g['t0']:.2f}-{g['t1'] + args_step(per):.2f}s"
        desc = (f"{g['n']} stripes, band match 3:{g['match'].get(3)} 4:{g['match'].get(4)}, " +
                (f"gear beside (match {g.get('gear_match')})" if g['gear'] else 'no gear found'))
        if g['n'] == 4 and g['gear']:
            continue
        if g['n'] == 3 and g['conf'] == 'high':
            rep.add('brand', 'HUMAN', f'ACP mark with three stripes at {where} ({desc}; the mark has four; the ☭≡/acc wordmark\'s ≡ is '
                    f'three bars by design, so look at the frame)', t=g['t0'],
                    frame=g['frame'], crop=grow(g['box'], g.get('gearbox')))
        elif g['n'] == 3 or g['gear']:
            unsure.append((g, where, desc))
    # low-confidence sightings: each one for a human, or, when there are many (a textured world), one summary
    for g, where, desc in (unsure if len(unsure) <= 5 else []):
        rep.add('brand', 'HUMAN', f'possible ACP mark, stripe count unsure at {where} ({desc})', t=g['t0'],
                frame=g['frame'], crop=grow(g['box'], g.get('gearbox')))
    if len(unsure) > 5:
        g = max(unsure, key=lambda u: (u[0]['gear'], u[0]['count']))[0]
        rep.add('brand', 'HUMAN', f'{len(unsure)} low-confidence stripe groups (3 bars, mostly no gear) at '
                f'{fmt_ts(sorted({u[0]["t0"] for u in unsure}))}: textured picture, or marks to check by eye',
                t=g['t0'], frame=g['frame'], crop=grow(g['box'], g.get('gearbox')))
    rep.metrics['brand']['four_stripe_marks'] = [f"{g['t0']:.2f}-{g['t1']:.2f}s" for g in four]
    if not [i for i in rep.items if i['check'] == 'brand' and 'stripe' in i['msg']]:
        rep.add('brand', 'PASS', 'every stripe chain found beside a gear has four stripes' +
                (f' ({len(four)} sighting(s))' if four else ' (no mark found in the scan)'))

    # ---- corner logo bugs: a static, edged patch in a corner while the picture moves
    corner_bug(rep, ts, arr, dur, scan, wh)


def args_step(per):
    return (per[1]['t'] - per[0]['t']) if len(per) > 1 else 0.5


def grow(box, gear):
    x, y, w, h = box
    if gear:
        gx, gy, gw, gh = gear
        x1, y1 = max(x + w, gx + gw), max(y + h, gy + gh)
        x, y = min(x, gx), min(y, gy)
        w, h = x1 - x, y1 - y
    return [x - w * 0.15, y - h * 0.25, w * 1.3, h * 1.5]


def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    u = aw * ah + bw * bh - ix * iy
    return ix * iy / u if u > 0 else 0


def corner_bug(rep, ts, arr, dur, scan, wh):
    """A logo bug is an overlay: its edges stay put while the picture under it cuts and moves. Edge persistence
    (share of frames in which a pixel is on an edge) is high in a corner and low in the middle of the frame."""
    W0, H0 = wh
    keep = [k for k, t in enumerate(ts) if t < dur - 3.5 and frame_class(arr[k])[0] not in ('black', 'blank')]
    if len(keep) < 8:
        return
    y = arr[keep].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    P = ((np.abs(np.gradient(y, axis=1)) + np.abs(np.gradient(y, axis=2))) > 20).mean(0)
    H, W = P.shape
    cw, chh = int(W * 0.26), int(H * 0.13)
    centre = float((P[int(H * 0.25):int(H * 0.75), int(W * 0.2):int(W * 0.8)] >= 0.5).mean())
    hits = []
    for name, (ys, xs) in {'top-left': (slice(0, chh), slice(0, cw)), 'top-right': (slice(0, chh), slice(W - cw, W)),
                           'bottom-left': (slice(H - chh, H), slice(0, cw)),
                           'bottom-right': (slice(H - chh, H), slice(W - cw, W))}.items():
        c = P[ys, xs] >= 0.5
        if c.sum() < 20 or c.mean() < max(5 * centre, 0.004):
            continue
        yy, xx = np.where(c)
        s = W0 / W
        box = [(xs.start + xx.min()) * s - 10, (ys.start + yy.min()) * s - 10, (xx.max() - xx.min() + 1) * s + 20,
               (yy.max() - yy.min() + 1) * s + 20]
        hits.append((name, box, float(P[ys, xs][c].mean())))
    rep.metrics.setdefault('brand', {})['edge_persistence_centre'] = round(centre, 4)
    if not hits:
        rep.add('brand', 'PASS', 'no corner logo bug')
        return
    mid = ts[keep[len(keep) // 2]]
    if len(hits) >= 3:
        rep.add('brand', 'HUMAN', f'static overlay in {len(hits)} corners ({", ".join(h[0] for h in hits)}): a HUD or frame '
                f'(allowed) or logo bugs (killed)?', t=mid, frame=nearest(scan, mid), crop=hits[0][1])
        return
    for name, box, pers in hits:
        st = 'WARN' if centre < 0.05 and box[2] < 0.2 * W0 and box[3] < 0.1 * H0 else 'HUMAN'
        rep.add('brand', st, f'static logo bug in the {name} corner ({box[2] - 20:.0f}x{box[3] - 20:.0f} px, its edges hold '
                f'in {pers:.0%} of the frames while the picture moves){"" if st == "WARN" else " (large, or the picture is fairly still: a HUD or a bug? check)"}',
                t=mid, frame=nearest(scan, mid), crop=box)


# ================================================================ 6: contact sheet
def contact_sheet(rep, path, cols=5, tw=240, th=427):
    rows = [i for i in rep.items if i.get('frame') and i['status'] in ('FAIL', 'HUMAN', 'WARN') and os.path.exists(i['frame'])]
    rows.sort(key=lambda i: (ORDER[i['status']], i.get('t') or 0))
    rows = rows[:40]
    if not rows:
        return None
    lab = 92
    R = math.ceil(len(rows) / cols)
    sheet = Image.new('RGB', (cols * tw, R * (th + lab)), (16, 16, 16))
    try:
        font = ImageFont.truetype(FONT, 12)
    except Exception:
        font = ImageFont.load_default()
    d = ImageDraw.Draw(sheet)
    for k, it in enumerate(rows):
        x, y = (k % cols) * tw, (k // cols) * (th + lab)
        try:
            im = Image.open(it['frame']).convert('RGB')
            if it.get('crop'):
                cx, cy, cw, ch = it['crop']
                box = (max(0, int(cx)), max(0, int(cy)), min(im.width, int(cx + cw)), min(im.height, int(cy + ch)))
                if box[2] - box[0] > 4 and box[3] - box[1] > 4:
                    c = im.crop(box)
                    c.thumbnail((tw, th), Image.NEAREST if c.width < tw / 2 else Image.LANCZOS)
                    if c.width < tw * 0.6:
                        c = c.resize((int(c.width * min(tw / c.width, th / c.height)),
                                      int(c.height * min(tw / c.width, th / c.height))), Image.NEAREST)
                    thumb = im.resize((tw, th))
                    dd = ImageDraw.Draw(thumb)
                    fx, fy = tw / im.width, th / im.height
                    dd.rectangle([box[0] * fx, box[1] * fy, box[2] * fx, box[3] * fy], outline=(255, 220, 0), width=2)
                    thumb = thumb.resize((tw // 2, th // 2))
                    canvas = Image.new('RGB', (tw, th), (30, 30, 30))
                    canvas.paste(c, ((tw - c.width) // 2, 0))
                    canvas.paste(thumb, (tw - thumb.width, th - thumb.height))
                    im = canvas
                else:
                    im = im.resize((tw, th))
            else:
                im = im.resize((tw, th))
            sheet.paste(im, (x, y))
        except Exception:
            pass
        col = {'FAIL': (230, 50, 40), 'HUMAN': (255, 170, 40), 'WARN': (230, 210, 60)}[it['status']]
        d.rectangle([x, y + th, x + tw - 1, y + th + lab - 1], fill=(28, 28, 28))
        d.rectangle([x, y + th, x + 5, y + th + lab - 1], fill=col)
        tt = f" {it['t']:.2f}s" if it.get('t') is not None else ''
        d.text((x + 9, y + th + 3), f"{it['status']} {it['check']}{tt}", fill=col, font=font)
        words, line, lines = it['msg'].split(), '', []
        for w in words:
            if len(line) + len(w) + 1 > 31:
                lines.append(line)
                line = w
            else:
                line = (line + ' ' + w).strip()
        lines.append(line)
        for j, l in enumerate(lines[:5]):
            d.text((x + 9, y + th + 19 + 14 * j), l, fill=(225, 225, 225), font=font)
    sheet.save(path, quality=85)
    return path


# ================================================================ main
import people_audit  # noqa: E402  (TOOLING c3)
import shot_table  # noqa: E402
from shot_table import strip_js_comments  # noqa: E402
PEOPLE_RE = re.compile(r"fx/people\.js|new People\(|fx/hero\.js|new Hero\(")
PEOPLE_CODE = ['web/lib/fx/people.js', 'web/lib/fx/gesture.js', 'web/lib/fx/hero.js']


def builds_people(src):
    """PEOPLE_RE in code, not in comments. Belt and braces: the comment stripper tracks strings, and a regex literal
    with a quote could fool it, so any line that is not itself a comment and imports/constructs People/Hero counts too."""
    if PEOPLE_RE.search(strip_js_comments(src)):
        return True
    return any(PEOPLE_RE.search(l.split('//')[0]) for l in src.splitlines()
               if not l.lstrip().startswith(('//', '*', '/*')) and re.search(r'\bimport\b|\bnew\s+(People|Hero)\(', l))


def scene_sources(scene):
    """the scene's own .js plus the sibling modules it imports (./x.js), one level"""
    main = os.path.join(tc.SCENES, scene + '.js')
    if not os.path.exists(main):
        return []
    out = [main]
    try:
        for m in re.findall(r"from\s+'\./([\w.]+\.js)'", open(main).read()):
            q = os.path.join(tc.SCENES, m)
            if os.path.exists(q) and q not in out:
                out.append(q)
    except OSError:
        pass
    return out


def people_checks(rep, video, scene, dur, clip=None):
    if not scene:
        rep.add('people', 'WARN', 'no scene: people check skipped')
        return
    srcs = scene_sources(scene)
    # TOOLING c3: match imports / constructors in code only, never a comment that names the module (MELTDOWN c3)
    builds = [os.path.basename(p) for p in srcs if builds_people(open(p, errors='ignore').read())]
    if not builds:
        rep.add('people', 'PASS', 'the scene builds no people')
        return
    # TOOLING c3: every audit render.mjs wrote (full, clip windows .people_<from>-<to>.json, stills when nothing else)
    # merged by scripts/people_audit.py; in clip mode only the clip's window counts
    newest = max(os.path.getmtime(p) for p in srcs + [os.path.join(VIDEOS, c) for c in PEOPLE_CODE if os.path.exists(os.path.join(VIDEOS, c))])
    win = (clip['from'], clip['to']) if clip else None
    try:
        J = people_audit.merged(scene, window=win, newest_src=newest)
    except Exception as e:  # noqa: BLE001
        rep.add('people', 'WARN', f'unreadable people audit for {scene}: {e}')
        return
    if J is None or not J.get('sources'):
        where = f' covering {win[0]:.2f}-{win[1]:.2f}s' if win else ''
        rep.add('people', 'WARN', f'{", ".join(builds)} build people but no gesture audit{where} was written '
                f'(out/.{scene}.people[_<from>-<to>].json): re-render with the current render.mjs')
        return
    rep.metrics['people'] = {k: J.get(k) for k in ('frames', 'raised', 'flagged', 'hazards', 'counts', 'coverage', 'covered_s', 'sources')}
    if not J.get('frames'):
        rep.add('people', 'WARN', 'the people audit covers no frames')
        return
    if J.get('stale') and set(J['stale']) >= set(J['sources']):
        rep.add('people', 'WARN', 'the people audit is older than the scene or the people code: re-render before publishing')
    span = win or (0.0, dur)
    holes = people_audit.gaps(J, span)
    if holes:
        rep.add('people', 'WARN', f"the audit ({len(J['sources'])} file(s)) leaves {', '.join(f'{a}-{b}' for a, b in holes)} s "
                f"of {span[0]:.1f}-{span[1]:.1f} s unchecked (scripts/people_audit.py {scene})")
    counts = J.get('counts') or {}
    frame_cache = {}

    def frame_at(t):
        if t in frame_cache:
            return frame_cache[t]
        d = os.path.join(rep.dest, 'people')
        os.makedirs(d, exist_ok=True)
        f = os.path.join(d, f'p_{t:07.3f}.jpg')
        try:
            run([FFMPEG, '-y', '-loglevel', 'error', '-ss', f'{t:.3f}', '-i', video, '-frames:v', '1', '-q:v', '3', f])
        except Exception:
            f = None
        frame_cache[t] = f if f and os.path.exists(f) else None
        return frame_cache[t]

    def crop(it):
        h = it.get('hand')
        if not h or h[0] is None:
            return None
        return (h[0] - 150, h[1] - 150, 300, 300)
    bad = [f for f in J.get('flags', []) if f.get('flags')]
    # There is no gesture ban (corrected 28 Sep: client). SALUTE_STRAIGHT / SALUTE_FOREARM point at frames for a person
    # to look at (HUMAN prompts with the crop, no measurements). CROTCH is a separate, unrelated safety flag.
    for kind in ('CROTCH',):
        n = counts.get(kind, 0)
        if not n:
            continue
        ex = [f for f in bad if kind in f['flags']][:4]
        ts = sorted({f['t'] for f in ex})
        rep.add('people', 'FAIL', f'{kind}: {n} arm-frames flagged (first at {", ".join(f"{t:.2f}s" for t in ts)})')
        for f in ex:
            fr = frame_at(f['t'])
            if fr:
                det = f"hand of #{f.get('a')} on #{f.get('b')}"
                rep.add('people', 'FAIL', f'{kind} {det}', t=f['t'], frame=fr, crop=crop(f))
    for kind in ('SALUTE_STRAIGHT', 'SALUTE_FOREARM'):
        ex = [f for f in bad if kind in f['flags']][:4]
        for f in ex:
            fr = frame_at(f['t'])
            if fr:
                rep.add('people', 'HUMAN', f"a straight arm raised forward at {f['t']:.2f}s: look at how it reads (no gesture is banned)",
                        t=f['t'], frame=fr, crop=crop(f))
    if not counts.get('CROTCH'):
        rep.add('people', 'PASS', 'no crotch flags in the people audit')
    for f in (J.get('samples') or [])[:6]:
        fr = frame_at(f['t'])
        if fr:
            rep.add('people', 'HUMAN', f"raised arm ({f.get('name')}) at feed size: does it read as a fist?",
                    t=f['t'], frame=fr, crop=crop(f))


def voices_check(rep, scene, key):
    """The voice guard's tally from out/.<scene>.hits.json (engine/audio.py voice_report, written by make_audio)."""
    if not scene:
        rep.add('voices', 'WARN', 'no scene: voices check skipped')
        return
    h = tc.hits_for(scene) or tc.hits_for(re.sub(r'\d+$', '', scene))
    if h is None:
        rep.add('voices', 'WARN', f'no out/.{scene}.hits.json: build the song (make_audio / render.mjs) and rerun')
        return
    v = h.get('voices')
    if v is None:
        rep.add('voices', 'WARN', 'hits.json predates the voice guard (2026-09-27): rebuild the song so the gate can see '
                'whether any synthesized word vocal sounds')
    else:
        rep.metrics['voices'] = {k: v.get(k) for k in ('on', 'human_declared', 'synth_audible', 'say_suppressed',
                                                        'neural_suppressed', 'stem_dropped', 'stem_human', 'say_wordless')}
        if v.get('found'):      # VOICE c4: recorded voices placed on purpose (engine/voice/found.py); information only, never a FAIL
            its = v.get('found_items') or []
            unk = [i.get('item') for i in its if i.get('rights') not in ('PD', 'CC')]
            rep.add('voices', 'WARN' if unk else 'INFO', f"{v['found']} found (recorded) voice(s) placed: " +
                    '; '.join(f"{i.get('item')} [{i.get('rights')}]" for i in its[:4]) +
                    (f". RIGHTS NOT STATED for {', '.join(map(str, unk))}: check the original source before publishing" if unk else ''))
        if v.get('synth_audible', 0) > 0:
            rep.add('voices', 'INFO', f"{v['synth_audible']} synthesized word vocal(s) audible (say {v.get('say_voiced')}, "
                    f"neural {v.get('neural_voiced')}, array stems {v.get('stem_synth')}); voices on: {v.get('on')}. Voices are "
                    'content to refine like any other (the client, 1 Oct): listen to them, judge them, keep improving them')
        elif v.get('human_declared') and not v.get('stem_human'):
            rep.add('voices', 'WARN', 'the song declares human takes but none was placed (missing wav files?)')
        else:
            sup = v.get('say_suppressed', 0) + v.get('neural_suppressed', 0) + v.get('stem_dropped', 0)
            rep.add('voices', 'PASS', f"no synthesized word vocal sounds ({v.get('stem_human', 0)} human take(s); "
                    f"{sup} worded synth call(s) silenced by the guard{': clean them out of the song' if sup else ''}; "
                    f"{v.get('say_wordless', 0)} wordless)")
    # the song's timed text vs the script: words the song logs that the script no longer has
    try:
        script, _ = tc.load_script(key)
    except Exception:
        script = None
    if script:
        lines = {tc.fold(w.get('text', '')) for w in script.get('words', []) if isinstance(w, dict)}
        extra = sorted({x.get('text') for x in h.get('text', []) if x.get('text') and tc.fold(x['text']) not in lines
                        and ':' not in x['text']})
        if extra:
            rep.add('voices', 'WARN', f'the song logs {len(extra)} text hit(s) not in the script (stale cue in the song?): ' +
                    ', '.join(extra[:8]))


CLIP_NAME = re.compile(r'^(.+?)_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$')


def resolve_scene(video, scene):
    """--scene NAME as given; 'auto' / 'auto:PIECE' / none: the file stem if it names a scene (farm/horde3_share.mp4),
    else the piece name (HORDE_v8_share.mp4, or PIECE from publish.sh) through PIECES."""
    if scene and not scene.startswith('auto'):
        return scene
    stem = os.path.splitext(os.path.basename(video))[0]
    base = re.sub(r'_share$', '', stem)
    if os.path.exists(os.path.join(tc.SCENES, base + '.js')):
        return base
    cm = CLIP_NAME.match(base)             # render.mjs --from/--to output: <scene>_<from>-<to>.mp4
    if cm and os.path.exists(os.path.join(tc.SCENES, cm.group(1) + '.js')):
        return cm.group(1)
    pieces = [re.sub(r'_v\d+$', '', base)] + ([scene.split(':', 1)[1]] if scene and ':' in scene else [])
    for piece in pieces:
        if piece in PIECES:
            return PIECES[piece]
    if scene:   # a missing map entry is bookkeeping, not breakage: check what can be checked without the scene
        print(f'gate: --scene {scene}: no scene for {pieces} (add it to PIECES in gate.py); the scene checks are skipped', file=sys.stderr)
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video')
    ap.add_argument('--scene')
    ap.add_argument('--script')
    ap.add_argument('--bpm', type=float)
    ap.add_argument('--hits', help='path to a hits.json to use instead of out/.<scene>.hits.json (scene name differs from the song key)')
    ap.add_argument('--offset', type=float, default=0.0)
    ap.add_argument('--from', dest='clip_from')
    ap.add_argument('--to', dest='clip_to')
    ap.add_argument('--chant')
    ap.add_argument('--step', type=float, default=0.5)
    ap.add_argument('--threshold', type=float, default=80)
    ap.add_argument('--only')
    ap.add_argument('--skip', default='')
    ap.add_argument('--strict', action='store_true')
    ap.add_argument('--out')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--keep-frames', action='store_true')
    args = ap.parse_args()
    if args.hits:
        if not os.path.exists(args.hits):
            ap.error(f'--hits {args.hits}: no such file')
        os.environ['ACP_HITS_JSON'] = os.path.abspath(args.hits)

    video = os.path.abspath(args.video)
    if not os.path.exists(video) or os.path.getsize(video) < 10000:
        ap.error(f'{args.video}: missing, or a Git LFS pointer (git lfs pull it first)')
    # 8 Oct: the hits, load, values and scansion checks were judgements of creative work by numbers and are removed;
    # their names are still accepted in --only/--skip so old commands run, and do nothing.
    checks = (set((args.only or 'text,audio,frames,hook,brand,people,voices').split(',')) - set(args.skip.split(','))
              - {'hits', 'load', 'values', 'scansion'})
    scene = resolve_scene(video, args.scene)
    key = args.script or (script_key(scene) if scene else None)   # TOOLING WM1: exact name first (machines_e1)
    if key and key.endswith('.json') and not os.path.isabs(key):
        key = os.path.join(ROOT, key) if os.path.exists(os.path.join(ROOT, key)) else os.path.abspath(key)
    stem = os.path.splitext(os.path.basename(video))[0]
    dest = args.out or os.path.join(REPORTS, stem)
    os.makedirs(dest, exist_ok=True)
    rep = Report(video, dest)
    dur, fps, wh, has_audio = probe(video)
    rep.metrics['file'] = {'duration': dur, 'fps': fps, 'size': list(wh), 'scene': scene, 'script': key}
    if wh != (1080, 1920):
        rep.add('frames', 'FAIL', f'{wh[0]}x{wh[1]}: the slate is 1080x1920 (CL36)')
    if fps and abs(fps - 30) > 0.5:
        rep.add('frames', 'FAIL', f'{fps:g} fps: the slate is 30 fps')
    clip = None
    cm = CLIP_NAME.match(stem)
    if args.clip_from is None and args.clip_to is None and cm and cm.group(1) == scene:
        args.clip_from, args.clip_to = cm.group(2), cm.group(3)      # render.mjs names clips <scene>_<from>-<to>
        rep.add('frames', 'INFO', f'clip mode from the file name: piece {cm.group(2)}-{cm.group(3)}s')
    if args.clip_from is not None or args.clip_to is not None:
        clip = clip_window(args, scene, dur)
        args.offset = args.offset - clip['from']       # file time = piece time + offset
        rep.metrics['clip'] = dict(clip)

    scan_dir = os.path.join(dest, 'scan')
    need_scan = checks & {'text', 'brand', 'frames', 'band', 'hook'}
    nf = int(round(dur * fps))
    scan = extract_scan(video, args.step, fps, scan_dir, nf) if need_scan else {}
    ts, arr = decode_frames(video, max(1, int(round(fps / 6))), 270, 480, nf) if checks & {'frames', 'brand'} else ([], None)

    if 'text' in checks:
        if not scene:
            rep.add('text', 'FAIL', 'no scene: pass --scene (needed for the BPM, the cue table and the picture text)')
        else:
            try:
                text_checks(rep, args, video, scene, key, dur, scan, clip)
            except SystemExit as e:
                rep.add('text', 'FAIL', f'text check could not run: {e}')
    if 'audio' in checks:
        if has_audio:
            audio_checks(rep, video, dur, clip)
        else:
            rep.add('audio', 'FAIL', 'no audio stream', breaks=True)
    if 'band' in checks and args.only and 'band' in args.only.split(','):
        band_check(rep, scan, clip)
    if 'frames' in checks:
        frame_checks(rep, video, dur, fps, ts, arr, scan, clip, scene, key)
    if 'hook' in checks and scene:
        hook_check(rep, scene, key, scan, clip, args.threshold, args.jobs)
    if 'brand' in checks:
        brand_checks(rep, video, dur, fps, wh, scan, ts, arr, args.jobs, clip=clip)
    if 'people' in checks:
        people_checks(rep, video, scene, dur, clip)
    if 'voices' in checks:
        voices_check(rep, scene, key)
    if clip:
        for i in rep.items:
            if i.get('t') is not None:
                i['piece_t'] = round(i['t'] + clip['from'], 3)

    # keep only the flagged frames (shrunk) unless asked
    flagged = {i['frame'] for i in rep.items if i.get('frame')}
    sheet = contact_sheet(rep, os.path.join(dest, 'sheet.jpg'))
    if not args.keep_frames:
        for p in glob.glob(os.path.join(scan_dir, '*.jpg')):
            if p not in flagged:
                os.remove(p)
        for p in glob.glob(os.path.join(dest, 'text', 'frames', '*.jpg')):   # text/sheet.jpg shows them all
            if p not in flagged:
                os.remove(p)
        for p in glob.glob(os.path.join(scan_dir, '*.jpg')):      # kept frames are for looking at: half size
            try:
                im = Image.open(p)
                if im.width > 540:
                    im.convert('RGB').resize((540, round(im.height * 540 / im.width)), Image.LANCZOS).save(p, quality=82)
            except Exception:
                pass
    out = {'target': os.path.relpath(video, ROOT) if video.startswith(ROOT) else video, 'verdict': rep.verdict(),
           'metrics': rep.metrics, 'items': sorted(rep.items, key=lambda i: (ORDER[i['status']], i['check'])),
           'sheet': sheet}
    with open(os.path.join(dest, 'report.json'), 'w') as f:
        json.dump(out, f, indent=1, default=str)
    if args.json:
        json.dump(out, sys.stdout, indent=1, default=str)
        print()
    else:
        show(out, dest)
    sys.exit(1 if out['verdict'] == 'FAIL' else 0)


def clip_window(args, scene, dur):
    """--from/--to (piece seconds or b<beat>) -> {from, to, spb, piece_dur} in piece seconds."""
    h = (tc.hits_for(scene) or tc.hits_for(re.sub(r'\d+$', '', scene or '')) or {}) if scene else {}
    bpm = args.bpm or h.get('bpm')
    spb = 60.0 / bpm if bpm else None

    def sec(v):
        v = str(v).strip()
        if v.lower().startswith('b'):
            if not spb:
                raise SystemExit('gate: a beat window (b<N>) needs the BPM: build the song or pass --bpm')
            return float(v[1:]) * spb
        return float(v.rstrip('s'))
    f = sec(args.clip_from) if args.clip_from is not None else 0.0
    t = sec(args.clip_to) if args.clip_to is not None else f + dur
    if t - f > dur + 0.25:
        print(f'gate: --from/--to span {t - f:.2f}s but the clip is {dur:.2f}s: using the clip length', file=sys.stderr)
        t = f + dur
    # TOOLING c4: the piece ends at the closer beat + the kit closer's 1.4 s (scripts/piece_bounds.py), not at the
    # song length, so a clip that reaches the real end has its lockup, last second and loop seam checked
    pe = piece_bounds.piece_end(scene, getattr(args, 'script', None) if str(getattr(args, 'script', '') or '').endswith('.json') else None, h) if scene else {}
    return {'from': round(f, 3), 'to': round(t, 3), 'spb': spb or 0.5, 'bpm': bpm,
            'piece_dur': float(pe.get('end') or h.get('duration') or 1e9), 'piece_end_source': pe.get('source'),
            'song_dur': h.get('duration')}


def show(out, dest):
    w = sys.stdout.write
    m = out['metrics'].get('file', {})
    w(f"\n== GATE {out['target']}  ({m.get('duration', 0):.2f}s, scene {m.get('scene')}, script {m.get('script')})\n")
    c = out['metrics'].get('clip')
    if c:
        w(f"   CLIP MODE: piece {c['from']:.2f}-{c['to']:.2f}s (file t + {c['from']:.2f} = piece t); whole-piece measures are INFO\n")
        if c.get('piece_end_source'):
            w(f"   piece ends at {c['piece_dur']:.2f}s ({c['piece_end_source']})\n")
    for check in ('text', 'audio', 'frames', 'hook', 'brand', 'band', 'people', 'voices'):
        its = [i for i in out['items'] if i['check'] == check]
        if not its:
            continue
        worst = min((i['status'] for i in its if i['status'] != 'INFO'), key=lambda s: ORDER[s],
                    default='PASS')
        w(f"  [{worst:<5}] {check}\n")
        for i in its:
            if i['status'] == 'PASS' and check == 'text':
                continue
            w(f"      {i['status']:<5} {i['msg']}\n")
    a = out['metrics'].get('audio')
    if a:
        w(f"      (TP {a['true_peak_dbtp']:+.1f} dBTP, sample peak {a['sample_peak_dbfs']:+.1f} dBFS, "
          f"integrated {a['integrated_lufs']:.1f} LUFS)\n")
    t = out['metrics'].get('text')
    if t:
        w(f"      (text_check: {t['cue_pass']}/{t['cue_frames']} cue frames pass, cues from {t['cue_source']} at {t['bpm']} BPM, "
          f"sheet {t['report']}/sheet.jpg)\n")
    n = Counter(i['status'] for i in out['items'])
    w(f"  => {out['verdict']}: {n.get('FAIL', 0)} fail, {n.get('HUMAN', 0)} for a human, {n.get('WARN', 0)} warn. "
      f"Report {os.path.relpath(dest, ROOT)}/report.json, sheet {os.path.relpath(out['sheet'], ROOT) if out['sheet'] else '-'}\n")


if __name__ == '__main__':
    main()
