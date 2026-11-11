#!/usr/bin/env python3
"""text_check.py: OCR gate. Is the text on screen the script of record, on its beat, and nothing else?

For every text frame in the script it grabs one still at the frame's mid-point (beat x 60/BPM), OCRs it and
scores what was read against what the script says. It also samples each silent gap (a null in the script, or a
hole between seq() cues) and flags words on screen that are not the expected line: leftover copy from an older
cut, lines the client rejected and optics hazards (FLAGGED, advisory) and anything else unknown.

USAGE
  Scene mode: renders stills with web/render.mjs --stills. The scene's beat map is rebuilt first
  (web/audio/make_audio.py, as render.mjs does) so the sample times match the song the scene will render.
    python3 videos/scripts/text_check.py SCENE [SCRIPT_KEY] [options]
    python3 videos/scripts/text_check.py ownfuture2                  # key defaults to the scene minus digits
    python3 videos/scripts/text_check.py unfinished3 unfinished --cues scene
    python3 videos/scripts/text_check.py acc_ident                   # no script: the scene's own cue table

  Published mode: samples a finished mp4 with ffmpeg (one decode pass) instead of rendering
    python3 videos/scripts/text_check.py --published videos/out/farm/frontier3_share.mp4 [SCRIPT_KEY]
    python3 videos/scripts/text_check.py --published 'videos/out/farm/*_share.mp4' --summary
    python3 videos/scripts/text_check.py --published cut.mp4 frontier --scene frontier3 --bpm 150 --scan 0.5

  Dry run (no render, no OCR): the expected frames with their sample times, script-vs-scene drift, script lint
    python3 videos/scripts/text_check.py frontier3 --dry-run

  SCRIPT_KEY names research/scripts_final/<key>.json (falls back to research/scripts_wip/<key>.json), or is a
  path to a JSON with words: [{beat, text|null}]. Default: the scene name without trailing digits
  (frontier3 -> frontier, red_wedge2 -> red_wedge). In published mode the scene is the file stem without
  "_share" (frontier3_share.mp4 -> frontier3) unless --scene is given; its out/.<scene>.hits.json gives the BPM
  (falling back to out/.<scene minus digits>.hits.json). A published cut made on an older song has other beat
  times: pass --bpm, or --scan to see where each missing line actually shows.

OPTIONS
  --cues script|scene|hits  where the expected frames and their beats come from (default script; falls back to
                            the scene's cue table when there is no script). "scene" reads const WORDS/CUES/STAMPS
                            (or piece({words})) from the scene .js; "hits" reads the song's timed vocal lines.
  --bpm N                   override the BPM (and skip the beat-map rebuild in scene mode)
  --offset S                seconds added to every sample time (a published cut with a lead-in)
  --samples K               stills per text frame, spread across its middle (default 1). A failed frame is
                            retried at 30% and 75% of its hold unless --no-retry (those stills are grabbed in
                            the same render/decode pass). A frame that already shows an stale or flagged line is
                            not retried: it is wrong either way.
  --threshold N             score (0-100) a frame needs to PASS (default 80)
  --min-conf N              tesseract confidence for a stray word to count as read (default 75)
  --min-height F            smallest word height, as a fraction of the frame height, that counts as cue type
                            (default 0.025, ~48 px of 1920). Smaller print (banknote legends, signs, HUD) is
                            picture text: it cannot pass a frame or be flagged LEFTOVER/EXTRA; FLAGGED still reads it.
  --scan S                  also sample every S seconds end to end and OCR everything: text that lands between
                            the sampled points, and a "seen at" time for every failed line
  --no-blank                do not sample the silent gaps
  --strict                  unknown stray words (EXTRA) fail the check too (default: warn)
  --from B / --to B         only check frames starting in this beat range
  --jobs N                  tesseract processes in parallel (default 4)
  --out DIR                 report dir (default videos/review/text_check/<scene or file stem>/)
  --keep-stills             scene mode: also leave the stills in out/stills (default: copied into the report dir
                            and removed from out/stills; a still of the same name that was there is put back)
  --last-hold B             beats the last scripted frame holds when nothing ends it (default 2)
  --json / --summary        print the JSON report / one line per target instead of the table
  --verbose                 also list PICTURE words and stray single SCRIPT words
  --dry-run                 no render, no OCR

OUTPUT
  One row per sampled frame: beat, time, expected, read, score, PASS/FAIL, plus the stray text in that frame.
  Then every stray, by class:
    LEFTOVER  a stale line from an older cut: the script's old_snippet (and any *_words list), the lines rejected for
              this key in videos/review/mined_line_audit.md, and cue lines in the scene .js the script dropped.
              A line the scene still draws as picture text (the old bill's FEDERAL RESERVE NOTE) is not leftover.
    FLAGGED   a specific line the client rejected, or an optics hazard (FLAGGED below; advisory). One the script or
              the scene's picture text itself uses is reported once, as lint.
    SCRIPT    a script line read clearly inside a silent gap (off its beat); stray script words (--verbose)
    PICTURE   words drawn by the scene or the libs it imports (HUD, plaques, closer, ACP.US) (--verbose)
    EXTRA     unknown upper-case word in cue-sized type
  A frame FAILs when its expected line is not read, or a script line shows in a planned gap; EXTRA fails only with
  --strict. LEFTOVER and FLAGGED are reported for a person to judge, never a failure (28 Sep process review).
  Before the table: script-vs-scene cue drift (beat for beat) and lint.
  The report dir gets report.json, sheet.jpg (every sampled frame, labelled PASS/FAIL, expected and read)
  and frames/. Exit status: 0 all pass, 1 any FAIL, 2 usage, render or OCR error.

SCORING
  R = best character ratio (difflib) of the line, spaces and punctuation dropped, against any run of read words
  in one mask; C = share of the line's words (length-weighted) read at >= 0.8 anywhere in the frame.
  score = 100 x min(max(R, C), 0.4 + 0.6 C), so a near character match cannot pass with whole words missing
  (WE PRINT IT vs PRINT). OCR confusions 0/O 1/I 5/S 8/B 6/G are folded first. Lines of 3 characters or fewer
  (AI., TWO.) must be read exactly.

OCR
  tesseract 5 (apt-get install -y tesseract-ocr), --psm 11, run with OMP_THREAD_LIMIT=1 (its OpenMP threads
  crawl on a loaded box). Stylised, stencilled and script faces are handled by OCRing several binarised masks
  of each frame, escalating only while the line is not found: (1) 1/3 scale luminance, light-text thresholds
  and one mask per vivid hue (orange, red, yellow, cyan ...); (2) dark-ink threshold, plus every mask
  morphologically opened (drops grain, sparks, scan lines) and the light mask closed (bridges stencil gaps);
  (3) the plain masks at 1/2 scale. Hand-lettered 1776 script and heavy glitch frames can still read poorly:
  check a FAIL against sheet.jpg before acting on it.
"""
import argparse
import csv
import glob
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from script_key import script_key  # noqa: E402  (TOOLING WM1: scene -> script key, exact name first)
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
ROOT = os.path.dirname(VIDEOS)
WEB = os.path.join(VIDEOS, 'web')
SCENES = os.path.join(WEB, 'scenes')
OUT = os.path.join(VIDEOS, 'out')
SCRIPTS_FINAL = os.path.join(ROOT, 'research', 'scripts_final')
SCRIPTS_WIP = os.path.join(ROOT, 'research', 'scripts_wip')
AUDIT = os.path.join(VIDEOS, 'review', 'mined_line_audit.md')
REPORTS = os.path.join(VIDEOS, 'review', 'text_check')
FFMPEG = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
NODE = shutil.which('node') or '/opt/node22/bin/node'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'

# ---------------------------------------------------------------- flagged lines (advisory, 28 Sep process review)
# Until 28 Sep this was a BANNED list of words and labels (MARX, LENIN, THE LEFT, OUR STRUGGLE, HEGEMONY, FOR ALL ...)
# that failed any frame showing them, verbatim source quotes included. It stripped the sources' language, and several
# entries were falsely credited to the client (OUR STRUGGLE is his own phrase, CL66), so the word bans are gone
# (research/RULES_AUDIT.md §2 #14). What is left is a short list of specific lines the client rejected and optics
# hazards with a real reason; they are reported as FLAGGED, a note for a person to look at, never a failure.
FLAGGED = {
    'client rejected this line': ['WHO RIDES', 'HISTORY HAS HOOVES', 'FROM THE STEPPE TO AMERICA', 'DARE I SAY',
                                  'TOO HOT FOR THE OLD WAY', 'UNITED GATES'],
    'client ruled off limits': ['WE ARE A TERRORIST STATE'],
    'optics (a hostile reposter clips it)': ['ONE COUNTRY ONE HISTORY ONE PARTY', 'ZIONIST', 'OCCUPIED',
                                             'FOREIGN OCCUPATION'],
    'asset / date (client)': ['2098', 'BEYOND THE VISIBLE SPECTRUM'],
}
# picture text any piece may carry: the kit's closer and sign-off, the lockup tagline, the logo
GLOBAL_PICTURE = ['ACP', 'ACP.US', 'JOIN THE FIGHT AT ACP.US', 'OWN THE FUTURE', 'INTELLIGENCE IN SERVICE OF HUMANITY',
                  'AMERICAN COMMUNIST PARTY', 'ANOTHER BANGER BY ACP', 'ACC']


# ================================================================ text normalisation and fuzzy scores
_FOLD = str.maketrans({'0': 'O', '1': 'I', '5': 'S', '8': 'B', '6': 'G'})


def norm(s):
    """Upper case, apostrophes dropped (IRON'S -> IRONS), everything else not A-Z/0-9 becomes a space."""
    s = (s or '').upper().replace('’', "'").replace('‘', "'").replace('`', "'")
    s = re.sub(r"'", '', s)
    s = re.sub(r'[^A-Z0-9%]+', ' ', s)
    return s.strip()


def fold(s):
    """norm() plus the usual OCR digit/letter confusions folded together (0/O, 1/I, 5/S, 8/B, 6/G)."""
    return norm(s).translate(_FOLD)


def ratio(a, b):
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b, autojunk=False).ratio()


def window_score(expected, toks, slack=2, same_len=False, floor=0.0, folded=False):
    """Best ratio (> floor) of the expected string (spaces removed) against any run of consecutive read tokens.
    Returns (ratio, i, j) for the winning token slice, or (0, 0, 0). toks may be pre-folded (folded=True)."""
    fe = fold(expected)
    E = fe.replace(' ', '')
    ne = max(1, len(fe.split()))
    R = toks if folded else [fold(t).replace(' ', '') for t in toks]
    best, at = floor, (0, 0)
    if not E:
        return 0.0, 0, 0
    for i in range(len(R)):
        if not R[i]:
            continue
        w = ''
        for j in range(i, len(R)):
            w += R[j]
            n = j - i + 1
            if n > ne + slack or len(w) > 2 * len(E) + 3 or (same_len and n > ne + 1):
                break
            if same_len and n < ne - 1:
                continue
            sm = SequenceMatcher(None, E, w, autojunk=False)
            if sm.real_quick_ratio() <= best or sm.quick_ratio() <= best:
                continue
            r = sm.ratio()
            if r > best:
                best, at = r, (i, j + 1)
    return (best, at[0], at[1]) if at != (0, 0) else (0.0, 0, 0)


# ================================================================ cue tables in JS (scene files and old_snippet)
def _match_bracket(src, i):
    """src[i] is '[' or '('; return the index after its matching close, skipping strings and comments."""
    pairs = {'[': ']', '(': ')', '{': '}'}
    stack = [pairs[src[i]]]
    j = i + 1
    n = len(src)
    while j < n and stack:
        c = src[j]
        if c in '\'"`':
            q = c
            j += 1
            while j < n and src[j] != q:
                if src[j] == '\\':
                    j += 1
                j += 1
        elif src.startswith('//', j):
            j = src.find('\n', j)
            if j < 0:
                return n
            continue
        elif src.startswith('/*', j):
            j = src.find('*/', j) + 1
            if j <= 0:
                return n
        elif c in pairs:
            stack.append(pairs[c])
        elif c == stack[-1]:
            stack.pop()
        j += 1
    return j


TABLE_RE = re.compile(r'\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*(?:\[|seq\s*\()|\bwords\s*:\s*\[')


def find_tables(src, names=None):
    """[(name, expression source)] for every cue table: const WORDS/CUES/STAMPS/..._WORDS/_CUES = [...], words: [...]."""
    out = []
    for m in TABLE_RE.finditer(src):
        name = m.group(1) or 'words'
        if names:
            if name not in names:
                continue
        elif not (name == 'words' or re.search(r'(^|_)(WORDS|CUES|STAMPS)($|_)', name)):
            continue
        start = m.end() - 1
        end = _match_bracket(src, start)
        if src[start] == '(':           # const CUES = seq(8, [...])
            start = src.rfind('seq', m.start(), start)
        out.append((name, src[start:end]))
    return out


def _const_defs(src):
    """Simple top-level literals (NAME = number/bool/string) that cue tables sometimes reference."""
    d = {}
    for m in re.finditer(r'(?:\bconst|\blet|\bvar|,)\s*([A-Za-z_$][\w$]*)\s*=\s*(-?\d+(?:\.\d+)?|true|false|\'[^\'\n]*\'|"[^"\n]*")\s*(?=[,;\n])', src):
        d.setdefault(m.group(1), m.group(2))
    return d


def eval_tables(src, names=None, unknown='null'):
    """Evaluate the scene's cue tables with node (seq() shimmed, simple constants resolved).
    Returns {name: [cue dicts {s, e|None, text}]} in beats."""
    tables = find_tables(src, names)
    if not tables:
        return {}
    consts = _const_defs(src)
    res = {}
    for name, expr in tables:
        defined = {}
        for _ in range(12):
            prelude = ''.join(f'const {k} = {v};\n' for k, v in defined.items())
            prog = ('const seq = (start, items) => { const out = []; let b = start;'
                    ' for (const [n, text, red] of items) { out.push({ s: b, e: b + n, text, red: !!red }); b += n; } return out; };\n'
                    + prelude + f'const __T = ({expr});\nprocess.stdout.write(JSON.stringify(__T));')
            r = subprocess.run([NODE, '-e', prog], capture_output=True, text=True)
            if r.returncode == 0:
                try:
                    res[name] = normalize_table(json.loads(r.stdout))
                except Exception:
                    pass
                break
            m = re.search(r'ReferenceError: (\S+) is not defined', r.stderr)
            if not m:
                break
            ident = m.group(1)
            defined[ident] = consts.get(ident, unknown)
    return res


def normalize_table(t):
    """[[beat, text|null, ...]] or [{s, e, text}] -> sorted [{s, e, text}] (e None = until the next entry)."""
    cues = []
    for x in t:
        if isinstance(x, dict) and 's' in x:
            cues.append({'s': float(x['s']), 'e': float(x['e']) if x.get('e') is not None else None,
                         'text': x.get('text')})
        elif isinstance(x, list) and x and isinstance(x[0], (int, float)):
            text = x[1] if len(x) > 1 and (x[1] is None or isinstance(x[1], str)) else None
            if len(x) > 1 and not (x[1] is None or isinstance(x[1], str)):
                continue
            cues.append({'s': float(x[0]), 'e': None, 'text': text})
    cues.sort(key=lambda c: c['s'])
    return cues


def close_open_ends(cues, last_hold=2.0, end_beat=None):
    """Give every cue an end: the next entry's start (entries hold until replaced) and last_hold for the last one."""
    out = []
    for i, c in enumerate(cues):
        e = c['e']
        if e is None:
            nxt = [d['s'] for d in cues[i + 1:] if d['s'] > c['s']]
            e = nxt[0] if nxt else c['s'] + last_hold
        if end_beat is not None:
            e = min(e, end_beat)
        out.append({'s': c['s'], 'e': e, 'text': c['text']})
    return out


def with_gaps(cues, min_gap=1.0):
    """Text cues plus explicit blank cues for every gap of >= min_gap beats between them (nulls and seq() holes)."""
    text = sorted([c for c in cues if c['text'] and c['e'] > c['s']], key=lambda c: c['s'])
    out = []
    pos = 0.0
    for c in text:
        if c['s'] - pos >= min_gap:
            out.append({'s': pos, 'e': c['s'], 'text': None})
        out.append(c)
        pos = max(pos, c['e'])
    return out


# ================================================================ script, scene, picture text
def load_script(key):
    if not key:
        return None, None
    for p in ([key] if key.endswith('.json') else []) + [os.path.join(SCRIPTS_FINAL, key + '.json'),
                                                         os.path.join(SCRIPTS_WIP, key + '.json')]:
        if os.path.exists(p):
            with open(p) as f:
                return json.load(f), p
    return None, None


def script_cues(d):
    ws = [w for w in d.get('words', []) if isinstance(w, dict) and 'beat' in w]
    return normalize_table([[float(w['beat']), w.get('text')] for w in ws])


def scene_files(scene):
    """The scene's .js plus every local module it imports (lib/kit.js, lib/fx/*, scene siblings)."""
    seen, todo = [], [os.path.join(SCENES, scene + '.js')]
    while todo:
        p = os.path.normpath(todo.pop())
        if p in seen or not os.path.exists(p) or 'node_modules' in p:
            continue
        seen.append(p)
        with open(p, errors='replace') as f:
            src = f.read()
        for m in re.finditer(r'''(?:from|import)\s*\(?\s*['"](\.{1,2}/[^'"]+\.m?js)['"]''', src):
            todo.append(os.path.join(os.path.dirname(p), m.group(1)))
    return seen


def string_literals(src):
    out = []
    for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`", src):
        s = m.group(1) if m.group(1) is not None else m.group(2) if m.group(2) is not None else m.group(3)
        s = re.sub(r'\$\{[^}]*\}|\\n', ' ', s)
        if re.search(r'[A-Za-z]{2}', s):
            out.append(s)
    return out


def hits_for(scene):
    p = os.environ.get('ACP_HITS_JSON') or os.path.join(OUT, f'.{scene}.hits.json')   # --hits override (gate.py)
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return None


def audit_lines(key):
    """Rejected lines in review/mined_line_audit.md for this script key ('Text' column of its table)."""
    if not key or not os.path.exists(AUDIT):
        return []
    with open(AUDIT) as f:
        md = f.read()
    m = re.search(r'^## .*\(' + re.escape(key) + r'\.json\)\s*$(.*?)(?=^## |\Z)', md, re.M | re.S)
    if not m:
        return []
    out = []
    for row in m.group(1).splitlines():
        cells = [c.strip() for c in row.split('|')]
        if len(cells) > 3 and cells[1] and not set(cells[1]) <= set('-') and cells[1] != 'Beats':
            for part in re.split(r'\s*(?:/|…|\.\.\.)\s*', cells[2]):
                part = part.strip(' *()')
                if re.search(r'[A-Z]{2}', part) and part.upper() == part:
                    out.append(part)
    return out


class Context:
    """Everything the checker knows about one piece: script lines, stale lines, flagged lines, picture vocab."""

    def __init__(self, scene, key, cue_source='script', bpm=None, last_hold=2.0, make_audio=False):
        self.scene, self.key = scene, key
        self.notes = []
        self.script, self.script_path = load_script(key)
        self.scene_js = os.path.join(SCENES, scene + '.js') if scene else None
        if self.scene_js and not os.path.exists(self.scene_js):
            self.scene_js = None
        src = open(self.scene_js, errors='replace').read() if self.scene_js else ''
        self.scene_tables = eval_tables(src) if src else {}
        scene_cues = [c for t in self.scene_tables.values() for c in t]
        self.scene_cues = close_open_ends(sorted(scene_cues, key=lambda c: c['s']), last_hold) if scene_cues else []
        if make_audio and scene and not bpm:
            # scene mode: rebuild the beat map first, as render.mjs will, so the sample times match the song it renders
            subprocess.run(['python3', os.path.join(WEB, 'audio', 'make_audio.py'), scene, '--quiet'], cwd=VIDEOS,
                           capture_output=True)
        self.hits = hits_for(scene) if scene else None
        if scene and self.hits is None and not bpm:
            base = re.sub(r'\d+$', '', scene)
            if base != scene and hits_for(base):
                self.hits = hits_for(base)
                self.notes.append(f'out/.{scene}.hits.json is missing: using the BPM of out/.{base}.hits.json')
        self.bpm = bpm or (self.hits or {}).get('bpm')
        if not self.bpm:
            raise SystemExit(f'no BPM: out/.{scene}.hits.json is missing; pass --bpm')
        self.spb = 60.0 / self.bpm
        dur_beats = (self.hits or {}).get('duration', 1e9) / self.spb if self.hits else None

        # expected frames
        src_used = cue_source
        if cue_source == 'script' and self.script is None:
            src_used = 'scene'
            self.notes.append(f'no script for key {key!r}: expected frames come from the scene cue table')
        if src_used == 'script':
            cues = script_cues(self.script)
            # the last frame holds last_hold beats unless the scene has the same cue with an explicit end
            cues = close_open_ends(cues, last_hold, dur_beats)
            for c in cues:
                for sc in self.scene_cues:
                    if abs(sc['s'] - c['s']) < 1e-3 and norm(sc['text'] or '') == norm(c['text'] or '') and c['text']:
                        if c is cues[-1] or not [d for d in cues if d['s'] > c['s']]:
                            c['e'] = sc['e']
        elif src_used == 'scene':
            if not self.scene_cues:
                raise SystemExit(f'no cue table found in {self.scene_js}')
            cues = self.scene_cues
        elif src_used == 'hits':
            tx = (self.hits or {}).get('text') or []
            if not tx:
                raise SystemExit(f'out/.{scene}.hits.json has no timed text')
            cues = close_open_ends(normalize_table([[x['t'] / self.spb, x['text']] for x in tx]), last_hold, dur_beats)
        else:
            raise SystemExit(f'unknown --cues {cue_source}')
        self.cue_source = src_used
        self.cues = cues

        # vocabularies
        self.script_lines = sorted({c['text'] for c in cues if c['text']})
        if self.script and src_used != 'script':
            self.script_lines = sorted(set(self.script_lines) | {c['text'] for c in script_cues(self.script) if c['text']})
        self.script_tokens = {t for line in self.script_lines for t in fold(line).split()}

        stale = {}
        if self.script:
            for k, v in self.script.items():
                if k == 'old_snippet' and isinstance(v, str):
                    for t in eval_tables(v, unknown='true').values():     # HOOK_LINES ? seq(...) : [] -> keep the hook
                        for c in t:
                            if c['text']:
                                stale.setdefault(c['text'], 'old_snippet in ' + os.path.basename(self.script_path))
                elif k != 'words' and k.endswith('words') and isinstance(v, list):
                    for w in v:
                        tx = w.get('text') if isinstance(w, dict) else (w[1] if isinstance(w, list) and len(w) > 1 else None)
                        if isinstance(tx, str):
                            stale.setdefault(tx, f'{k} in ' + os.path.basename(self.script_path))
        for line in audit_lines(key):
            stale.setdefault(line, 'mined_line_audit.md')
        for c in self.scene_cues:
            if c['text']:
                stale.setdefault(c['text'], f'cue table in {scene}.js, not in the script')
        # a stale line that is (nearly) a current line is not stale
        cur = [fold(x).replace(' ', '') for x in self.script_lines]
        cur_sp = [' ' + fold(x) + ' ' for x in self.script_lines]
        # picture text: the scene's (and its modules') string literals that are not cue lines. An old cue line that the
        # scene still draws as picture text (the old bill's FEDERAL RESERVE NOTE) is picture, not leftover
        # (only the scene's own files count as picture lines; lib modules add picture words, below)
        cue_norm = {norm(c['text']) for t in self.scene_tables.values() for c in t if c['text']}
        self.picture_lines, lib_lines = [], []
        for p in (scene_files(scene) if self.scene_js else []):
            own = os.path.dirname(p) == SCENES
            with open(p, errors='replace') as f:
                for lit in string_literals(f.read()):
                    if norm(lit) and norm(lit) not in cue_norm:
                        (self.picture_lines if own else lib_lines).append(' ' + fold(lit) + ' ')
        self.picture_lines += [' ' + fold(g) + ' ' for g in GLOBAL_PICTURE]
        self.stale = {}
        for line, why in stale.items():
            if len(fold(line).split()) and any(' ' + fold(line) + ' ' in pl for pl in self.picture_lines):
                continue
            f = fold(line).replace(' ', '')
            if len(f) < 3 or any(ratio(f, c) >= 0.85 for c in cur) or any(' ' + fold(line) + ' ' in c for c in cur_sp) \
                    or any(' ' + fold(line) + ' ' in ' ' + fold(g) + ' ' for g in GLOBAL_PICTURE):
                continue
            self.stale[line] = why

        # flagged lines; one the script itself uses, or the scene draws as picture text (the old bill's LEGAL TENDER
        # FOR ALL DEBTS), is linted once instead of flagged on every frame
        self.banned, self.banned_known = [], []   # (phrase, category, known): the FLAGGED lines
        for cat, phrases in FLAGGED.items():
            for p in phrases:
                pat = ' ' + fold(p) + ' '
                where = 'the script' if any(pat in ' ' + fold(x) + ' ' for x in self.script_lines) else \
                    'picture text in the scene' if any(pat in pl for pl in self.picture_lines) else None
                self.banned.append((p, cat, bool(where)))
                if where:
                    self.banned_known.append((p, cat, where))

        stale_norm = {norm(x) for x in self.stale}
        pic = {t for pl in self.picture_lines + lib_lines if norm(pl) not in stale_norm for t in pl.split() if len(t) >= 2}
        self.picture_tokens = pic - self.script_tokens

    # ------------------------------------------------------------ static checks
    def drift(self):
        """Script frames vs the scene's cue table (beat for beat)."""
        if not (self.script and self.scene_cues):
            return []
        sc = script_cues(self.script)
        out = []
        sm = {}
        for c in self.scene_cues:
            sm.setdefault(round(c['s'], 3), []).append(c)
        tm = {}
        for c in sc:
            tm.setdefault(round(c['s'], 3), []).append(c)
        for c in sc:
            if not c['text']:
                continue
            got = [x for x in sm.get(round(c['s'], 3), []) if x['text']]
            if not got:
                near = [x for x in self.scene_cues if x['text'] and norm(x['text']) == norm(c['text']) and abs(x['s'] - c['s']) <= 4]
                out.append({'beat': c['s'], 'script': c['text'],
                            'scene': (f"at beat {near[0]['s']:g}" if near else None),
                            'issue': 'moved' if near else 'missing from scene'})
            elif not any(norm(x['text']) == norm(c['text']) for x in got):
                out.append({'beat': c['s'], 'script': c['text'], 'scene': got[0]['text'], 'issue': 'different text'})
        for c in self.scene_cues:
            if c['text'] and not any(x['text'] for x in tm.get(round(c['s'], 3), [])):
                if not any(norm(x['text'] or '') == norm(c['text']) and abs(x['s'] - c['s']) <= 4 for x in sc):
                    out.append({'beat': c['s'], 'script': None, 'scene': c['text'], 'issue': 'not in script'})
        return sorted(out, key=lambda d: d['beat'])

    def lint(self):
        """Script-level notes: flagged lines inside the script (information; there is no word-count lint)."""
        out = []
        for p, cat, where in self.banned_known:
            out.append({'beat': None, 'text': p, 'issue': f'flagged line ({cat}) in {where}: take a look'})
        return out


# ================================================================ OCR
def _hsv(a):
    r, g, b = a[..., 0] / 255, a[..., 1] / 255, a[..., 2] / 255
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, (mx - mn) / (mx + 1e-6), mx


def _mask(m):
    return Image.fromarray(np.where(m, 0, 255).astype(np.uint8))


TIER1 = re.compile(r'^(gray|light\d+|hue\d+)$')     # tier 2 is everything else: dark ink, opened and closed masks


def variants(im, scale, tier=None):
    """Binarised views of one frame: text as black on white, whatever its colour. tier 1 = the plain masks,
    tier 2 = dark ink plus morphologically opened/closed masks, None = both."""
    out = _variants(im, scale)
    if tier is None:
        return out
    return {k: v for k, v in out.items() if bool(TIER1.match(k)) == (tier == 1)}


def _variants(im, scale):
    im = im.convert('RGB')
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    lum = a @ np.array([0.299, 0.587, 0.114], np.float32)
    out = {'gray': Image.fromarray(lum.clip(0, 255).astype(np.uint8))}
    for th in (170, 205):
        m = lum > th
        if 0.002 < m.mean() < 0.6:
            out[f'light{th}'] = _mask(m)
    m = lum < 80
    if 0.002 < m.mean() < 0.6:
        out['dark80'] = _mask(m)
    h, s, v = _hsv(a)
    viv = (s > 0.4) & (v > 0.55)
    for c in range(0, 360, 60):      # red, yellow (orange falls in both), green, cyan, blue, magenta
        m = viv & (np.abs((h - c + 180) % 360 - 180) < 36)
        if 0.003 < m.mean() < 0.4:
            out[f'hue{c}'] = _mask(m)
    k = 5 if scale >= 0.45 else 3
    for name in [n for n in out if n != 'gray']:
        out[name + '+open'] = out[name].filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))
    if 'light170' in out:     # stencil gaps and broken glitch slices: close them
        out['light170+close'] = out['light170'].filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MaxFilter(k))
    return out


def tesseract(img, psm=11):
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    env = dict(os.environ, OMP_THREAD_LIMIT='1')
    r = subprocess.run(['tesseract', 'stdin', 'stdout', '--psm', str(psm), '-l', 'eng', 'tsv'],
                       input=buf.getvalue(), capture_output=True, env=env)
    rows = csv.DictReader(io.StringIO(r.stdout.decode('utf8', 'replace')), delimiter='\t', quoting=csv.QUOTE_NONE)
    toks = []
    ih = max(1, img.height)
    for w in rows:
        try:
            conf = float(w.get('conf') or -1)
        except ValueError:
            continue
        t = (w.get('text') or '').strip()
        if conf < 0 or not t:
            continue
        toks.append({'text': t, 'f': fold(t).replace(' ', ''), 'conf': conf, 'rh': int(w['height']) / ih, 'key': (int(w['block_num']), int(w['par_num']), int(w['line_num']), int(w['word_num'])),
                     'box': (int(w['left']), int(w['top']), int(w['width']), int(w['height']))})
    toks.sort(key=lambda x: x['key'])
    return toks


MASKS_VERSION = 3        # bump when variants() changes: the on-disk OCR cache is keyed on it


class OCR:
    """tesseract over the masks of a frame, cached by frame content in memory and in <report dir>/.ocr_cache.json,
    so re-scoring the same frames (a script edit, a new threshold) costs no OCR."""

    def __init__(self, jobs=4, cache_file=None):
        if not shutil.which('tesseract'):
            raise SystemExit('tesseract is not installed: apt-get install -y tesseract-ocr')
        self.pool = ThreadPoolExecutor(max(1, jobs))
        self.cache_file = cache_file
        self.cache = {}
        self.disk = {}
        if cache_file and os.path.exists(cache_file):
            try:
                with open(cache_file) as f:
                    self.disk = json.load(f)
            except Exception:
                self.disk = {}

    def save(self):
        if self.cache_file:
            try:
                with open(self.cache_file, 'w') as f:
                    json.dump(self.disk, f)
            except Exception:
                pass

    def read(self, path, passes=((0.33, 1),)):
        """{variant@scale: tokens} for one image over the given (scale, tier) passes, cached by content."""
        with open(path, 'rb') as f:
            h = hashlib.sha1(f.read()).hexdigest()
        out = {}
        im = None
        for sc, tier in passes:
            ck = (h, sc, tier)
            dk = f'{h}:{sc}:{tier}:{MASKS_VERSION}'
            if ck not in self.cache and dk in self.disk:
                self.cache[ck] = self.disk[dk]
            if ck not in self.cache:
                im = im or Image.open(path)
                vs = variants(im, sc, tier)
                res = list(self.pool.map(tesseract, vs.values()))
                self.cache[ck] = self.disk[dk] = {f'{k}@{sc}': r for k, r in zip(vs, res)}
            out.update(self.cache[ck])
        return out


# ================================================================ one frame: score + strays
def coverage(expected, toks):
    """Share of the expected words found (each at ratio >= 0.8) among the tokens, weighted by length (min 2)."""
    ew = fold(expected).split()
    R = [fold(t).replace(' ', '') for t in toks if fold(t)]
    R2 = R + [a + b for a, b in zip(R, R[1:])] + [p for t in toks for p in fold(t).split()]   # merged and split forms
    if not ew or not R:
        return 0.0, []
    tot = got = 0.0
    hit = []
    for w in ew:
        # a word counts at 1.0 when it sits whole inside a run-together token (ONEHAND, POST-ECONOMICS)
        b, bt = max(((1.0 if len(w) >= 3 and w in r else ratio(w, r), r) for r in R2), default=(0.0, ''))
        tot += max(2, len(w))
        if b >= 0.8:
            got += max(2, len(w)) * b
            hit.append(bt)
    return got / tot, hit


def score_frame(reads, expected, min_rh=0.0):
    """Fuzzy score (0-100) of the expected line over all masks, and the text that matched.
    R = best character ratio of the line against a run of read words (any mask); C = share of the line's words
    read anywhere in the frame. score = min(max(R, C), 0.4 + 0.6 C): a close character match cannot pass when
    whole words are missing (WE PRINT IT vs PRINT). Only words at least min_rh of the frame height tall count
    (cue type is big; small print on a banknote or a sign is picture)."""
    best = (0.0, '', '')
    union = []
    reads = {k: [t for t in v if t.get('rh', 1) >= min_rh] for k, v in reads.items()}
    for var, toks in reads.items():
        tx = [t['text'] for t in toks]
        union += [t['text'] for t in toks if t['conf'] >= 50]
        r, i, j = window_score(expected, [t['f'] for t in toks], floor=best[0], folded=True)
        if r > best[0]:
            best = (r, ' '.join(tx[i:j]), var)
    c, hit = coverage(expected, union)
    sc = min(max(best[0], c), 0.4 + 0.6 * c)
    got, var = (best[1], best[2]) if best[0] >= c else (' '.join(dict.fromkeys(hit)), 'words')
    ef = fold(expected).replace(' ', '')
    if len(ef) <= 3:        # AI. / TWO. : a short line has to be read exactly
        exact = any(t['f'] == ef and t['conf'] >= 60 for toks in reads.values() for t in toks)
        sc, got, var = (1.0, expected, 'exact') if exact else (min(sc, 0.5), got, var)
    return round(sc * 100), got, var


def close_to(w, vocab):
    """w is a vocabulary word, a misread of one (ratio >= 0.75) or a clipped piece of one (FEDERAL -> ERAL, KGAL)."""
    if w in vocab:
        return True
    for v in vocab:
        if abs(len(v) - len(w)) <= 2 and ratio(w, v) >= 0.75:
            return True
        if len(v) > len(w) >= 3:
            lcs = SequenceMatcher(None, w, v, autojunk=False).find_longest_match(0, len(w), 0, len(v)).size
            if lcs >= (len(w) if len(w) <= 3 else len(w) - 1):
                return True
    return False


def strays(ctx, reads, expected, min_conf, min_rh=0.0):
    """Words read on screen that are not the expected line, classed LEFTOVER/FLAGGED/SCRIPT/PICTURE/EXTRA.
    Flagged lines are looked for in print of any size; the rest only in cue-sized type (>= min_rh)."""
    found = {}
    exp_tokens = fold(expected or '').split()
    # phrases first (flagged, stale lines), on each mask's reading order
    for var, alltoks in reads.items():
        alltoks = [t for t in alltoks if t['conf'] >= 40 and t['f'] and t.get('rh', 1) >= 0.012]
        toks = [t for t in alltoks if t.get('rh', 1) >= min_rh]
        tx = [t['text'] for t in toks]
        fx = [t['f'] for t in toks]
        confs = [t['conf'] for t in toks]
        btx, bfx, bconfs = [t['text'] for t in alltoks], [t['f'] for t in alltoks], [t['conf'] for t in alltoks]
        for p, cat, ins in ctx.banned:
            if ins:
                continue
            fp = fold(p).replace(' ', '')
            n = len(fold(p).split())
            if n == 1:
                for t in alltoks:
                    ft = t['f']
                    if (ft == fp and t['conf'] >= (80 if len(fp) <= 4 else 60)) or \
                            (len(fp) >= 6 and ratio(ft, fp) >= 0.92 and t['conf'] >= 60):
                        found.setdefault(('FLAGGED', p), {'class': 'FLAGGED', 'text': t['text'], 'why': cat, 'conf': round(t['conf'])})
            else:
                r, i, j = window_score(p, bfx, same_len=True, floor=0.9199, folded=True)
                if r >= 0.92 and min(bconfs[i:j] or [0]) >= 40:
                    found.setdefault(('FLAGGED', p), {'class': 'FLAGGED', 'text': ' '.join(btx[i:j]), 'why': cat,
                                                     'conf': round(min(bconfs[i:j]))})
        for line, why in ctx.stale.items():
            if expected and ratio(fold(line).replace(' ', ''), fold(expected).replace(' ', '')) >= 0.8:
                continue
            fl = fold(line).replace(' ', '')
            need = 0.9 if len(fl) >= 6 else 1.0
            r, i, j = window_score(line, fx, same_len=True, floor=need - 1e-4, folded=True)
            ww = fold(' '.join(tx[i:j])).split()
            inside = exp_tokens and all(any(ratio(w, e) >= 0.8 for e in exp_tokens) for w in ww)
            # PARTY. read for the old A PARTY: every word read is a current script word and the old line only adds
            # a one- or two-letter word, so nothing old is actually on screen
            missing = [w for w in fold(line).split() if not any(ratio(w, x) >= 0.8 for x in ww)]
            inside = inside or (all(w in ctx.script_tokens for w in ww) and all(len(w) <= 2 for w in missing))
            if r >= need and min(confs[i:j] or [0]) >= 50 and len(fl) >= 4 and not inside:
                found.setdefault(('LEFTOVER', line), {'class': 'LEFTOVER', 'text': ' '.join(tx[i:j]), 'line': line,
                                                      'why': why, 'conf': round(min(confs[i:j]))})
    phrase_words = {w for x in found.values() for w in fold(x['text']).split()}
    # then single confident words
    for var, toks in reads.items():
        for t in toks:
            if t['conf'] < min_conf or t.get('rh', 1) < min_rh:
                continue
            letters = re.sub(r'[^A-Za-z]', '', t['text'])
            for raw in norm(t['text']).split():
                w = fold(raw)
                year = re.fullmatch(r'(19|20)\d\d', raw)
                if re.search(r'\d', raw) and not year:
                    continue       # HUD numbers, temperatures, timecodes
                if not year and (len(w) < 3 or not re.search(r'[AEIOUY]', w)):
                    continue
                if w in phrase_words or any(ratio(w, e) >= (0.75 if year else 0.8) or w in e for e in exp_tokens) \
                        or any(w in fold(x.get('line') or x['text']).replace(' ', '') for x in found.values()) \
                        or any(ratio(w, pw) >= 0.75 for pw in phrase_words):
                    continue       # the expected line, or a fragment/misread of a phrase already reported
                if close_to(w, ctx.script_tokens):
                    cls = 'SCRIPT'
                elif close_to(w, ctx.picture_tokens):
                    cls = 'PICTURE'
                else:
                    # OCR noise is mostly short and mixed case; screen copy is upper case
                    upper = letters and sum(ch.isupper() for ch in letters) / len(letters) >= 0.7
                    if not year and (not upper or len(w) < 4 and t['conf'] < 90):
                        continue
                    cls = 'EXTRA'
                found.setdefault((cls, w), {'class': cls, 'text': raw, 'conf': round(t['conf'])})
    return list(found.values())


# ================================================================ sampling
def sample_times(c, spb, samples, offset=0.0):
    t0, t1 = c['s'] * spb, c['e'] * spb
    if samples <= 1:
        fr = [0.5]
    else:
        fr = [0.3 + 0.45 * i / (samples - 1) for i in range(samples)]
    return [round(t0 + (t1 - t0) * f + offset, 2) for f in fr]


def render_stills(scene, times, dest, keep=False, log=None, timeout=3600):
    """node web/render.mjs SCENE --stills t1,t2,... ; stills moved into dest. Returns {t: path}."""
    times = sorted(set(times))
    stills = os.path.join(OUT, 'stills')
    os.makedirs(stills, exist_ok=True)
    os.makedirs(dest, exist_ok=True)
    names = {t: f'{scene}_{t:.2f}.jpg' for t in times}
    backup = {}
    bdir = os.path.join(dest, '.backup')
    if not keep:
        for t, n in names.items():
            p = os.path.join(stills, n)
            if os.path.exists(p):
                os.makedirs(bdir, exist_ok=True)
                shutil.copy2(p, os.path.join(bdir, n))
                backup[n] = p
    got = {}
    t_start = time.time()
    try:
        cmd = [NODE, os.path.join(WEB, 'render.mjs'), scene, '--stills', ','.join(f'{t:.2f}' for t in times)]
        with open(log or os.devnull, 'a') as lf:
            lf.write('$ ' + ' '.join(cmd) + '\n')
            lf.flush()
            r = subprocess.run(cmd, cwd=VIDEOS, stdout=lf, stderr=subprocess.STDOUT, timeout=timeout)
        for t, n in names.items():
            p = os.path.join(stills, n)
            if os.path.exists(p) and os.path.getmtime(p) >= t_start - 1:
                q = os.path.join(dest, 'frames', n)
                os.makedirs(os.path.dirname(q), exist_ok=True)
                shutil.copy2(p, q)
                got[t] = q
        if r.returncode != 0 and not got:
            raise RuntimeError(f'render.mjs exited {r.returncode}; see {log}')
    finally:
        if not keep:
            for t, n in names.items():
                p = os.path.join(stills, n)
                if n in backup:
                    shutil.copy2(os.path.join(bdir, n), p)
                elif os.path.exists(p):
                    os.remove(p)
            shutil.rmtree(bdir, ignore_errors=True)
    return got


def probe(mp4):
    r = subprocess.run([FFMPEG, '-hide_banner', '-i', mp4], capture_output=True, text=True)
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r.stderr)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else None
    m = re.search(r'([\d.]+) fps', r.stderr)
    fps = float(m.group(1)) if m else 30.0
    return dur, fps


def extract_frames(mp4, times, dest):
    """One ffmpeg pass: the frames nearest each time -> dest/frames/t_XX.XX.jpg. Returns {t: path}."""
    dur, fps = probe(mp4)
    os.makedirs(os.path.join(dest, 'frames'), exist_ok=True)
    want = {}
    for t in sorted(set(times)):
        if t < 0 or (dur and t > dur - 0.5 / fps):
            continue
        want.setdefault(int(round(t * fps)), []).append(t)
    if not want:
        return {}
    ns = sorted(want)
    tmp = os.path.join(dest, 'frames', '_n%05d.jpg')
    sel = '+'.join(f'eq(n\\,{n})' for n in ns)
    r = subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', mp4, '-vf', f'select={sel}', '-fps_mode', 'passthrough',
                        '-q:v', '2', '-start_number', '0', tmp], capture_output=True, text=True)
    got = {}
    for k, n in enumerate(ns):
        p = tmp % k
        if not os.path.exists(p):
            continue
        for t in want[n]:
            q = os.path.join(dest, 'frames', f't_{t:06.2f}.jpg')
            shutil.copy2(p, q)
            got[t] = q
        os.remove(p)
    return got


# ================================================================ the check
def run_check(args, target, key, scene, published):
    label = os.path.splitext(os.path.basename(target))[0] if published else scene
    dest = args.out if args.out and not args.batch else os.path.join(REPORTS, label)
    ctx = Context(scene, key, args.cues, args.bpm, args.last_hold, make_audio=not published and not args.dry_run)
    cues = with_gaps(ctx.cues) if not args.no_blank else [c for c in ctx.cues if c['text']]
    cues = [c for c in cues if c['e'] > c['s'] and (args.from_beat is None or c['s'] >= args.from_beat)
            and (args.to_beat is None or c['s'] < args.to_beat)]
    rep = {'target': os.path.relpath(target, ROOT) if published else scene, 'mode': 'published' if published else 'scene',
           'scene': scene, 'key': key, 'script': os.path.relpath(ctx.script_path, ROOT) if ctx.script_path else None,
           'cue_source': ctx.cue_source, 'bpm': ctx.bpm, 'notes': list(ctx.notes), 'drift': ctx.drift(), 'lint': ctx.lint(),
           'frames': [], 'strays': [], 'scan': []}
    if published:
        dur, fps = probe(target)
        rep['duration'] = dur
        last = max((c['e'] for c in ctx.cues if c['text']), default=0) * ctx.spb + args.offset
        if dur and last > dur + 0.5:
            rep['notes'].append(f'the script runs to {last:.2f}s but the file is {dur:.2f}s: an older cut, or a different BPM (--bpm)')
    if args.dry_run:
        for c in cues:
            rep['frames'].append({'beat': c['s'], 'beat_end': c['e'], 't': sample_times(c, ctx.spb, args.samples, args.offset),
                                  'expected': c['text']})
        return rep, ctx

    os.makedirs(dest, exist_ok=True)
    for old in glob.glob(os.path.join(dest, 'frames', '*.jpg')):
        os.remove(old)
    log = os.path.join(dest, 'render.log')
    if os.path.exists(log):
        os.remove(log)
    ocr = OCR(args.jobs, os.path.join(dest, '.ocr_cache.json'))

    def grab(times):
        if published:
            return extract_frames(target, times, dest)
        got = render_stills(scene, times, dest, args.keep_stills, log, args.render_timeout)
        h = hits_for(scene)
        if h and not args.bpm and abs(h['bpm'] - ctx.bpm) > 1e-6:
            rep['notes'].append(f'render.mjs rebuilt the beat map at {h["bpm"]} BPM (was {ctx.bpm}); rerun the check')
        return got

    # every frame is grabbed in one go (one render / one decode): the sample points, plus the two retry points a
    # failed text frame falls back to (30% and 75% of its hold)
    plan = []
    for c in cues:
        ts = sample_times(c, ctx.spb, args.samples, args.offset)
        rt = [t for t in sample_times(c, ctx.spb, 2, args.offset) if t not in ts] if c['text'] and not args.no_retry else []
        plan.append((c, ts, rt))
    frames = grab([t for _, ts, rt in plan for t in ts + rt])

    def judge(c, ts, frames, retry=False):
        best = None
        for t in ts:
            p = frames.get(t)
            if not p:
                continue
            # escalate only while the line is not found: plain masks at 1/3 scale, then dark/opened/closed masks,
            # then 1/2 scale (skipped when the frame already shows an old or banned line: it is wrong either way)
            passes = [(0.33, 1)]
            reads = ocr.read(p, passes)
            sc, got, var = score_frame(reads, c['text'], args.min_height) if c['text'] else (None, '', '')
            st = None
            for more in ((0.33, 2), (0.5, 1)):
                if not c['text'] or sc >= args.threshold:
                    break
                # escalate only when something like the line is there (a retry needs a closer miss): a frame
                # showing other copy stays a miss at any scale, and each pass costs ~10 tesseract runs
                if sc < (60 if retry or more[0] == 0.5 else 0):
                    break
                if more[0] == 0.5:
                    st = strays(ctx, reads, c['text'], args.min_conf, args.min_height)
                    if any(x['class'] in ('LEFTOVER', 'FLAGGED') for x in st):
                        break
                passes.append(more)
                reads = ocr.read(p, passes)
                sc, got, var = score_frame(reads, c['text'], args.min_height)
                st = None
            st = st if st is not None else strays(ctx, reads, c['text'], args.min_conf, args.min_height)
            if not c['text']:
                # a gap: any script line read clearly there is off its beat
                for line in ctx.script_lines:
                    s2, g2, _ = score_frame(reads, line, args.min_height)
                    if s2 >= 90 and len(fold(line).replace(' ', '')) >= 4:
                        st.append({'class': 'SCRIPT', 'text': g2, 'line': line, 'why': 'script line inside a silent gap'})
            cand = {'t': t, 'frame': os.path.relpath(p, dest), 'score': sc, 'read': got, 'mask': var, 'strays': st}
            key_ = (sc if sc is not None else 100) - 50 * sum(s['class'] in ('LEFTOVER', 'FLAGGED') for s in st)
            if best is None or key_ > best[0]:
                best = (key_, cand)
        return best[1] if best else None

    results = []
    for c, ts, rt in plan:
        r = judge(c, ts, frames)
        if rt and (r is None or (r['score'] < args.threshold
                                 and not any(x['class'] in ('LEFTOVER', 'FLAGGED') for x in r['strays']))):
            r2 = judge(c, rt, frames, retry=True)      # retry: an old or banned line at the mid-point is conclusive, no retry
            if r2 and (r is None or (r2['score'] or 0) > (r['score'] or 0)):
                r = r2
            if r:
                r['retried'] = True
        results.append([c, ts, r])

    for c, ts, r in results:
        row = {'beat': c['s'], 'beat_end': c['e'], 'expected': c['text']}
        if r is None:
            row.update({'t': ts, 'status': 'FAIL', 'score': None, 'read': '', 'why': 'no frame (past the end of the file?)'})
        else:
            # stale (LEFTOVER) and FLAGGED lines are advisory since 28 Sep: reported, never a frame failure
            bad = [s for s in r['strays'] if (args.strict and s['class'] == 'EXTRA')
                   or (not c['text'] and s['class'] == 'SCRIPT' and s.get('line'))]
            ok = (r['score'] is None or r['score'] >= args.threshold) and not bad
            row.update(r)
            row['status'] = 'PASS' if ok else 'FAIL'
        rep['frames'].append(row)

    # optional end-to-end scan
    if args.scan:
        end = probe(target)[0] if published else (ctx.hits or {}).get('duration', max(c['e'] for c in ctx.cues) * ctx.spb)
        ts = [round(x * args.scan, 2) for x in range(int(end / args.scan) + 1)]
        sframes = grab(ts)
        for t in ts:
            p = sframes.get(t)
            if not p:
                continue
            reads = ocr.read(p)
            beat = (t - args.offset) / ctx.spb
            live = [c for c in ctx.cues if c['text'] and c['s'] <= beat < c['e']]
            exp = live[0]['text'] if live else None
            st = strays(ctx, reads, exp, args.min_conf, args.min_height)
            words = sorted({w for toks in reads.values() for tk in toks if tk['conf'] >= args.min_conf
                            for w in fold(tk['text']).split() if len(w) >= 3 and re.search(r'[AEIOUY]', w)})
            rep['scan'].append({'t': t, 'beat': round(beat, 2), 'expected': exp, 'words': words, 'strays': st,
                                'frame': os.path.relpath(p, dest)})
        # where did each failed line actually show up?
        for row in rep['frames']:
            if row['status'] == 'FAIL' and row['expected']:
                seen = []
                for s in rep['scan']:
                    reads = ocr.read(os.path.join(dest, s['frame']))
                    sc, _, _ = score_frame(reads, row['expected'], args.min_height)
                    if sc >= args.threshold:
                        seen.append(s['t'])
                row['seen_at'] = seen

    # collect strays across frames
    agg = {}
    for row in rep['frames'] + rep['scan']:
        for s in row.get('strays', []):
            k = (s['class'], s.get('line') or s['text'])
            a = agg.setdefault(k, dict(s, times=[]))
            a['times'].append(row['t'] if not isinstance(row['t'], list) else row['t'][0])
    order = {'FLAGGED': 0, 'LEFTOVER': 1, 'SCRIPT': 2, 'EXTRA': 3, 'PICTURE': 4}
    rep['strays'] = sorted(agg.values(), key=lambda s: (order[s['class']], s['times'][0]))
    fails = [f for f in rep['frames'] if f['status'] == 'FAIL']
    scan_bad = [s for s in rep['strays'] if args.strict and s['class'] == 'EXTRA']
    rep['summary'] = {'frames': len(rep['frames']), 'text_frames': sum(1 for f in rep['frames'] if f['expected']),
                      'pass': len(rep['frames']) - len(fails), 'fail': len(fails),
                      'leftover': sum(1 for s in rep['strays'] if s['class'] == 'LEFTOVER'),
                      'flagged': sum(1 for s in rep['strays'] if s['class'] == 'FLAGGED'),
                      'extra': sum(1 for s in rep['strays'] if s['class'] == 'EXTRA'),
                      'verdict': 'FAIL' if fails or scan_bad else 'PASS'}
    with open(os.path.join(dest, 'report.json'), 'w') as f:
        json.dump(rep, f, indent=1, default=str)
    try:
        contact_sheet(rep, dest)
    except Exception as e:      # the sheet is a convenience
        rep['notes'].append(f'sheet failed: {e}')
    shrink_frames(dest)
    ocr.save()
    rep['report_dir'] = os.path.relpath(dest, ROOT)
    return rep, ctx


def shrink_frames(dest, w=540):
    """Keep the report light: the frames are re-saved at half size once they have been read."""
    for p in glob.glob(os.path.join(dest, 'frames', '*.jpg')):
        try:
            im = Image.open(p)
            if im.width > w:
                im.convert('RGB').resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(p, quality=82)
        except Exception:
            pass


def contact_sheet(rep, dest, cols=6, tw=216, th=384):
    rows = [f for f in rep['frames'] if f.get('frame')]
    if not rows:
        return
    lab = 74
    n = len(rows)
    R = math.ceil(n / cols)
    sheet = Image.new('RGB', (cols * tw, R * (th + lab)), (16, 16, 16))
    try:
        font = ImageFont.truetype(FONT, 12)
    except Exception:
        font = ImageFont.load_default()
    d = ImageDraw.Draw(sheet)
    for k, f in enumerate(rows):
        x, y = (k % cols) * tw, (k // cols) * (th + lab)
        try:
            im = Image.open(os.path.join(dest, f['frame'])).convert('RGB').resize((tw, th))
            sheet.paste(im, (x, y))
        except Exception:
            pass
        col = (60, 200, 90) if f['status'] == 'PASS' else (230, 50, 40)
        d.rectangle([x, y + th, x + tw - 1, y + th + lab - 1], fill=(28, 28, 28))
        d.rectangle([x, y + th, x + 5, y + th + lab - 1], fill=col)
        sc = '' if f.get('score') is None else f" {f['score']}"
        t = f['t'] if not isinstance(f['t'], list) else f['t'][0]
        d.text((x + 9, y + th + 3), f"b{f['beat']:g} {t:.2f}s {f['status']}{sc}", fill=col, font=font)
        d.text((x + 9, y + th + 19), ('= ' + (f['expected'] or '(blank)'))[:28], fill=(235, 235, 235), font=font)
        d.text((x + 9, y + th + 35), ('> ' + (f.get('read') or ''))[:28], fill=(170, 170, 170), font=font)
        bad = [s for s in f.get('strays', []) if s['class'] in ('LEFTOVER', 'FLAGGED', 'EXTRA')]
        if bad:
            d.text((x + 9, y + th + 51), ('! ' + ' '.join(f"{s['class'][:4]}:{s['text']}" for s in bad))[:28],
                   fill=(255, 170, 60), font=font)
    sheet.save(os.path.join(dest, 'sheet.jpg'), quality=85)


# ================================================================ printing
def show(rep, ctx, args):
    w = sys.stdout.write
    s = rep.get('summary', {})
    w(f"\n== {rep['target']}  ({rep['mode']}; scene {rep['scene']}, script {rep['script'] or '-'}, "
      f"cues from {rep['cue_source']}, {rep['bpm']} BPM)\n")
    for n in rep['notes']:
        w(f'   note: {n}\n')
    if rep['drift']:
        w(f"   script vs scene cue table: {len(rep['drift'])} difference(s)\n")
        for d in rep['drift']:
            w(f"     b{d['beat']:<6g} {d['issue']:<18} script={d['script']!s:<24} scene={d['scene']!s}\n")
    for l in rep['lint']:
        w(f"   lint: {'b%g ' % l['beat'] if l['beat'] is not None else ''}{l['text']}: {l['issue']}\n")
    w(f"   {'beat':>6} {'time':>6}  {'expected':<24} {'read':<28} {'score':>5}  result\n")
    for f in rep['frames']:
        t = f['t'] if not isinstance(f['t'], list) else f['t'][0]
        exp = f['expected'] if f['expected'] else '(blank)'
        extra = ''
        if f.get('strays'):
            bad = [x for x in f['strays'] if x['class'] in ('LEFTOVER', 'FLAGGED', 'EXTRA') or x.get('line')]
            if bad:
                extra = '  ' + ', '.join(f"{x['class']}:{x['text']}" for x in bad)[:90]
        if f.get('seen_at') is not None and f['status'] == 'FAIL':
            extra += f"  seen at {', '.join('%.2fs' % x for x in f['seen_at'][:6]) or 'nowhere'}"
        if 'status' not in f:
            w(f"   {f['beat']:>6g} {t:>6.2f}  {exp:<24}\n")
            continue
        sc = '' if f.get('score') is None else f['score']
        w(f"   {f['beat']:>6g} {t:>6.2f}  {exp[:24]:<24} {(f.get('read') or '')[:28]:<28} {sc!s:>5}  {f['status']}{extra}\n")
    if rep.get('strays'):
        w('   text on screen that is not the expected line:\n')
        for x in rep['strays']:
            if (x['class'] == 'PICTURE' or (x['class'] == 'SCRIPT' and not x.get('line'))) and not args.verbose:
                continue
            ts = ', '.join('%.2f' % t for t in sorted(set(x['times']))[:8])
            why = f" ({x.get('line') + ': ' if x.get('line') else ''}{x.get('why', '')})" if x.get('why') or x.get('line') else ''
            w(f"     {x['class']:<8} {x['text']!s:<26} at {ts}s{why}\n")
        npic = sum(1 for x in rep['strays'] if x['class'] == 'PICTURE')
        nscr = sum(1 for x in rep['strays'] if x['class'] == 'SCRIPT' and not x.get('line'))
        if (npic or nscr) and not args.verbose:
            w(f'     ({npic} PICTURE word(s) drawn by the scene/kit and {nscr} stray SCRIPT word(s) hidden; --verbose shows them)\n')
    if s:
        w(f"   => {s['verdict']}: {s['pass']}/{s['frames']} frames pass, {s['fail']} fail; "
          f"{s['leftover']} stale, {s['flagged']} flagged, {s['extra']} extra word(s). Report: {rep.get('report_dir')}\n")


def summary_line(rep):
    s = rep.get('summary', {})
    return (f"{s.get('verdict', '?'):<4} {rep['target']:<44} {s.get('pass', 0):>3}/{s.get('frames', 0):<3} pass  "
            f"fail={s.get('fail', 0):<3} stale={s.get('leftover', 0):<2} flagged={s.get('flagged', 0):<2} extra={s.get('extra', 0)}")


# ================================================================ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('target', help='scene name, or with --published an mp4 path or glob')
    ap.add_argument('key', nargs='?', help='script key (research/scripts_final/<key>.json) or a JSON path')
    ap.add_argument('--published', action='store_true')
    ap.add_argument('--scene')
    ap.add_argument('--cues', default='script', choices=['script', 'scene', 'hits'])
    ap.add_argument('--bpm', type=float)
    ap.add_argument('--offset', type=float, default=0.0)
    ap.add_argument('--samples', type=int, default=1)
    ap.add_argument('--no-retry', action='store_true')
    ap.add_argument('--threshold', type=float, default=80)
    ap.add_argument('--min-conf', type=float, default=75)
    ap.add_argument('--min-height', type=float, default=0.025)
    ap.add_argument('--scan', type=float)
    ap.add_argument('--no-blank', action='store_true')
    ap.add_argument('--strict', action='store_true')
    ap.add_argument('--from', dest='from_beat', type=float)
    ap.add_argument('--to', dest='to_beat', type=float)
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--out')
    ap.add_argument('--keep-stills', action='store_true')
    ap.add_argument('--last-hold', type=float, default=2.0, help='beats the last scripted frame holds (default 2)')
    ap.add_argument('--render-timeout', type=float, default=3600)
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--summary', action='store_true')
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    if args.published:
        files = sorted(glob.glob(args.target)) or ([args.target] if os.path.exists(args.target) else [])
        if not files:
            ap.error(f'no file matches {args.target}')
        targets = []
        for f in files:
            stem = re.sub(r'_share$', '', os.path.splitext(os.path.basename(f))[0])
            scene = args.scene or stem
            key = args.key or script_key(stem)   # TOOLING WM1: exact name first, then _vN / digits
            targets.append((os.path.abspath(f), key, scene))
    else:
        scene = args.target
        if not os.path.exists(os.path.join(SCENES, scene + '.js')):
            ap.error(f'no scene {scene}: expected {os.path.join(SCENES, scene + ".js")}')
        targets = [(scene, args.key or script_key(scene), scene)]
    args.batch = len(targets) > 1
    worst = 0
    reports = []
    for target, key, scene in targets:
        try:
            rep, ctx = run_check(args, target, key, scene, args.published)
        except SystemExit as e:
            print(f'ERROR {target}: {e}', file=sys.stderr)
            worst = max(worst, 2)
            continue
        except Exception as e:
            print(f'ERROR {target}: {type(e).__name__}: {e}', file=sys.stderr)
            worst = max(worst, 2)
            continue
        reports.append(rep)
        if args.json:
            continue
        if args.summary:
            print(summary_line(rep), flush=True)
        else:
            show(rep, ctx, args)
            sys.stdout.flush()
        if rep.get('summary', {}).get('verdict') == 'FAIL':
            worst = max(worst, 1)
    if args.json:
        json.dump(reports if len(reports) != 1 else reports[0], sys.stdout, indent=1, default=str)
        print()
    elif args.summary and len(reports) > 1:
        print(f"{sum(r.get('summary', {}).get('verdict') == 'PASS' for r in reports)}/{len(reports)} pass")
    sys.exit(worst)


if __name__ == '__main__':
    main()
