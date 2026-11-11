#!/usr/bin/env python3
"""Whole-piece review and version compare (TOOLING c6, 2026-09-29).

Sees a finished piece the way a viewer and a critic do, whole and beside its earlier versions, and writes what it
measures without judging it. It gates nothing and prints no PASS or FAIL: the numbers and pictures are for a person
to read.

    python3 videos/tools/piece_review.py list machines
    python3 videos/tools/piece_review.py sheet  "c6=out/farm/machines_share.mp4"
    python3 videos/tools/piece_review.py compare --piece machines \\
        "c6=out/farm/machines_share.mp4" \\
        "v1=archive:WHO_OWNS_THE_MACHINES_v1_share;script=git:e338eb8:research/scripts_final/machines.json" \\
        "06=archive:06_own_the_future;script=ocr"

A VERSION is  LABEL=SOURCE[;bpm=N][;closer=BEAT][;script=S]
  SOURCE   a video path (absolute, or relative to videos/ or the repo root), or archive:STEM for a file in the
           archive repo (flip-engineer/automated-content-pipeline-video-studies-archive, local clone; fetched through git-lfs into
           videos/out/.review_cache/ and deleted again after measuring unless --keep).
  script   what was on screen, so frames, holds and lines can be read against the picture:
             path.json               a scripts_final-style JSON ({words:[{beat,text,verbatim?}], bpm?, closer_beat?})
             git:REV:path.json       the same file as it was at REV (e.g. the commit a version was built from)
             path.json#old_snippet   a "beat: TEXT" snippet stored in a script field (old_snippet / new_snippet)
             path.txt                a plain "beat: TEXT" snippet file
             ocr                     transcribe the video with tesseract (approximate: stylised type is missed)
             none
           Default: a local render whose name resolves through script_key.py uses the current script (the report
           says so, since an older render may not match it); an archive file gets none.
  bpm      needed to turn script beats into seconds when the JSON has no bpm; otherwise read from the script, then
           from out/.<scene>.hits.json for local renders.

Writes into --out (default videos/review/<piece>_versions/; videos/review is untracked):
  <label>/sheet.jpg      full-run contact sheet, every tile labelled with time, beat and the line on screen
  <label>/strip.jpg      pacing strip: text frames as blocks, cuts as ticks, loudness as a filled envelope
  <label>/timeline.md    every text frame with beat, time, hold, cuts in the hold and loudness over it
  <label>/measures.json  everything measured (cached; re-measured only when the file or options change)
  compare_strips.jpg     the pacing strips of all versions on one seconds axis
  compare_frames.jpg     one row per version, tiles at the same fractions of each running time
  compare_lines.jpg      lines two or more versions share, side by side (needs scripts or OCR)
  compare.md             side-by-side numbers, the lines each version lost and gained against the reference
                         (the first version given), and lost numbers/dates and content words
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
ROOT = os.path.dirname(VIDEOS)
sys.path.insert(0, os.path.join(VIDEOS, 'scripts'))
try:
    from script_key import script_key, script_path          # noqa: E402
except Exception:                                            # pragma: no cover
    script_key = script_path = None


def _ffmpeg():
    for p in (os.environ.get('ACP_FFMPEG'),
              '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2',
              shutil.which('ffmpeg')):
        if p and os.path.exists(p):
            return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        raise SystemExit('piece_review: no ffmpeg found (set ACP_FFMPEG)')


FF = _ffmpeg()
ARCHIVE = os.environ.get('ACP_ARCHIVE_REPO', os.path.join(os.path.dirname(ROOT), 'automated-content-pipeline-video-studies-archive'))
ARCHIVE_REF = os.environ.get('ACP_ARCHIVE_REF', 'origin/main')
CACHE = os.path.join(VIDEOS, 'out', '.review_cache')
VERSION = 4   # bump when measures change shape, so caches re-measure

# Published names (archive file stems) per script key. Scene names resolve through script_key.py.
PUBLISHED = {
    'machines': ['WHO_OWNS_THE_MACHINES', '06_own_the_future'], 'machines_e1': ['WHO_OWNS_THE_MACHINES_FACTORY'],
    'ownfuture': ['OWN_THE_FUTURE', 'ownfuture', '06_own_the_future'], 'meltdown': ['MELTDOWN', 'meltdown'],
    'horde': ['HORDE', 'horde', '02_the_horde'], 'giant': ['THE_GIANT'], 'unfinished': ['SECOND_INDEPENDENCE_1776', 'unfinished', '03_united_gates'],
    'bank': ['PEOPLES_BANK', 'bank'], 'frontier': ['IRON_IS_HOT', 'frontier'], 'commonwealth': ['COMMON_WEALTH', 'commonwealth'],
    'red_wedge': ['RED_WEDGE', 'red_wedge'], 'empire': ['CIVILIZATION'], 'productive': ['PRODUCTIVE_FORCES', 'productive', '01_productive_forces'],
    'intelligence': ['ACCELERATE', 'intelligence', '04_intelligence_and_spirit'], 'acc_ident': ['ACC_IDENT', 'acc_ident'],
    'allpower': ['ALL_POWER'], 'ascended': ['ASCENDED', 'ascended', '07_ascended'], 'majority': ['THE_MAJORITY'],
    'rejuvenation': ['REJUVENATION', 'rejuvenation', '05_rejuvenation'],
}
SHORT_OK = set('AI WE OF TO US IT IS BY IN ON DO NO SO UP OR AN AT MY BE'.split())
STOP = set('A AN THE OF TO IN ON AT BY AND OR IT IS BE ARE WE US OUR YOU YOUR FOR ALL WITH FROM THAT THIS AS I ME MY '
           'HE HIS SHE HER THEY THEM THEIR ITS WAS WERE HAS HAVE NO NOT SO UP DO WHO WHAT'.split())


def font(px, mono=False):
    names = ('DejaVuSansMono-Bold.ttf',) if mono else ('DejaVuSans-Bold.ttf',)
    for d in ('/usr/share/fonts/truetype/dejavu/', '/usr/share/fonts/dejavu/'):
        for n in names:
            if os.path.exists(d + n):
                return ImageFont.truetype(d + n, px)
    return ImageFont.load_default()


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, **kw)


# ================================================================ sources
def archive_paths():
    r = run(['git', '-C', ARCHIVE, 'ls-tree', '-r', '--name-only', ARCHIVE_REF], text=True)
    if r.returncode:
        return []
    return [p for p in r.stdout.split('\n') if p.endswith('.mp4')]


def resolve_archive(stem):
    paths = archive_paths()
    if not paths:
        raise SystemExit(f'piece_review: archive repo not readable at {ARCHIVE} ({ARCHIVE_REF}); set ACP_ARCHIVE_REPO')
    hit = [p for p in paths if os.path.splitext(os.path.basename(p))[0] == stem] or \
          [p for p in paths if os.path.splitext(os.path.basename(p))[0].lower() == stem.lower()] or \
          [p for p in paths if p.endswith(stem) or p.endswith(stem + '.mp4')]
    if not hit:
        raise SystemExit(f'piece_review: archive:{stem} not found; try `piece_review.py list <piece>`')
    hit.sort(key=lambda p: (p.count('/'), p))     # videos/out/X before videos/out/archive/X
    return hit[0]


def fetch_archive(stem):
    """archive:STEM -> local mp4 in videos/out/.review_cache (git-lfs smudge). Returns (path, archive_path)."""
    ap = resolve_archive(stem)
    os.makedirs(CACHE, exist_ok=True)
    dst = os.path.join(CACHE, ap.replace('/', '__'))
    if os.path.exists(dst) and os.path.getsize(dst) > 10000:
        return dst, ap
    blob = run(['git', '-C', ARCHIVE, 'show', f'{ARCHIVE_REF}:{ap}']).stdout
    if blob.startswith(b'version https://git-lfs'):
        r = subprocess.run(['git', '-C', ARCHIVE, 'lfs', 'smudge', ap], input=blob, capture_output=True)
        if r.returncode or len(r.stdout) < 10000:
            raise SystemExit(f'piece_review: git lfs smudge failed for {ap}: {r.stderr.decode()[-300:]}')
        blob = r.stdout
    with open(dst + '.part', 'wb') as f:
        f.write(blob)
    os.replace(dst + '.part', dst)
    return dst, ap


def local_path(p):
    for c in (p, os.path.join(VIDEOS, p), os.path.join(ROOT, p)):
        if os.path.exists(c):
            return os.path.abspath(c)
    raise SystemExit(f'piece_review: no such video {p}')


def parse_spec(spec):
    if '=' not in spec.split(';')[0]:
        raise SystemExit(f'piece_review: version needs LABEL=SOURCE, got {spec!r}')
    head, *opts = spec.split(';')
    label, src = head.split('=', 1)
    o = {'label': label.strip(), 'source': src.strip()}
    for kv in opts:
        if '=' in kv:
            k, v = kv.split('=', 1)
            o[k.strip()] = v.strip()
    return o


# ================================================================ scripts
SNIP = re.compile(r'^\s*(-?\d+(?:\.\d+)?)\s*:\s*(.+?)\s*$')


def parse_snippet(text):
    words = []
    for ln in text.split('\n'):
        if ln.strip().startswith('//'):
            continue
        m = SNIP.match(ln)
        if m:
            words.append({'beat': float(m.group(1)), 'text': m.group(2)})
    return words


def load_script(s, video_stem=None):
    """-> dict(words=[{beat,text,verbatim?}], bpm, closer, origin) or None."""
    if not s or s == 'none':
        return None
    if s == 'ocr':
        return {'ocr': True, 'origin': 'ocr'}
    field = None
    if '#' in s:
        s, field = s.split('#', 1)
    if s.startswith('git:'):
        _, rev, path = s.split(':', 2)
        r = run(['git', '-C', ROOT, 'show', f'{rev}:{path}'], text=True)
        if r.returncode:
            raise SystemExit(f'piece_review: git show {rev}:{path} failed: {r.stderr.strip()}')
        raw, origin = r.stdout, f'{path} at {rev}'
    else:
        p = local_path(s) if not os.path.isabs(s) else s
        raw, origin = open(p).read(), os.path.relpath(p, ROOT)
    try:
        d = json.loads(raw)
    except ValueError:
        return {'words': parse_snippet(raw), 'origin': origin, 'bpm': None, 'closer': None}
    if field:
        return {'words': parse_snippet(d.get(field) or ''), 'origin': f'{origin} #{field}', 'bpm': None,
                'closer': None, 'snippet_head': (d.get(field) or '').split('\n')[0]}
    return {'words': [{'beat': float(w['beat']), 'text': w['text'] or '', 'verbatim': bool(w.get('verbatim'))}
                      for w in d.get('words', []) if 'beat' in w and 'text' in w],
            'bpm': d.get('bpm'), 'closer': d.get('closer_beat'), 'origin': origin}


def snippet_meta(head):
    """'// v1 ..., 126 BPM, lockup b52' -> (126, 52)."""
    bpm = re.search(r'(\d+(?:\.\d+)?)\s*BPM', head or '')
    lock = re.search(r'lockup\s*b(\d+(?:\.\d+)?)', head or '')
    return (float(bpm.group(1)) if bpm else None), (float(lock.group(1)) if lock else None)


def hits_bpm(scene):
    p = os.path.join(VIDEOS, 'out', f'.{scene}.hits.json')
    try:
        return float(json.load(open(p)).get('bpm'))
    except Exception:
        return None


def logo_beat(scene):
    try:
        return json.load(open(os.path.join(VIDEOS, 'web', 'audio', 'logo_at.json'))).get(scene)
    except Exception:
        return None


# ================================================================ measuring
def probe(path):
    e = run([FF, '-hide_banner', '-i', path], text=True).stderr
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', e)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    m = re.search(r'Video: .*?, (\d{2,5})x(\d{2,5})', e)
    wh = (int(m.group(1)), int(m.group(2))) if m else (1080, 1920)
    m = re.search(r'(\d+(?:\.\d+)?) fps', e)
    return dur, wh, float(m.group(1)) if m else 30.0, 'Audio:' in e


def decode(path, fps, w):
    """One pass: frames at `fps` scaled to width w -> (times, uint8 N x h x w x 3)."""
    _, (W, H), _, _ = probe(path)
    h = int(round(w * H / W / 2)) * 2
    r = run([FF, '-hide_banner', '-i', path, '-an', '-vf', f'fps={fps},scale={w}:{h}:flags=area',
             '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    n = len(r.stdout) // (w * h * 3)
    arr = np.frombuffer(r.stdout[:n * w * h * 3], np.uint8).reshape(n, h, w, 3)
    return [(i + 0.5) / fps for i in range(n)], arr


def cuts_of(path, thr=0.3):
    e = run([FF, '-hide_banner', '-i', path, '-an', '-vf', f"scale=160:-2,select='gt(scene\\,{thr})',showinfo",
             '-f', 'null', '-'], text=True).stderr
    return [round(float(x), 2) for x in re.findall(r'pts_time:\s*([\d.]+)', e)]


def loudness(path):
    e = run([FF, '-hide_banner', '-nostats', '-i', path, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
            text=True).stderr
    s = e[e.rfind('Summary:'):] if 'Summary:' in e else ''
    g = lambda pat: (float(re.search(pat, s, re.S).group(1)) if re.search(pat, s, re.S) else None)
    raw = run([FF, '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-']).stdout
    y = np.frombuffer(raw, np.float32)
    n = 2000   # 0.25 s
    rms = [round(float(20 * np.log10(np.sqrt(np.mean(y[i:i + n] ** 2)) + 1e-9)), 1) for i in range(0, len(y) - n + 1, n)]
    return {'I': g(r'I:\s*(-?[\d.]+) LUFS'), 'LRA': g(r'LRA:\s*(-?[\d.]+) LU'), 'TP': g(r'Peak:\s*(-?[\d.]+|-inf)'),
            'rms_q': rms}


def picture_stats(arr):
    """Per frame: luma p2/p50/p98, detail (mean |Laplacian| of luma at the decode size), colourfulness, ACP-red share."""
    try:
        import cv2
    except Exception:
        cv2 = None
    out = []
    for f in arr:
        f32 = f.astype(np.float32)
        Y = 0.2126 * f32[..., 0] + 0.7152 * f32[..., 1] + 0.0722 * f32[..., 2]
        p2, p50, p98 = np.percentile(Y, [2, 50, 98])
        if cv2 is not None:
            lap = float(np.mean(np.abs(cv2.Laplacian(Y, cv2.CV_32F))))
        else:
            lap = float(np.mean(np.abs(4 * Y[1:-1, 1:-1] - Y[:-2, 1:-1] - Y[2:, 1:-1] - Y[1:-1, :-2] - Y[1:-1, 2:])))
        rg, yb = f32[..., 0] - f32[..., 1], 0.5 * (f32[..., 0] + f32[..., 1]) - f32[..., 2]
        colour = float(np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2))
        red = float(np.mean((f[..., 0] > 150) & (f[..., 1] < 90) & (f[..., 2] < 90)))
        out.append([round(float(p2)), round(float(p50)), round(float(p98)), round(lap, 2), round(colour, 1), round(red, 3)])
    return out


def ocr_frames(ts, arr, workers=2):
    """Approximate on-screen text per sampled frame via tesseract (normal + inverted), uppercase words only."""
    if not shutil.which('tesseract'):
        return [''] * len(ts)
    import io

    def one(f):
        g = Image.fromarray(f).convert('L')
        words = []
        for img in (g, Image.eval(g, lambda v: 255 - v)):
            b = io.BytesIO()
            img.save(b, 'PNG')
            r = subprocess.run(['nice', '-n', '10', 'tesseract', 'stdin', 'stdout', '--psm', '11', '-l', 'eng', 'tsv'],
                               input=b.getvalue(), capture_output=True, env=dict(os.environ, OMP_THREAD_LIMIT='1'))
            for ln in r.stdout.decode(errors='ignore').split('\n')[1:]:
                c = ln.split('\t')
                if len(c) == 12 and c[11].strip():
                    try:
                        conf = float(c[10])
                    except ValueError:
                        continue
                    w = re.sub(r'[^A-Z0-9\'.,?!:-]', '', c[11].strip())
                    core = re.sub(r'[^A-Z0-9]', '', w)
                    if conf >= 60 and w == w.upper() and (len(core) >= 3 or core in SHORT_OK):
                        words.append((int(c[7]), int(c[6]), w))
        seen, keep = set(), []
        for top, left, w in sorted(words):
            if w not in seen:
                seen.add(w)
                keep.append(w)
        return ' '.join(keep)
    # read a frame only when it differs from the last one read (held type repeats across samples)
    todo, last = [], None
    for i, f in enumerate(arr):
        small = f[::6, ::6].astype(np.int16)
        if last is None or np.abs(small - last).mean() > 6:
            todo.append(i)
            last = small
    # no render slot: a light lane can be held for many minutes by a stills round; tesseract runs niced instead
    with ThreadPoolExecutor(workers) as ex:
        got = dict(zip(todo, ex.map(one, [arr[i] for i in todo])))
    out, cur = [], ''
    for i in range(len(arr)):
        cur = got.get(i, cur)
        out.append(cur)
    print(f'    ocr: read {len(todo)} of {len(arr)} frames')
    return out


def ocr_words(ts, texts):
    """Collapse per-frame OCR into frames [{t0, t1, text}] (consecutive identical reads merge)."""
    segs = []
    for t, x in zip(ts, texts):
        if not x:
            continue
        if segs and segs[-1]['text'] == x and t - segs[-1]['t1'] < 0.8:
            segs[-1]['t1'] = t
        else:
            segs.append({'t0': t, 't1': t, 'text': x})
    return segs


# ================================================================ one version
def norm_line(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^A-Z0-9\' ]', ' ', s.upper())).strip()


def frames_from_script(sc, bpm, closer, dur):
    spb = 60.0 / bpm
    W = sorted(sc['words'], key=lambda w: w['beat'])
    out = []
    for i, w in enumerate(W):
        nb = W[i + 1]['beat'] if i + 1 < len(W) else (closer if closer else w['beat'] + dur / spb)
        t0, t1 = w['beat'] * spb, min(dur, nb * spb)
        out.append({'beat': w['beat'], 't0': round(t0, 3), 't1': round(t1, 3), 'text': w['text'],
                    'verbatim': w.get('verbatim', False)})
    return out


def hold_stats(frames):
    holds = [round(f['t1'] - f['t0'], 2) for f in frames if f['t1'] > f['t0']]
    if not holds:
        return {}
    arr = np.array(holds)
    run_, best, prev = 1, 1, None
    for h in holds:
        run_ = run_ + 1 if prev is not None and abs(h - prev) < 0.03 else 1
        best, prev = max(best, run_), h
    vals, counts = np.unique(np.round(arr, 1), return_counts=True)
    return {'n': len(holds), 'median': round(float(np.median(arr)), 2), 'min': float(arr.min()), 'max': float(arr.max()),
            'cv': round(float(arr.std() / arr.mean()), 2), 'longest_equal_run': best,
            'modal_hold': float(vals[counts.argmax()]), 'modal_share': round(float(counts.max() / len(holds)), 2)}


def text_stats(frames):
    lines = [norm_line(f['text']) for f in frames if f['text']]
    words = [len(l.split()) for l in lines if l]
    return {'frames': len(lines), 'distinct': len(set(lines)), 'words_total': sum(words),
            'words_per_frame_median': float(np.median(words)) if words else 0, 'words_per_frame_max': max(words or [0]),
            'verbatim_frames': sum(1 for f in frames if f.get('verbatim')),
            'most_repeated': max(((lines.count(l), l) for l in set(lines)), default=(0, ''))}


def active_text(frames, t):
    for f in frames:
        if f['t0'] <= t < f['t1']:
            return f['text']
    return ''


def measure(v, out_dir, fps=2.0, ocr=False, keep=False):
    """Measure one version -> measures dict (cached in out_dir/<label>/measures.json)."""
    label = v['label']
    src = v['source']
    fetched = False
    if src.startswith('archive:'):
        stem = src.split(':', 1)[1]
        ap = resolve_archive(stem)
        cached = os.path.join(CACHE, ap.replace('/', '__'))
        key_src = f'archive:{ap}'
    else:
        path = local_path(src)
        st = os.stat(path)
        key_src = f'{path}:{st.st_size}:{int(st.st_mtime)}'
    script_opt = v.get('script')
    scene = None
    if not src.startswith('archive:'):
        scene = re.sub(r'(_share|_master|_\d+(\.\d+)?-\d+(\.\d+)?)$', '', os.path.splitext(os.path.basename(path))[0])
        if script_opt is None and script_path and script_path(scene):
            script_opt = script_path(scene)
            v['script_assumed'] = True
    if script_opt is None and ocr:
        script_opt = 'ocr'
    key = hashlib.md5(json.dumps([VERSION, key_src, script_opt, v.get('bpm'), v.get('closer'), fps]).encode()).hexdigest()
    d = os.path.join(out_dir, label)
    mp = os.path.join(d, 'measures.json')
    if os.path.exists(mp):
        try:
            m = json.load(open(mp))
            if m.get('key') == key:
                print(f'  {label}: cached ({os.path.relpath(mp, VIDEOS)})')
                return m
        except Exception:
            pass
    os.makedirs(os.path.join(d, 'frames'), exist_ok=True)
    if src.startswith('archive:'):
        fetched = True   # the cache is scratch: anything in it goes after measuring unless --keep
        path, ap = fetch_archive(stem)
        origin = f'archive {ARCHIVE_REF}:{ap}'
    else:
        origin = os.path.relpath(path, ROOT)
    print(f'  {label}: measuring {origin}')
    try:
        dur, (W, H), vfps, has_audio = probe(path)
        ts, arr = decode(path, fps, 270)
        cuts = cuts_of(path)
        loud = loudness(path) if has_audio else {'I': None, 'LRA': None, 'TP': None, 'rms_q': []}
        pics = picture_stats(arr)
        for i, f in enumerate(arr):
            Image.fromarray(f).save(os.path.join(d, 'frames', f'{i:04d}.jpg'), quality=82)
        sc = load_script(script_opt)
        bpm = float(v['bpm']) if v.get('bpm') else None
        closer = float(v['closer']) if v.get('closer') else None
        frames, text_origin = [], None
        if sc and sc.get('ocr'):
            frames = [dict(s, beat=None, verbatim=False) for s in ocr_words(ts, ocr_frames(ts, arr))]
            for f in frames:
                f['t1'] = round(f['t1'] + 0.5 / fps, 3)
                f['t0'] = round(max(0, f['t0'] - 0.5 / fps), 3)
            text_origin = 'OCR (approximate; stylised or small type is missed)'
        elif sc:
            sb, sl = snippet_meta(sc.get('snippet_head'))
            bpm = bpm or sc.get('bpm') or sb or (hits_bpm(scene) if scene else None)
            closer = closer or sc.get('closer') or sl or (logo_beat(scene) if scene else None)
            if not bpm:
                print(f'  {label}: script has no bpm; pass ;bpm=N  (script ignored)')
            else:
                frames = frames_from_script(sc, float(bpm), closer, dur)
                text_origin = sc['origin'] + (' (current script, assumed to match this render)' if v.get('script_assumed') else '')
        m = {'key': key, 'label': label, 'origin': origin, 'dur': round(dur, 3), 'size': [W, H], 'fps': vfps,
             'bytes': os.path.getsize(path), 'bpm': bpm, 'closer': closer, 'sample_fps': fps, 'ts': ts,
             'cuts': cuts, 'loud': loud, 'pics': pics, 'frames': frames, 'text_origin': text_origin,
             'holds': hold_stats(frames) if frames and frames[0].get('beat') is not None else {},
             'text': text_stats(frames) if frames else {}}
        json.dump(m, open(mp, 'w'))
    finally:
        if fetched and not keep and os.path.exists(path):
            os.remove(path)
    write_version_outputs(m, d)
    return m


# ================================================================ drawing
BG, INK, DIM, RED, CREAM = (16, 12, 12), (240, 232, 214), (140, 130, 120), (214, 40, 36), (244, 230, 208)


def load_frames(d, m):
    fs = sorted(os.listdir(os.path.join(d, 'frames')))
    return [os.path.join(d, 'frames', f) for f in fs]


def tile_at(d, m, t, w):
    fs = load_frames(d, m)
    if not fs:
        return Image.new('RGB', (w, int(w * 16 / 9)), BG)
    i = min(len(fs) - 1, max(0, int(t * m['sample_fps'])))
    im = Image.open(fs[i]).convert('RGB')
    return im.resize((w, int(im.height * w / im.width)))


def fit_text(dr, s, f, w):
    while s and dr.textlength(s, font=f) > w:
        s = s[:-2] + '…' if len(s) > 2 else ''
    return s


def contact_sheet(m, d, n=48, cols=12, w=180):
    D = m['dur']
    ts = [(i + 0.5) * D / n for i in range(n)]
    spb = 60 / m['bpm'] if m.get('bpm') else None
    f1, f2 = font(13, True), font(13)
    tiles = [tile_at(d, m, t, w) for t in ts]
    th = tiles[0].height
    head = 34
    S = Image.new('RGB', (cols * w, head + ((n + cols - 1) // cols) * (th + 34)), BG)
    dr = ImageDraw.Draw(S)
    dr.text((8, 8), f"{m['label']}  {m['origin']}  {D:.2f} s  {m['size'][0]}x{m['size'][1]}"
            + (f"  {m['bpm']:g} BPM" if m.get('bpm') else '') + (f"  lockup b{m['closer']:g}" if m.get('closer') else ''),
            fill=INK, font=font(16))
    for i, (t, im) in enumerate(zip(ts, tiles)):
        x, y = (i % cols) * w, head + (i // cols) * (th + 34)
        S.paste(im, (x, y))
        lab = f'{t:5.2f}s' + (f' b{t / spb:.1f}' if spb else '')
        dr.text((x + 3, y + th + 2), lab, fill=INK, font=f1)
        txt = active_text(m['frames'], t)
        if txt:
            dr.text((x + 3, y + th + 17), fit_text(dr, txt, f2, w - 6), fill=(255, 120, 100), font=f2)
    return S


def strip(m, px_per_s=40, total=None, h=96, label_w=150):
    """Pacing strip on a seconds axis: text frames (blocks, verbatim in red), cuts (ticks), loudness (envelope)."""
    total = total or m['dur']
    W = label_w + int(total * px_per_s) + 10
    S = Image.new('RGB', (W, h), BG)
    dr = ImageDraw.Draw(S)
    x0 = label_w
    X = lambda t: x0 + int(t * px_per_s)
    for s in range(0, int(total) + 1):
        dr.line([(X(s), 0), (X(s), h)], fill=(40, 34, 32) if s % 5 else (70, 60, 56))
    # text frames
    for i, f in enumerate(m['frames']):
        col = (170, 40, 34) if f.get('verbatim') else ((120, 110, 98) if i % 2 else (160, 150, 136))
        dr.rectangle([X(f['t0']), 6, max(X(f['t0']) + 1, X(f['t1']) - 3), 30], fill=col)
    # cuts
    for c in m['cuts']:
        dr.line([(X(c), 34), (X(c), 46)], fill=INK)
    # loudness envelope (0.25 s RMS, -40..0 dB)
    rms = m['loud'].get('rms_q') or []
    base = h - 4
    for i, db in enumerate(rms):
        v = max(0.0, min(1.0, (db + 40) / 40))
        dr.rectangle([X(i * 0.25), base - int(v * 44), X((i + 1) * 0.25) - 1, base], fill=(200, 90, 60))
    if m.get('closer') and m.get('bpm'):
        dr.line([(X(m['closer'] * 60 / m['bpm']), 0), (X(m['closer'] * 60 / m['bpm']), h)], fill=(255, 220, 90), width=2)
    dr.rectangle([0, 0, label_w - 6, h], fill=BG)
    dr.text((6, 6), m['label'], fill=INK, font=font(16))
    dr.text((6, 30), f"{m['dur']:.1f} s", fill=DIM, font=font(13))
    if m['loud'].get('I') is not None:
        dr.text((6, 48), f"{m['loud']['I']:.1f} LUFS", fill=DIM, font=font(13))
    if m['holds']:
        dr.text((6, 66), f"hold cv {m['holds']['cv']:.2f}", fill=DIM, font=font(13))
    return S


def timeline_md(m):
    L = [f"# {m['label']}: {m['origin']}", '',
         f"{m['dur']:.2f} s, {m['size'][0]}x{m['size'][1]}, {m['bytes'] / 1e6:.1f} MB"
         + (f", {m['bpm']:g} BPM" if m.get('bpm') else '') + (f", lockup b{m['closer']:g}" if m.get('closer') else ''),
         f"Text from: {m['text_origin'] or 'none'}", '']
    if not m['frames']:
        L.append('No script or OCR given, so no frame table. Cuts: ' + ', '.join(f'{c:.2f}' for c in m['cuts']))
        return '\n'.join(L) + '\n'
    L += ['| beat | t (s) | hold (s) | text | v | cuts in hold | RMS dB over the hold (0.25 s) |', '|---|---|---|---|---|---|---|']
    rms = m['loud'].get('rms_q') or []
    for f in m['frames']:
        c = [f'{x:.2f}' for x in m['cuts'] if f['t0'] - 0.02 <= x < f['t1'] - 0.02]
        seg = rms[int(f['t0'] * 4):max(int(f['t0'] * 4) + 1, int(f['t1'] * 4))]
        b = '' if f.get('beat') is None else f"{f['beat']:g}"
        L.append(f"| {b} | {f['t0']:.2f} | {f['t1'] - f['t0']:.2f} | {f['text']} | {'V' if f.get('verbatim') else ''} | "
                 f"{', '.join(c) or '-'} | {' '.join(f'{x:.0f}' for x in seg)} |")
    return '\n'.join(L) + '\n'


def write_version_outputs(m, d):
    contact_sheet(m, d).save(os.path.join(d, 'sheet.jpg'), quality=84)
    strip(m).save(os.path.join(d, 'strip.jpg'), quality=88)
    open(os.path.join(d, 'timeline.md'), 'w').write(timeline_md(m))


# ================================================================ compare
def summary(m):
    pics = np.array(m['pics']) if m['pics'] else np.zeros((1, 6))
    gaps = np.diff([0] + m['cuts'] + [m['dur']])
    rms = np.array(m['loud'].get('rms_q') or [0])
    q = np.array_split(rms, 4) if len(rms) >= 4 else [rms]
    text_t = sum(f['t1'] - f['t0'] for f in m['frames'] if f['text'])
    return {
        'length (s)': f"{m['dur']:.1f}", 'size': f"{m['size'][0]}x{m['size'][1]}", 'MB': f"{m['bytes'] / 1e6:.1f}",
        'text from': (m['text_origin'] or 'none').split(' (')[0],
        'text frames / distinct': f"{m['text'].get('frames', '-')} / {m['text'].get('distinct', '-')}" if m['text'] else '-',
        'verbatim frames': str(m['text'].get('verbatim_frames', '-')) if m['text'] else '-',
        'words on screen': str(m['text'].get('words_total', '-')) if m['text'] else '-',
        'words per frame (median / max)': f"{m['text']['words_per_frame_median']:g} / {m['text']['words_per_frame_max']}" if m['text'] else '-',
        'most repeated line': (f"{m['text']['most_repeated'][1]} x{m['text']['most_repeated'][0]}" if m['text'] and m['text']['most_repeated'][0] > 1 else '-'),
        'text span: script holds or OCR reads (share of run)': f"{min(1, text_t / m['dur']):.0%}" if m['frames'] else '-',
        'hold median / min / max (s)': f"{m['holds']['median']:.2f} / {m['holds']['min']:.2f} / {m['holds']['max']:.2f}" if m['holds'] else '-',
        'hold spread (cv)': f"{m['holds']['cv']:.2f}" if m['holds'] else '-',
        'longest run of equal holds': str(m['holds']['longest_equal_run']) if m['holds'] else '-',
        'cuts / median shot (s)': f"{len(m['cuts'])} / {np.median(gaps):.2f}",
        'loudness I / LRA / TP': (f"{m['loud']['I']:.1f} / {m['loud']['LRA']:.1f} / {m['loud']['TP']:.1f}" if m['loud'].get('I') is not None else '-'),
        'RMS p10 to p90 (dB)': f"{np.percentile(rms, 10):.0f} to {np.percentile(rms, 90):.0f} ({np.percentile(rms, 90) - np.percentile(rms, 10):.0f} dB)",
        'quarters RMS (dB)': ' '.join(f'{x.mean():.0f}' for x in q),
        'luma p2 / p50 / p98 (median)': ' / '.join(f'{v:.0f}' for v in np.median(pics[:, :3], axis=0)),
        'detail (median |Laplacian|)': f"{np.median(pics[:, 3]):.1f}",
        'colourfulness (median)': f"{np.median(pics[:, 4]):.0f}",
        'ACP-red share (median)': f"{np.median(pics[:, 5]):.1%}",
    }


def content_words(lines):
    out = set()
    for l in lines:
        for w in norm_line(l).split():
            w = w.strip("'")
            if w and w not in STOP and len(w) > 1:
                out.add(w)
    return out


def similar(a, b, thr=0.72):
    """Two normalised lines match when their characters or their word sets mostly agree (OCR reorders and clips)."""
    if a == b:
        return True
    import difflib
    wa, wb = set(a.split()), set(b.split())
    if wa and wb and (wa <= wb or wb <= wa) and min(len(wa), len(wb)) >= 2:
        return True     # a split line against its merged read (WHO OWNS / THE MACHINES? vs one OCR frame)
    jac = len(wa & wb) / max(1, len(wa | wb))
    return max(difflib.SequenceMatcher(None, a, b).ratio(), jac) >= thr


def text_diff(ref, other):
    rl = list(dict.fromkeys(f['text'] for f in ref['frames'] if f['text']))
    ol = list(dict.fromkeys(f['text'] for f in other['frames'] if f['text']))
    rn, on = [norm_line(x) for x in rl], [norm_line(x) for x in ol]
    lost = [x for x, n in zip(rl, rn) if not any(similar(n, o) for o in on)]
    new = [x for x, n in zip(ol, on) if not any(similar(n, r) for r in rn)]
    rw, ow = content_words(rl), content_words(ol)
    fuzzy = (other['text_origin'] or '').startswith('OCR') or (ref['text_origin'] or '').startswith('OCR')
    import difflib
    near = lambda w, pool: w in pool or (fuzzy and bool(difflib.get_close_matches(w, pool, 1, 0.75)))
    num = lambda s: {w for w in s if re.search(r'\d', w)}
    return {'lost_lines': lost, 'new_lines': new, 'lost_words': sorted(w for w in rw if not near(w, ow)),
            'new_words': sorted(w for w in ow if not near(w, rw)), 'lost_numbers': sorted(num(rw) - num(ow)),
            'kept_lines': len(rl) - len(lost), 'fuzzy': fuzzy}


def compare(ms, out_dir, ref_i=0, n=16, w=150):
    dirs = [os.path.join(out_dir, m['label']) for m in ms]
    total = max(m['dur'] for m in ms)
    # strips on one axis
    strips = [strip(m, total=total) for m in ms]
    S = Image.new('RGB', (max(s.width for s in strips), sum(s.height + 4 for s in strips) + 24), BG)
    dr = ImageDraw.Draw(S)
    dr.text((8, 4), 'blocks: text frames (red = marked verbatim)   ticks: cuts   envelope: 0.25 s RMS, -40..0 dB   '
            'yellow: lockup   grid: 1 s, bold every 5 s', fill=DIM, font=font(13))
    y = 24
    for s in strips:
        S.paste(s, (0, y))
        y += s.height + 4
    S.save(os.path.join(out_dir, 'compare_strips.jpg'), quality=88)
    # frames at equal fractions
    lw = 130
    rows = []
    for m, d in zip(ms, dirs):
        ts = [(i + 0.5) * m['dur'] / n for i in range(n)]
        tiles = [tile_at(d, m, t, w) for t in ts]
        th = tiles[0].height
        R = Image.new('RGB', (lw + n * w, th + 20), BG)
        rd = ImageDraw.Draw(R)
        rd.text((6, 6), m['label'], fill=INK, font=font(16))
        rd.text((6, 28), f"{m['dur']:.1f} s", fill=DIM, font=font(13))
        for i, (t, im) in enumerate(zip(ts, tiles)):
            R.paste(im, (lw + i * w, 0))
            rd.text((lw + i * w + 3, th + 3), fit_text(rd, f'{t:.1f}s {active_text(m["frames"], t)}', font(11), w - 6),
                    fill=INK, font=font(11))
        rows.append(R)
    F = Image.new('RGB', (max(r.width for r in rows), sum(r.height for r in rows) + 24), BG)
    ImageDraw.Draw(F).text((8, 4), f'{n} tiles per version at the same fractions of each running time', fill=DIM, font=font(13))
    y = 24
    for r in rows:
        F.paste(r, (0, y))
        y += r.height
    F.save(os.path.join(out_dir, 'compare_frames.jpg'), quality=84)
    # shared lines side by side
    order, seen = [], set()
    for m in [ms[ref_i]] + [x for i, x in enumerate(ms) if i != ref_i]:
        for f in m['frames']:
            k = norm_line(f['text'])
            if k and k not in seen:
                seen.add(k)
                order.append(k)
    shared = [k for k in order if sum(any(similar(norm_line(f['text']), k) for f in m['frames']) for m in ms) >= 2]
    dedup = []
    for k in shared:
        if not any(similar(k, x) for x in dedup):
            dedup.append(k)
    shared = dedup[:28]
    if shared:
        cw = 120
        th = int(cw * 16 / 9)
        L = Image.new('RGB', (lw + len(shared) * cw, 40 + len(ms) * (th + 4)), BG)
        ld = ImageDraw.Draw(L)
        ld.text((8, 4), 'lines two or more versions share: each at the middle of its first hold (empty = absent)', fill=DIM, font=font(13))
        for j, k in enumerate(shared):
            ld.text((lw + j * cw + 2, 22), fit_text(ld, k, font(11), cw - 4), fill=INK, font=font(11))
        for i, (m, d) in enumerate(zip(ms, dirs)):
            y = 40 + i * (th + 4)
            ld.text((6, y + 6), m['label'], fill=INK, font=font(16))
            for j, k in enumerate(shared):
                f = next((f for f in m['frames'] if norm_line(f['text']) == k), None) or \
                    next((f for f in m['frames'] if similar(norm_line(f['text']), k)), None)
                if f:
                    L.paste(tile_at(d, m, (f['t0'] + f['t1']) / 2, cw).crop((0, 0, cw, th)), (lw + j * cw, y))
        L.save(os.path.join(out_dir, 'compare_lines.jpg'), quality=84)
    # markdown
    sums = [summary(m) for m in ms]
    rows = list(sums[0].keys())
    md = [f'# Version compare: {", ".join(m["label"] for m in ms)}', '',
          'Measured by `videos/tools/piece_review.py` (descriptive only; nothing here is a pass or a fail). '
          f'Reference for the text diff: **{ms[ref_i]["label"]}**.', '',
          '| | ' + ' | '.join(m['label'] for m in ms) + ' |', '|---|' + '---|' * len(ms)]
    for r in rows:
        md.append(f'| {r} | ' + ' | '.join(s[r] for s in sums) + ' |')
    md += ['', 'Sources:'] + [f"- **{m['label']}**: {m['origin']}; text from {m['text_origin'] or 'none'}" for m in ms]
    md += ['', 'Pictures: `compare_strips.jpg` (pacing, cuts, loudness on one seconds axis), `compare_frames.jpg`, '
           '`compare_lines.jpg`, and each version\'s `sheet.jpg`, `strip.jpg`, `timeline.md`.', '']
    ref = ms[ref_i]
    if ref['frames']:
        for i, m in enumerate(ms):
            if i == ref_i or not m['frames']:
                continue
            t = text_diff(ref, m)
            md += [f"## {m['label']} against {ref['label']}", '',
                   ('(One side is OCR, so lines and words match fuzzily and OCR fragments still show up as new.) ' if t['fuzzy'] else '')
                   + f"Lines kept (close matches count): {t['kept_lines']} of {len(set(f['text'] for f in ref['frames'] if f['text']))}. "
                   f"Lost numbers and dates: {', '.join(t['lost_numbers']) or 'none'}.", '',
                   f"**Lines in {ref['label']} and not in {m['label']}** ({len(t['lost_lines'])}): "
                   + (' · '.join(t['lost_lines']) or 'none'), '',
                   f"**Lines new in {m['label']}** ({len(t['new_lines'])}): " + (' · '.join(t['new_lines']) or 'none'), '',
                   f"Content words lost: {', '.join(t['lost_words']) or 'none'}", '',
                   f"Content words new: {', '.join(t['new_words']) or 'none'}", '']
    open(os.path.join(out_dir, 'compare.md'), 'w').write('\n'.join(md) + '\n')
    json.dump({'versions': [m['label'] for m in ms], 'summary': dict(zip([m['label'] for m in ms], sums))},
              open(os.path.join(out_dir, 'compare.json'), 'w'), indent=1)


# ================================================================ list
def list_versions(piece):
    key = script_key(piece) if script_key else piece
    names = PUBLISHED.get(key, [key]) + [piece, key]
    names = list(dict.fromkeys(n.lower() for n in names))
    print(f'piece {piece} (script key {key})')
    print('local renders:')
    for base, _, files in os.walk(os.path.join(VIDEOS, 'out')):
        if '/.review_cache' in base:
            continue
        for f in sorted(files):
            if f.endswith('.mp4') and any(f.lower().startswith(n) for n in names):
                p = os.path.join(base, f)
                print(f'  {os.path.relpath(p, VIDEOS):60s} {os.path.getsize(p) / 1e6:7.1f} MB')
    print(f'archive ({ARCHIVE_REF}):  use archive:STEM (the _share files are the small ones)')
    for p in archive_paths():
        s = os.path.splitext(os.path.basename(p))[0]
        s2 = re.sub(r'^[0-9a-f]{7}_', '', s).lower()
        if any(s2.startswith(n) for n in names):
            print(f'  archive:{s:48s} {p}')
    sp = script_path(key) if script_path else None
    if sp:
        r = run(['git', '-C', ROOT, 'log', '--format=%h %ad %s', '--date=short', '--', os.path.relpath(sp, ROOT)], text=True)
        print(f'script history ({os.path.relpath(sp, ROOT)}; use script=git:REV:{os.path.relpath(sp, ROOT)}):')
        for ln in r.stdout.strip().split('\n')[:12]:
            print('  ' + ln)


# ================================================================ selftest
def selftest():
    """Two synthetic 6 s versions (ffmpeg testsrc + tone), snippet scripts -> sheet, strip, timeline, compare."""
    import tempfile
    ok = True
    with tempfile.TemporaryDirectory() as d:
        for name, freq, rate in (('a', 220, 'testsrc2'), ('b', 330, 'testsrc')):
            run([FF, '-y', '-v', 'error', '-f', 'lavfi', '-i', f'{rate}=size=270x480:rate=30:duration=6', '-f', 'lavfi',
                 '-i', f'sine=frequency={freq}:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                 os.path.join(d, f'{name}.mp4')])
        open(os.path.join(d, 'a.txt'), 'w').write('// a, 120 BPM\n0: WHO OWNS\n2: THE MACHINES?\n4: 29 CLUBS.\n6: THE AI.\n8: THE AI.\n')
        open(os.path.join(d, 'b.txt'), 'w').write('0: WHO OWNS\n2: THE MACHINES?\n4: WE DO.\n6: WE DO.\n8: WE DO.\n')
        out = os.path.join(d, 'rev')
        main(['compare', '--out', out, f"A={d}/a.mp4;script={d}/a.txt;bpm=120;closer=11",
              f"B={d}/b.mp4;script={d}/b.txt;bpm=120;closer=11"])
        for f in ('A/sheet.jpg', 'A/strip.jpg', 'A/timeline.md', 'B/measures.json', 'compare.md', 'compare_strips.jpg',
                  'compare_frames.jpg', 'compare_lines.jpg'):
            e = os.path.exists(os.path.join(out, f))
            ok &= e
            print(('ok  ' if e else 'BAD ') + f)
        md = open(os.path.join(out, 'compare.md')).read()
        t = 'Lost numbers and dates: 29' in md and 'WE DO x3' in md and '29 CLUBS.' in md.split('not in B')[1]
        ok &= t
        print(('ok  ' if t else 'BAD ') + 'text diff: lost line, lost number, repeated line')
        m = json.load(open(os.path.join(out, 'A', 'measures.json')))
        t = abs(m['dur'] - 6) < 0.2 and len(m['frames']) == 5 and m['holds']['longest_equal_run'] == 4 and m['loud']['I'] is not None
        ok &= t
        print(('ok  ' if t else 'BAD ') + f"measures: dur {m['dur']}, {len(m['frames'])} frames, equal-hold run {m['holds'].get('longest_equal_run')}")
        again = main(['compare', '--out', out, f"A={d}/a.mp4;script={d}/a.txt;bpm=120;closer=11",
                      f"B={d}/b.mp4;script={d}/b.txt;bpm=120;closer=11"]) == 0
        ok &= again
    print('selftest', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


# ================================================================ CLI
def phone_view(A):
    import tempfile, shutil as _sh
    src = local_path(A.video)
    dur = probe(src)[0]
    ts = [float(x) for x in A.at.split(',')] if A.at else [dur * (i + 0.5) / A.n for i in range(A.n)]
    tmp = tempfile.mkdtemp(prefix='phone_')
    try:
        for i, t in enumerate(ts):
            run([FF, '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', src, '-frames:v', '1', '-vf', 'scale=1080:1920', os.path.join(tmp, f't{t:07.2f}.png')])
        out = A.out or os.path.join(VIDEOS, 'review', os.path.splitext(os.path.basename(src))[0] + '_phone.jpg')
        subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'mud_probe.py'), tmp, '--inks', A.inks, '--encode', '--sheet', out], check=False)
    finally:
        _sh.rmtree(tmp, ignore_errors=True)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('list')
    a.add_argument('piece')
    for name in ('sheet', 'compare'):
        a = sub.add_parser(name)
        a.add_argument('versions', nargs='+')
        a.add_argument('--piece')
        a.add_argument('--out')
        a.add_argument('--fps', type=float, default=2.0, help='sampling rate for tiles and picture measures')
        a.add_argument('--ocr', action='store_true', help='OCR versions that have no script')
        a.add_argument('--keep', action='store_true', help='keep fetched archive files in out/.review_cache')
        a.add_argument('--ref', default=None, help='label of the reference version for the text diff (default: first)')
    # STUDIO CIV ASSETS c1: the phone view of a print-style piece (mud_probe.py): n frames at full res, where their
    # colours land after screen-cell averaging, dot noise vs. shape at a thumbnail, and an 8 Mb/s / 540p re-encode crop
    a = sub.add_parser('phone', help='mud / dot-noise / re-encode view of frames from one video (information only)')
    a.add_argument('video'); a.add_argument('--n', type=int, default=12); a.add_argument('--at', default=None, help='comma list of seconds')
    a.add_argument('--inks', default='#EFE2C4,#D11F24,#111111,#C9A04A', help='paper first, then the inks'); a.add_argument('--out')
    if (argv if argv is not None else sys.argv[1:])[:1] == ['--selftest']:
        return selftest()
    A = ap.parse_args(argv)
    if A.cmd == 'list':
        return list_versions(A.piece)
    if A.cmd == 'phone':
        return phone_view(A)
    vs = [parse_spec(s) for s in A.versions]
    piece = A.piece or (script_key(os.path.basename(vs[0]['source'].split(':')[-1])) if script_key else 'piece')
    out = A.out or os.path.join(VIDEOS, 'review', f'{piece}_versions')
    out = out if os.path.isabs(out) else os.path.join(VIDEOS, out)   # relative --out is under videos/
    os.makedirs(out, exist_ok=True)
    labels = [v['label'] for v in vs]
    if len(set(labels)) != len(labels):
        raise SystemExit('piece_review: labels must differ')
    ms = [measure(v, out, A.fps, A.ocr, A.keep) for v in vs]
    for m in ms:
        print(f"  {m['label']}: {os.path.relpath(os.path.join(out, m['label']), VIDEOS)}/sheet.jpg strip.jpg timeline.md")
    if A.cmd == 'compare' and len(ms) > 1:
        ref_i = labels.index(A.ref) if A.ref else 0
        compare(ms, out, ref_i)
        print(f'compare: {os.path.relpath(out, VIDEOS)}/compare.md compare_strips.jpg compare_frames.jpg compare_lines.jpg')
    return 0


if __name__ == '__main__':
    sys.exit(main())
