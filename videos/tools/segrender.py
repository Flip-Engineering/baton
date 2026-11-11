#!/usr/bin/env python3
"""Resumable segmented full-length render (TOOLING c8, 2026-09-29).

A full render is one browser session for 1700+ frames under SwiftShader. On the shared 4-core box that session dies
(WebGL context loss, OOM, a killed job) and takes every finished frame with it. This renders a piece as N short
render.mjs clips, one browser each, remembers which are done, retries the ones that die, then joins the pictures and
muxes the codec-true audio once from the piece's own wav.

    python3 videos/tools/segrender.py meltdown8                      # 4 s segments -> out/<scene>.seg/ -> final mp4
    python3 videos/tools/segrender.py meltdown8 --seg-s 6 --retries 3 --final /tmp/x/meltdown8.mp4
    python3 videos/tools/segrender.py meltdown8 --seg-beats 16       # segment length in beats (song BPM)
    python3 videos/tools/segrender.py meltdown8 --only 3,4           # (re)render just those segments, no join
    python3 videos/tools/segrender.py meltdown8 --plan               # print the plan and what is already done
    python3 videos/tools/segrender.py meltdown8 --join-only          # join what exists (errors if any is missing)
    python3 videos/tools/segrender.py --selftest                     # no browser: plan, resume, join and seam check

Options: --reuse-audio (default on when out/.<scene>.wav exists; --rebuild-audio to force a song build first),
--work DIR (default videos/out/<scene>.seg), --final FILE (default videos/out/<scene>.mp4 is NOT touched unless you
say so; the default is <work>/<scene>.mp4), --wait-disk MIN (pause on the disk floor and resume, see capabilities/segrender_and_overlay.md), --keep (keep segment clips after joining; default deletes them to save
disk), --seam-check / --no-seam-check, --render-args "..." (extra args passed to render.mjs), --slot as render.mjs,
--silent (a picture with no soundtrack: render.mjs reads tools/silent_input.py's stand-in, written here if missing, and the
joined master has no audio stream; needs --duration).

Segments are frame-aligned (30 fps), each in its own folder work/sNN/, with a status file work/segments.json. A
segment counts as done only if its mp4 probes to its expected frame count (+-1), so a half-written file from a
killed job is redone. Frames are rendered by seeking (window.renderFrame(t)), so a segment is only identical to the
continuous render if the scene is stateless in t. Scenes that warm a stateful rig or integrate a sim from t=0 are
not: the SEAM CHECK compares the frame step across each join with the median step at that place in the piece and
prints any join more than 3x the local step (a pop) so you can see it. It reports; it never fails the run.

Partial re-render (TOOLING c23): a fix to a few seconds should not cost a full render. Keep the segments as a persistent
per-scene CACHE (out/<scene>.seg, or --work DIR / $ACP_SEG_CACHE/<scene>.seg) and name the changed span:

    python3 videos/tools/segrender.py productive2 --cache                       # full render once, clips kept (about one master's size)
    python3 videos/tools/segrender.py productive2 --span 41.2-42.0              # only the segments overlapping 41.2-42.0 s re-render, then rejoin
    python3 videos/tools/segrender.py productive2 --span 12-14,41.2-42 --final out/productive2.mp4
    python3 videos/tools/segrender.py productive2 --span-beats 88-96            # the same in beats (song BPM)
    python3 videos/tools/segrender.py productive2 --drop-cache                  # delete the cached segments (and the manifest), no render

--span / --span-beats imply --cache. A cache that does not fit the current plan (the piece got longer or shorter, or the
segment length changed: a song edit) is NOT an error: the segments whose frame range is unchanged are reused, the rest
are re-rendered, and a plain-words notice says which and why. The seam check stays report-only. A scene source or wav
newer than the cached clips is a notice, never a refusal. A run stalled by a hung browser (render.mjs watchdog, exit 75)
is retried (--stall-retries, default 3, not counted against --retries).

Exit: 0 all joined, 1 a segment failed after retries, 2 bad usage. Nothing tracked by git is written.
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
import time

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
FPS = 30
EXIT_STALL = 75   # render.mjs progress watchdog: retryable
EXIT_NOGPU = 78   # lib/launch.mjs: ACP_GPU=1 and no hardware WebGL renderer: retrying cannot help (8 Oct)


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg') or 'ffmpeg'


def plan(total_frames, seg_frames):
    """[(index, n0, n1)] covering 0..total_frames, last segment absorbs a tail shorter than a quarter segment."""
    segs, n = [], 0
    while n < total_frames:
        e = min(total_frames, n + seg_frames)
        if total_frames - e < seg_frames // 4:
            e = total_frames
        segs.append((len(segs), n, e))
        n = e
    return segs


def count_frames(path):
    """Frames in an mp4 by decoding the header duration (fast); None when unreadable."""
    p = subprocess.run([ffmpeg(), '-hide_banner', '-i', path], capture_output=True, text=True)
    import re
    m = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', p.stderr)
    if not m:
        return None
    return round((int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])) * FPS)


def seg_dir(work, i):
    return os.path.join(work, 's%02d' % i)


def seg_file(work, i):
    g = sorted(glob.glob(os.path.join(seg_dir(work, i), '*.mp4')))
    g = [f for f in g if not f.endswith('.ct.mp4')]
    return g[0] if g else None


def seg_done(work, i, n0, n1):
    f = seg_file(work, i)
    if not f:
        return False
    c = count_frames(f)
    return c is not None and abs(c - (n1 - n0)) <= 1


def parse_spans(text, bpm=None, beats=False):
    """'12-14,41.2-42' -> [(t0, t1)] seconds (beats converted with bpm). ValueError on a malformed list."""
    out = []
    for part in (text or '').split(','):
        if not part.strip():
            continue
        m = re.fullmatch(r'\s*([0-9]*\.?[0-9]+)\s*-\s*([0-9]*\.?[0-9]+)\s*', part)
        if not m or float(m[2]) <= float(m[1]):
            raise ValueError('bad span %r (want T0-T1 with T1 > T0, comma separated)' % part.strip())
        t0, t1 = float(m[1]), float(m[2])
        if beats:
            if not bpm:
                raise ValueError('--span-beats needs the song BPM (out/.<scene>.hits.json)')
            t0, t1 = t0 * 60.0 / bpm, t1 * 60.0 / bpm
        out.append((t0, t1))
    if not out:
        raise ValueError('empty span list')
    return out


def span_frames(spans):
    """[(t0, t1)] seconds -> [(a, b)] frames, widened to whole frames."""
    return [(int(math.floor(t0 * FPS + 1e-9)), int(math.ceil(t1 * FPS - 1e-9))) for t0, t1 in spans]


def span_segments(segs, frame_spans):
    """Indexes of the segments that overlap any (a, b) frame span."""
    return sorted({i for i, n0, n1 in segs for a, b in frame_spans if n0 < b and n1 > a})


MANIFEST = 'segments.json'


def load_manifest(work):
    try:
        return json.load(open(os.path.join(work, MANIFEST)))
    except Exception:  # noqa: BLE001 - none yet, or unreadable: treated as no manifest
        return None


def save_manifest(work, scene, segs, state, at):
    json.dump({'scene': scene, 'fps': FPS, 'total_frames': segs[-1][2],
               'segments': [{'i': j, 'n0': b, 'n1': c, 'done': bool(state[j]), 'at': at.get(j)} for j, b, c in segs]},
              open(os.path.join(work, MANIFEST), 'w'), indent=1)


def cache_dirs(work):
    return sorted(d for d in glob.glob(os.path.join(work, 's[0-9][0-9]*')) if os.path.isdir(d))


def dir_mb(path):
    n = 0
    for r, _, fs in os.walk(path):
        for f in fs:
            try:
                n += os.path.getsize(os.path.join(r, f))
            except OSError:
                pass
    return n / 1e6


def drop_cache(work):
    """Delete the cached segment clips and manifest (not the joined file, not other files in work). Returns MB freed."""
    mb = sum(dir_mb(d) for d in cache_dirs(work))
    for d in cache_dirs(work):
        shutil.rmtree(d, ignore_errors=True)
    for f in (MANIFEST, 'concat.txt', 'seams.json'):
        try:
            os.remove(os.path.join(work, f))
        except OSError:
            pass
    try:
        os.rmdir(work)   # only when nothing else lives there
    except OSError:
        pass
    return mb


def reconcile(work, scene, segs, state, say=print):
    """Compare the cache manifest with the current plan. A clip counts only if its frame range is unchanged; others are
    dropped from `state` (they will re-render). Says so in plain words. Returns {i: rendered-at} for the kept ones."""
    m = load_manifest(work)
    at = {}
    if not m or 'total_frames' not in m:
        return at   # a legacy / fresh work dir: judged by frame counts alone, as before
    old = {e['i']: (e['n0'], e['n1']) for e in m.get('segments', [])}
    same = {i for i, n0, n1 in segs if old.get(i) == (n0, n1)}
    for e in m.get('segments', []):
        if e['i'] in same and e.get('at'):
            at[e['i']] = e['at']
    new_total = segs[-1][2]
    cached = [i for i, _, _ in segs if state.get(i)]
    changed = [i for i in cached if i not in same]
    if changed or m.get('total_frames') != new_total or len(old) != len(segs):
        reuse = [i for i in cached if i in same]
        say('segrender: NOTICE the plan changed since this cache was made (was %d frames = %.2f s in %d segments, now %d frames = %.2f s '
            'in %d). %s' % (m.get('total_frames', 0), m.get('total_frames', 0) / FPS, len(old), new_total, new_total / FPS, len(segs),
                            ('Segments %s have the same frame range and are reused; the rest (%s) are re-rendered.' % (
                                reuse, [i for i, _, _ in segs if i not in reuse])) if reuse else
                            'No cached segment has the same frame range, so everything is re-rendered (a different segment length or a much '
                            'changed piece length cannot reuse the old clips).'))
        for i in changed:
            state[i] = False
    for d in cache_dirs(work):   # clips of a segment that no longer exists in the plan
        n = int(re.match(r's(\d+)', os.path.basename(d))[1])
        if n >= len(segs):
            shutil.rmtree(d, ignore_errors=True)
    return at


def render_cmd(scene, i, n0, n1, work, args):
    cmd = ['node', os.path.join(VIDEOS, 'web', 'render.mjs'), scene, '--from', repr(n0 / FPS), '--to', repr(n1 / FPS),
           '--out', seg_dir(work, i)]
    if args.reuse_audio:
        cmd.append('--reuse-audio')
    return cmd + (args.render_args.split() if args.render_args else [])


def free_gb(path='/'):
    return shutil.disk_usage(path).free / 1e9


def wait_for_disk(need, work, wait_min, poll=30, free_fn=None, sleep=time.sleep):
    """Block until free space on work's filesystem >= need GB; False after wait_min minutes (--wait-disk). Segments already
    done stay done, so a long wait costs nothing but time; the one that was refused is rerun from scratch."""
    free_fn = free_fn or (lambda: free_gb(work))
    t_end = time.time() + wait_min * 60
    first = free_fn()
    print('segrender: paused for disk, %.2f GB free, need %.2f; waiting up to %g min (polling every %ds)' % (first, need, wait_min, poll), flush=True)
    while time.time() < t_end:
        sleep(poll)
        f = free_fn()
        if f >= need:
            print('segrender: disk back to %.2f GB, resuming' % f, flush=True)
            return True
    return False


def run_segment(scene, i, n0, n1, work, args):
    d = seg_dir(work, i)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    env = dict(os.environ, ACP_CODEC='0', ACP_NO_INBOX='1')  # per-segment audio is a scratch track; the join muxes the real one
    cmd = args.render_cmd_override(scene, i, n0, n1, work, args) if args.render_cmd_override else render_cmd(scene, i, n0, n1, work, args)
    log = open(os.path.join(d, 'render.log'), 'w')
    t0 = time.time()
    r = subprocess.run(cmd, cwd=VIDEOS, env=env, stdout=log, stderr=subprocess.STDOUT)
    ok = r.returncode in (0, 3) and seg_done(work, i, n0, n1)  # 3 = a budget fail, the clip still exists
    return ok, time.time() - t0, r.returncode


def frame_steps(path, ts, w=90):
    """Mean abs diff between consecutive frames at each t in ts (decoded at reduced size). Returns {t: step}."""
    import numpy as np
    out = {}
    for t in ts:
        h = w * 16 // 9
        p = subprocess.run([ffmpeg(), '-v', 'error', '-ss', repr(max(0, t - 6 / FPS)), '-i', path, '-frames:v', '12',
                            '-vf', 'scale=%d:%d,format=gray' % (w, h), '-f', 'rawvideo', '-'], capture_output=True)
        b = np.frombuffer(p.stdout, np.uint8)
        n = len(b) // (w * h)
        if n < 4:
            continue
        f = b[:n * w * h].reshape(n, w, h).astype(np.float32)
        out[t] = [float(np.abs(f[k + 1] - f[k]).mean()) for k in range(n - 1)]
    return out


def scene_cuts(scene):
    """Frames of the scene's own cuts: its SHOTS table ([[beat], ...], the shot_table.py convention) at the song's BPM.
    Empty when the scene has no SHOTS or no hits.json (then every big step is reported)."""
    import re
    try:
        src = open(os.path.join(VIDEOS, 'web', 'scenes', scene + '.js')).read()
        m = re.search(r'const SHOTS\s*=\s*\[(.*?)\];', src, re.S)
        bpm = json.load(open(os.path.join(VIDEOS, 'out', '.%s.hits.json' % scene)))['bpm']
        beats = [float(x) for x in re.findall(r'\[\s*([0-9.]+)', m.group(1))] if m else []
        return [round(b * 60.0 / bpm * FPS) for b in beats]
    except Exception:
        return []


def seam_check(video, seams):
    """seams: frame numbers where one segment ends and the next begins. Returns rows {frame, step, local, ratio}."""
    import numpy as np
    rows = []
    steps = frame_steps(video, [n / FPS for n in seams])
    for n in seams:
        s = steps.get(n / FPS)
        if not s:
            continue
        # window starts 6 frames before the seam, so the seam step is index 5
        seam = s[5] if len(s) > 5 else s[-1]
        others = [v for k, v in enumerate(s) if k != 5]
        local = float(np.median(others)) if others else 0.0
        rows.append({'frame': n, 't': round(n / FPS, 3), 'step': round(seam, 3), 'local': round(local, 3),
                     'ratio': round(seam / max(local, 0.25), 2)})
    return rows


def join(scene, segs, work, final, args):
    lst = os.path.join(work, 'concat.txt')
    with open(lst, 'w') as f:
        for i, _, _ in segs:
            f.write("file '%s'\n" % os.path.abspath(seg_file(work, i)))
    vid = os.path.join(work, scene + '.video.mp4')
    subprocess.run([ffmpeg(), '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-map', '0:v', '-c:v', 'copy',
                    '-an', vid], check=True)
    wav = args.wav or os.path.join(VIDEOS, 'out', '.%s.wav' % scene)
    total = segs[-1][2] / FPS
    os.makedirs(os.path.dirname(os.path.abspath(final)), exist_ok=True)
    target, final = final, final[:-4] + '.part.mp4' if final.endswith('.mp4') else final + '.part.mp4'   # never leave a half-written file over an older one
    if not getattr(args, 'silent', False) and os.path.exists(wav):
        fade = ['--fade', repr(args.fade)] if getattr(args, 'fade', 0) else []   # the published tail fade (as local_render.sh)
        r = subprocess.run([sys.executable, '-m', 'engine.codec', wav, '--from', '0', '--to', repr(total)] + fade + ['--mux', vid,
                            '-o', final], cwd=VIDEOS, capture_output=True, text=True)
        if r.returncode != 0:
            print('segrender: codec mux failed (%s); falling back to a plain AAC mux' % r.stderr.strip().split('\n')[-1])
            subprocess.run([ffmpeg(), '-y', '-v', 'error', '-i', vid, '-t', repr(total), '-i', wav, '-map', '0:v', '-map',
                            '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', final], check=True)
    else:
        if not getattr(args, 'silent', False):
            print('segrender: no %s; the joined file is silent' % wav)
        shutil.copy(vid, final)
    os.remove(vid)
    os.replace(final, target)
    return target


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('scene', nargs='?')
    ap.add_argument('--seg-s', type=float, default=4.0)
    ap.add_argument('--seg-beats', type=float)
    ap.add_argument('--retries', type=int, default=2)
    ap.add_argument('--only')
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--join-only', action='store_true')
    ap.add_argument('--work')
    ap.add_argument('--final')
    ap.add_argument('--wav')
    ap.add_argument('--keep', action='store_true')
    ap.add_argument('--no-seam-check', action='store_true')
    ap.add_argument('--rebuild-audio', action='store_true')
    ap.add_argument('--render-args', default='')
    ap.add_argument('--silent', action='store_true', help='no soundtrack (bench renders): no song built or read, the master '
                    'has no audio stream; needs --duration')
    ap.add_argument('--wait-disk', type=float, default=0, metavar='MIN', help='when the render.mjs disk floor refuses a segment, '
                    'wait up to MIN minutes for free space (polling) and rerun it, instead of stopping (default 0 = stop)')
    ap.add_argument('--span', metavar='T0-T1[,T2-T3]', help='seconds; invalidate only the cached segments overlapping these spans, '
                    're-render them and rejoin (implies --cache)')
    ap.add_argument('--span-beats', metavar='B0-B1[,B2-B3]', help='the same, in beats at the song BPM')
    ap.add_argument('--cache', action='store_true', help='keep the segment clips as a persistent cache in the work dir '
                    '(out/<scene>.seg, $ACP_SEG_CACHE/<scene>.seg or --work); about the size of one master render')
    ap.add_argument('--drop-cache', action='store_true', help='delete the cached segment clips and manifest, then exit')
    ap.add_argument('--stall-retries', type=int, default=3, help='extra retries for a segment stopped by the render.mjs progress '
                    'watchdog (exit 75); not counted against --retries')
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--duration', type=float, help='override the piece duration in s (default: hits.json)')
    ap.add_argument('--fade', type=float, default=0.0, help='audio fade-out at the end in s (local_render.sh uses 0.5 with '
                    '--duration = closer + 1.4 s)')
    a = ap.parse_args(argv)
    a.render_cmd_override = None
    if a.selftest:
        return selftest()
    if not a.scene:
        ap.error('scene required')
    base = os.environ.get('ACP_SEG_CACHE')
    work = os.path.abspath(a.work or os.path.join(base or os.path.join(VIDEOS, 'out'), a.scene + '.seg'))
    if a.drop_cache:
        mb = drop_cache(work)
        print('segrender: dropped the segment cache %s (%.0f MB freed)' % (work, mb))
        return 0
    hj = os.path.join(VIDEOS, 'out', '.%s.hits.json' % a.scene)
    wav = a.wav or os.path.join(VIDEOS, 'out', '.%s.wav' % a.scene)
    a.reuse_audio = os.path.exists(wav) and os.path.exists(hj) and not a.rebuild_audio and not a.silent
    if a.silent:
        if not a.duration:
            print('segrender: --silent needs --duration (there is no song to say how long the piece is)')
            return 2
        if not os.path.exists(hj):   # render.mjs stays the farm-verified one: it reads a silent stand-in, never a song
            subprocess.run([sys.executable, os.path.join(VIDEOS, 'tools', 'silent_input.py'), a.scene, repr(a.duration)], check=True)
        a.reuse_audio = True
    elif a.rebuild_audio and not a.plan:
        subprocess.run([sys.executable, os.path.join(VIDEOS, 'web', 'audio', 'make_audio.py'), a.scene], check=True)
        a.reuse_audio = True
    if not (a.duration or os.path.exists(hj)):
        print('segrender: no %s (build the song first, or pass --duration)' % hj)
        return 2
    hits = json.load(open(hj)) if os.path.exists(hj) else {}
    dur = a.duration or hits['duration']
    seg_s = a.seg_beats * 60 / hits['bpm'] if a.seg_beats else a.seg_s
    segs = plan(round(dur * FPS), max(30, round(seg_s * FPS)))
    a.span_frames = None
    if a.span or a.span_beats:
        try:
            sp = (parse_spans(a.span) if a.span else []) + (parse_spans(a.span_beats, hits.get('bpm'), True) if a.span_beats else [])
        except ValueError as e:
            print('segrender: %s' % e)
            return 2
        a.span_frames = span_frames(sp)
        a.spans_s = sp
    if a.span_frames or a.cache:
        a.keep = True   # the segments are the cache
    final = os.path.abspath(a.final or os.path.join(work, a.scene + '.mp4'))
    os.makedirs(work, exist_ok=True)
    try:   # the piece's notes inbox: a notice, once per run; never blocks or fails
        r = subprocess.run([sys.executable, os.path.join(VIDEOS, 'scripts', 'inbox.py'), 'show', a.scene], capture_output=True,
                           text=True, timeout=15, cwd=VIDEOS)
        if r.stdout.strip():
            print(r.stdout.strip(), flush=True)
    except Exception:  # noqa: BLE001
        pass
    return drive(a, a.scene, segs, work, final, dur)


def drive(a, scene, segs, work, final, dur):
    only = set(int(x) for x in a.only.split(',')) if a.only else None
    state = {i: seg_done(work, i, n0, n1) for i, n0, n1 in segs}
    at = reconcile(work, scene, segs, state)
    sf = getattr(a, 'span_frames', None)
    if sf:
        total = segs[-1][2]
        for (fa, fb), (t0, t1) in zip(sf, getattr(a, 'spans_s', [(x / FPS, y / FPS) for x, y in sf])):
            if fa >= total:
                print('segrender: NOTICE span %.2f-%.2f s starts after the end of the piece (%.2f s); nothing to re-render for it' % (t0, t1, total / FPS))
            elif fb > total:
                print('segrender: NOTICE span %.2f-%.2f s runs past the end of the piece (%.2f s); clamped' % (t0, t1, total / FPS))
        redo = span_segments(segs, sf)
        for i in redo:
            state[i] = False
        if not any(state.values()):
            print('segrender: no cached segments yet in %s: rendering all %d to build the cache (a full render once); later --span runs redo only the changed ones' % (work, len(segs)))
        elif redo:
            print('segrender: span invalidates segment%s %s (%s); %d of %d stay cached' % ('s' if len(redo) > 1 else '', redo, ', '.join(
                '%.1f-%.1fs' % (n0 / FPS, n1 / FPS) for i, n0, n1 in segs if i in redo), sum(1 for v in state.values() if v), len(segs)))
        elif sf:
            print('segrender: the span touches no segment; rejoining the cache as it is')
    stale_src = []
    for f in (os.path.join(VIDEOS, 'web', 'scenes', scene + '.js'), os.path.join(VIDEOS, 'web', 'scenes', scene + '.html')):
        try:
            stale_src.append((f, os.path.getmtime(f)))
        except OSError:
            pass
    old_cached = [i for i in state if state[i] and at.get(i) and any(m > at[i] for _, m in stale_src)]
    if old_cached:
        print('segrender: NOTICE scene source (%s) changed after cached segment%s %s were rendered; they are reused as they are. '
              'Name the changed time with --span to re-render it.' % (', '.join(os.path.basename(f) for f, _ in stale_src), 's' if len(old_cached) > 1 else '', old_cached))
    print('segrender: %s %.2f s = %d frames in %d segments (%s), %d done, work %s' % (
        scene, dur, segs[-1][2], len(segs), ', '.join('%d:%.1f-%.1fs' % (i, n0 / FPS, n1 / FPS) for i, n0, n1 in segs[:6]) +
        (' ...' if len(segs) > 6 else ''), sum(state.values()), work))
    if a.plan:
        return 0
    save_manifest(work, scene, segs, state, at)
    if not a.join_only:
        for i, n0, n1 in segs:
            if only is not None and i not in only:
                continue
            if state[i] and only is None:
                continue
            k, wd = -1, 0
            while k < a.retries:
                k += 1
                ok, secs, rc = run_segment(scene, i, n0, n1, work, a)
                print('segrender: segment %d (%.1f-%.1f s) attempt %d: %s in %.0f s (exit %d)' % (
                    i, n0 / FPS, n1 / FPS, k + 1, 'ok' if ok else 'FAILED', secs, rc), flush=True)
                if ok:
                    state[i] = True
                    at[i] = time.time()
                    break
                if rc == EXIT_NOGPU:   # the job requires the GPU and this machine's Chromium only reached SwiftShader: stop now
                    print('segrender: segment %d: no hardware WebGL renderer and ACP_GPU=1 (exit %d); not retrying' % (i, rc), flush=True)
                    sys.exit(EXIT_NOGPU)
                if rc == EXIT_STALL:   # the render's progress watchdog gave its lane back: retry, without spending a retry
                    wd += 1
                    if wd <= getattr(a, 'stall_retries', 3):
                        print('segrender: segment %d stalled (render.mjs watchdog, exit %d); lane released, retrying (%d of %d stall retries)' % (
                            i, rc, wd, getattr(a, 'stall_retries', 3)), flush=True)
                        k -= 1
                        time.sleep(3)
                        continue
                try:
                    tail = open(os.path.join(seg_dir(work, i), 'render.log')).read()
                except OSError:
                    tail = ''
                if 'GB free (need' in tail and getattr(a, 'wait_disk', 0):   # --wait-disk: pause, then rerun without using a retry
                    import re
                    m = re.search(r'need ([0-9.]+) GB', tail)
                    if wait_for_disk(float(m[1]) if m else 1.5, work, a.wait_disk, free_fn=getattr(a, 'free_fn', None),
                                     sleep=getattr(a, 'sleep_fn', time.sleep)):
                        k -= 1
                        continue
                if 'GB free (need' in tail:  # render.mjs disk floor: retrying cannot help
                    print('segrender: stopped, the disk floor refused the render (%s). Free space, rerun to resume.' % tail.strip().split('\n')[-1][:120])
                    return 1
                time.sleep(3)
            save_manifest(work, scene, segs, state, at)
            if not state[i]:
                print('segrender: segment %d failed after %d attempts; log %s. Rerun the same command to resume.' % (
                    i, a.retries + 1, os.path.join(seg_dir(work, i), 'render.log')))
                return 1
    if only is not None:
        return 0
    missing = [i for i, n0, n1 in segs if not seg_done(work, i, n0, n1)]
    if missing:
        print('segrender: cannot join, segments not done: %s' % missing)
        return 1
    need = 2 * sum(os.path.getsize(seg_file(work, i)) for i, _, _ in segs) / 1e9 + 0.1   # video-only copy plus the muxed file
    free_fn = getattr(a, 'free_fn', None) or (lambda: free_gb(work))
    if free_fn() < need:
        print('segrender: NOTICE the join needs about %.2f GB and %.2f GB is free%s' % (need, free_fn(), '' if getattr(a, 'wait_disk', 0) else
              ' (--wait-disk MIN waits for space); trying anyway, the cached segments are safe either way'))
        if getattr(a, 'wait_disk', 0):
            wait_for_disk(need, work, a.wait_disk, free_fn=free_fn, sleep=getattr(a, 'sleep_fn', time.sleep))
    try:
        join(scene, segs, work, final, a)
    except (subprocess.CalledProcessError, OSError) as e:
        for f in (os.path.join(work, scene + '.video.mp4'), final[:-4] + '.part.mp4'):
            try:
                os.remove(f)
            except OSError:
                pass
        print('segrender: join failed (%s); %s was not touched and the cached segments are intact. Free disk and rerun with --join-only.' % (e, final))
        return 1
    print('segrender: joined %s (%.1f MB)' % (final, os.path.getsize(final) / 1e6))
    if not a.no_seam_check and len(segs) > 1:
        try:
            rows = seam_check(final, [n0 for _, n0, _ in segs[1:]])
            cuts = scene_cuts(scene)                                    # a join that lands on the scene's own cut is a cut, not a pop
            for r in rows:
                r['on_cut'] = any(abs(r['frame'] - c) <= 1 for c in cuts)
            bad = [r for r in rows if r['ratio'] > 3.0 and not r['on_cut']]
            oncut = [r for r in rows if r['ratio'] > 3.0 and r['on_cut']]
            print('segrender: seam check, %d joins, %d over 3x the local frame step off a scene cut%s%s' % (
                len(rows), len(bad), ''.join('\n  t=%.2fs step %.2f vs local %.2f (x%.1f)' % (r['t'], r['step'], r['local'], r['ratio']) for r in bad),
                ('\n  (%d more on the scene\'s own cuts: %s)' % (len(oncut), ', '.join('%.2fs' % r['t'] for r in oncut))) if oncut else ''))
            json.dump(rows, open(os.path.join(work, 'seams.json'), 'w'), indent=1)
        except Exception as e:
            print('segrender: seam check skipped (%s)' % e)
    if not a.keep:
        for i, _, _ in segs:
            shutil.rmtree(seg_dir(work, i), ignore_errors=True)
        print('segrender: segment clips removed (--keep or --cache to keep them)')
    else:
        print('segrender: cache kept: %s (%.0f MB; python3 videos/tools/segrender.py %s --drop-cache to delete it)' % (work, sum(dir_mb(d) for d in cache_dirs(work)), scene))
    return 0


def selftest():
    """No browser: a stub renderer makes gradient clips; checks plan, kill/resume, the join and the seam check."""
    import tempfile
    assert plan(300, 120) == [(0, 0, 120), (1, 120, 300)] or plan(300, 120) == [(0, 0, 120), (1, 120, 240), (2, 240, 300)]
    assert plan(1776, 120)[-1][2] == 1776 and plan(100, 120) == [(0, 0, 100)]
    tmp = tempfile.mkdtemp(prefix='segselftest')
    calls = []
    failing = [True]

    def stub(scene, i, n0, n1, work, args):
        calls.append(i)
        if failing[0] and i == 1 and calls.count(1) == 1:  # first attempt of segment 1 dies half way
            return ['sh', '-c', 'exit 9']
        out = os.path.join(seg_dir(work, i), 'stub.mp4')
        # a moving pattern; the phase depends on absolute time so a good join is continuous
        flt = "geq=lum='128+100*sin((X+(N+%d)*4)/30)':cb=128:cr=128" % n0
        return [ffmpeg(), '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=180x320:r=30:d=%s' % ((n1 - n0) / FPS),
                '-vf', flt, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]
    ns = argparse.Namespace(only=None, plan=False, join_only=False, retries=2, keep=False, no_seam_check=False,
                            render_args='', reuse_audio=False, wav=os.path.join(tmp, 'none.wav'), render_cmd_override=stub)
    segs = plan(180, 60)
    work = os.path.join(tmp, 'w')
    os.makedirs(work)
    final = os.path.join(tmp, 'final.mp4')
    rc = drive(ns, 'stub', segs, work, final, 6.0)
    assert rc == 0 and os.path.getsize(final) > 1000, rc
    assert calls.count(1) == 2, calls  # segment 1 retried once
    c = count_frames(final)
    assert abs(c - 180) <= 1, c
    rows = json.load(open(os.path.join(work, 'seams.json')))
    assert len(rows) == 2 and all(r['ratio'] < 3 for r in rows), rows
    # resume: keep clips, delete one, rerun; only that one renders
    ns.keep = True
    calls.clear()
    drive(ns, 'stub', segs, work, final, 6.0)
    calls.clear()
    shutil.rmtree(seg_dir(work, 2))
    drive(ns, 'stub', segs, work, final, 6.0)
    assert calls == [2], calls
    # disk floor: refused once, waits (fake free space), reruns the same segment without spending a retry
    work2 = os.path.join(tmp, 'w2')
    os.makedirs(work2)
    calls.clear()
    freeq = [0.2, 0.3, 2.0]
    def stub2(scene, i, n0, n1, work, args):
        calls.append(i)
        if i == 0 and calls.count(0) == 1:
            return ['sh', '-c', 'echo "render.mjs: only 0.20 GB free (need 1.5 GB)."; exit 3']
        calls.pop()
        return stub(scene, i, n0, n1, work, args)   # stub records the call itself
    ns2 = argparse.Namespace(**dict(vars(ns), render_cmd_override=stub2, retries=1, keep=False, wait_disk=5,
                                    free_fn=lambda: freeq.pop(0) if len(freeq) > 1 else freeq[0], sleep_fn=lambda s: None))
    rc2 = drive(ns2, 'stub', segs, work2, os.path.join(tmp, 'f2.mp4'), 6.0)
    assert rc2 == 0 and calls.count(0) == 2, (rc2, calls)
    ns2.wait_disk, ns2.free_fn = 0, None                       # without --wait-disk the old behaviour: stop, exit 1
    shutil.rmtree(work2); os.makedirs(work2); calls.clear()
    assert drive(ns2, 'stub', segs, work2, os.path.join(tmp, 'f3.mp4'), 6.0) == 1
    failing[0] = False
    # --- partial re-render (c23): span parsing, invalidation, rejoin, plan change, watchdog retry, drop-cache (no browser) ---
    import contextlib
    import io
    assert parse_spans('12-14,41.2-42') == [(12.0, 14.0), (41.2, 42.0)]
    assert abs(parse_spans('8-16', bpm=120, beats=True)[0][1] - 8.0) < 1e-9
    for bad in ('5', '3-2', 'a-b', ''):
        try:
            parse_spans(bad)
            raise AssertionError('accepted %r' % bad)
        except ValueError:
            pass
    sg = plan(180, 60)                                           # 0-60, 60-120, 120-180
    assert span_segments(sg, span_frames([(1.5, 2.5)])) == [0, 1]   # frames 45-75 straddle a join
    assert span_segments(sg, span_frames([(2.0, 2.5)])) == [1]      # starts exactly on the join: only the later segment
    assert span_segments(sg, span_frames([(0.0, 2.0)])) == [0]      # ends exactly on the join: only the earlier one
    assert span_segments(sg, span_frames([(0.2, 0.4), (5.0, 5.5)])) == [0, 2]
    assert span_segments(sg, span_frames([(7.0, 8.0)])) == []        # past the end
    w3 = os.path.join(tmp, 'w3'); os.makedirs(w3)
    f3 = os.path.join(tmp, 'f3.mp4')
    ns3 = argparse.Namespace(**dict(vars(ns), keep=True, retries=1, render_cmd_override=stub, span_frames=None))
    calls.clear()
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert drive(ns3, 'stub', sg, w3, f3, 6.0) == 0
    assert calls == [0, 1, 2], calls                                 # first run builds the whole cache
    mt = {i: os.path.getmtime(seg_file(w3, i)) for i in (0, 1, 2)}
    time.sleep(1.1)
    calls.clear()
    ns3.span_frames, ns3.spans_s = span_frames([(2.2, 2.7)]), [(2.2, 2.7)]    # a half second inside segment 1
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert drive(ns3, 'stub', sg, w3, f3, 6.0) == 0
    assert calls == [1], calls                                        # only the overlapping segment re-rendered
    assert os.path.getmtime(seg_file(w3, 0)) == mt[0] and os.path.getmtime(seg_file(w3, 2)) == mt[2] and os.path.getmtime(seg_file(w3, 1)) > mt[1]
    assert 'invalidates segment [1]' in out.getvalue() and '2 of 3 stay cached' in out.getvalue(), out.getvalue()
    assert abs(count_frames(f3) - 180) <= 1 and os.path.exists(os.path.join(w3, 'seams.json')), 'rejoin frame count'
    assert not os.path.exists(f3[:-4] + '.part.mp4')
    # a span that straddles a join re-renders both; one past the end is a notice and a plain rejoin
    calls.clear()
    ns3.span_frames, ns3.spans_s = span_frames([(1.9, 2.1)]), [(1.9, 2.1)]
    with contextlib.redirect_stdout(io.StringIO()):
        drive(ns3, 'stub', sg, w3, f3, 6.0)
    assert calls == [0, 1], calls
    calls.clear()
    ns3.span_frames, ns3.spans_s = span_frames([(9.0, 9.5)]), [(9.0, 9.5)]
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert drive(ns3, 'stub', sg, w3, f3, 6.0) == 0
    assert calls == [] and 'after the end of the piece' in out.getvalue(), (calls, out.getvalue())
    # the piece got longer (a song edit): 7 s = 210 frames. Segments 0-2 keep their ranges and are reused; the tail re-renders
    ns3.span_frames = None
    sg7 = plan(210, 60)                                               # 0-60, 60-120, 120-180, 180-210
    calls.clear()
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert drive(ns3, 'stub', sg7, w3, f3, 7.0) == 0
    assert calls == [3], calls
    assert 'plan changed' in out.getvalue() and 'was 180 frames' in out.getvalue() and 'now 210 frames' in out.getvalue(), out.getvalue()
    assert abs(count_frames(f3) - 210) <= 1
    # ... and one that grew so the LAST segment's range moved (tail absorbed): only that one re-renders
    calls.clear()
    sg8 = plan(190, 60)                                               # 0-60, 60-120, 120-190 (tail 10 < 15 absorbed)
    with contextlib.redirect_stdout(io.StringIO()):
        assert drive(ns3, 'stub', sg8, w3, f3, 190 / 30) == 0
    assert calls == [2], calls
    # a different segment length: nothing lines up, everything re-renders, in plain words, no failure
    calls.clear()
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert drive(ns3, 'stub', plan(190, 90), w3, f3, 190 / 30) == 0
    assert calls == [0, 1] and 'everything is re-rendered' in out.getvalue(), (calls, out.getvalue())
    # watchdog exit (75): retried without spending --retries (retries=0 here) and says so
    w4 = os.path.join(tmp, 'w4'); os.makedirs(w4)
    calls.clear()
    def stub3(scene, i, n0, n1, work, args):
        if i == 0 and calls.count(0) < 2:
            calls.append(0)
            return ['sh', '-c', 'exit %d' % EXIT_STALL]
        return stub(scene, i, n0, n1, work, args)
    ns4 = argparse.Namespace(**dict(vars(ns), render_cmd_override=stub3, retries=0, keep=False, span_frames=None, stall_retries=3))
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert drive(ns4, 'stub', sg, w4, os.path.join(tmp, 'f4.mp4'), 6.0) == 0
    assert out.getvalue().count('stalled (render.mjs watchdog') == 2, out.getvalue()
    # ... but a render that stalls every time gives up after --stall-retries
    w5 = os.path.join(tmp, 'w5'); os.makedirs(w5)
    ns5 = argparse.Namespace(**dict(vars(ns4), render_cmd_override=lambda *x: ['sh', '-c', 'exit %d' % EXIT_STALL], stall_retries=1))
    with contextlib.redirect_stdout(io.StringIO()):
        assert drive(ns5, 'stub', sg, w5, os.path.join(tmp, 'f5.mp4'), 6.0) == 1
    # drop-cache removes the clips and manifest but not the joined file
    keepme = os.path.join(w3, 'keep.txt'); open(keepme, 'w').write('x')
    mb = drop_cache(w3)
    assert mb > 0 and not cache_dirs(w3) and not os.path.exists(os.path.join(w3, MANIFEST)) and os.path.exists(keepme) and os.path.exists(f3)
    shutil.rmtree(tmp)
    print('segrender selftest: ok (plan, retry, resume, join, seam check, disk wait, span invalidation + rejoin, plan change, watchdog retry, drop-cache)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
