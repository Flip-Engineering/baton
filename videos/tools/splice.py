#!/usr/bin/env python3
"""splice.py: patch a frame range into an existing full render, and turn stills into a clip (TOOLING c11, 2026-09-29).

A full render of a heavy piece takes 1 to 4 hours; a fix to one shot should not. Render only the frames that changed
(or hand-make them), then replace that range in the master. The video is re-encoded once (libx264, crf 14, yuv420p);
the base audio track is copied untouched, so nothing is re-muxed and there is no AAC seam.

    # render frames 22.5-23.7 s of the scene and patch them into the master (writes NEW file, never the input)
    python3 videos/tools/splice.py render ready_c9 out/farm/ready_c9.mp4 --from 22.5 --to 23.7 -o /tmp/x/ready_c9_fix.mp4
    python3 videos/tools/splice.py render giant_c5 base.mp4 --from-beat 52 --to-beat 56 --reuse-audio -o fix.mp4

    # patch a clip you already have (any size/fps; scaled to the base) starting at a time or frame
    python3 videos/tools/splice.py clip base.mp4 patch.mp4 --at 22.5 -o fixed.mp4
    python3 videos/tools/splice.py clip base.mp4 patch.mp4 --at-frame 675 --frames 36 -o fixed.mp4

    # stills to a clip: a folder of PNG/JPG (sorted by name) or a glob, at 30 fps; --hold N repeats each still N frames
    python3 videos/tools/splice.py stills 'out/stills/*.png' --hold 6 -o stills.mp4
    python3 videos/tools/splice.py stills DIR --at 22.5 --into base.mp4 -o fixed.mp4     # make it and patch it in

    python3 videos/tools/splice.py --selftest                # synthetic, no browser, ~10 s

Rules: the output has exactly the base's frame count, size, fps and audio; a patch shorter than the range is an error
unless --hold-last (repeat its last frame); a longer patch is cut. The join is reported (frame step across each seam
against the local median, as segrender's seam check) and never fails the run. `-o` is required and may not equal the
base; nothing tracked by git is written by the tool itself. Frames are seeked by t, so a scene that integrates state
from t=0 will not match its continuous render: check the seam line, as with segrender.

Python API: splice(base, patch, start_frame, n_frames=None, out=..., hold_last=False) -> dict;
stills_to_clip(paths, out, fps=30, hold=1, size=None) -> n_frames.
Exit: 0 ok, 1 failure, 2 usage.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
FPS = 30


# colour tags for every encode (web/enc_args.mjs COLOR): the masters are BT.709 since STUDIO FINISH c1
COLOR709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']
# Both sides of a join are converted to BT.709 before concat: published masters before 1 Oct are untagged BT.601
# (in_color_matrix=auto reads them as 601), new renders are tagged 709 (a no-op). Without this the base keeps its
# 601 numbers under a 709 tag and every splice shows a colour jump at both seams (FINISH c1 judge, 1 Oct).
TO709 = 'scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int'

def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg') or 'ffmpeg'


def probe(path):
    """{w, h, fps, frames, has_audio, dur} from ffmpeg's header (no ffprobe needed); frames counted by decode when the
    header duration is not frame-exact."""
    p = subprocess.run([ffmpeg(), '-hide_banner', '-i', path], capture_output=True, text=True)
    s = p.stderr
    m = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', s)
    v = re.search(r'Video: .*?, (\d+)x(\d+)[^,]*, (?:.*?, )?([\d.]+) fps', s)
    if not m or not v:
        raise SystemExit(f'splice: cannot read {path}')
    dur = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    fps = float(v[3])
    return dict(w=int(v[1]), h=int(v[2]), fps=fps, dur=dur, frames=round(dur * fps), has_audio='Audio:' in s)


def exact_frames(path):
    p = subprocess.run([ffmpeg(), '-v', 'error', '-i', path, '-map', '0:v:0', '-f', 'null', '-', '-progress', 'pipe:1'],
                       capture_output=True, text=True)
    n = re.findall(r'frame=\s*(\d+)', p.stdout + p.stderr)
    return int(n[-1]) if n else probe(path)['frames']


def stills_to_clip(paths, out, fps=FPS, hold=1, size=None):
    """Encode still images (in the order given) as a clip; each held `hold` frames. Returns the frame count."""
    if isinstance(paths, str):
        paths = sorted(glob.glob(os.path.join(paths, '*')) if os.path.isdir(paths) else glob.glob(paths))
    paths = [p for p in paths if p.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
    if not paths:
        raise SystemExit('splice: no stills found')
    d = tempfile.mkdtemp(prefix='splice_stills_')
    try:
        for i, p in enumerate(paths):
            ext = os.path.splitext(p)[1].lower()
            os.symlink(os.path.abspath(p), os.path.join(d, 'f%05d%s' % (i, ext)))
        exts = {os.path.splitext(p)[1].lower() for p in paths}
        if len(exts) > 1:
            raise SystemExit('splice: mix of image types; convert first: ' + ', '.join(sorted(exts)))
        # BT.709 + tags like render.mjs (web/enc_args.mjs, STUDIO FINISH c1), so a patch matches a 709 master
        vf = ['scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd', 'format=yuv420p']
        if size:
            vf.insert(0, 'scale=%d:%d' % size)
        cmd = [ffmpeg(), '-y', '-v', 'error', '-framerate', repr(fps / hold), '-i', os.path.join(d, 'f%05d' + exts.pop()),
               '-vf', ','.join(vf), '-r', repr(fps), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', *COLOR709, out]
        subprocess.run(cmd, check=True)
        return len(paths) * hold
    finally:
        shutil.rmtree(d, ignore_errors=True)


def splice(base, patch, start_frame, n_frames=None, out=None, hold_last=False):
    """Replace base frames [start_frame, start_frame+n) with the first n frames of `patch`. n defaults to the patch's
    length. Returns a report dict."""
    if not out or os.path.abspath(out) == os.path.abspath(base):
        raise SystemExit('splice: -o must be given and must not be the base file')
    b, p = probe(base), probe(patch)
    bf, pf = exact_frames(base), exact_frames(patch)
    n = n_frames if n_frames is not None else pf
    if start_frame < 0 or start_frame + n > bf:
        raise SystemExit(f'splice: range {start_frame}-{start_frame + n} is outside the base ({bf} frames)')
    if pf < n and not hold_last:
        raise SystemExit(f'splice: patch has {pf} frames, range needs {n} (use --hold-last to repeat its last frame)')
    e = start_frame + n
    fc = []
    parts = []
    if start_frame > 0:
        fc.append(f'[0:v]{TO709},trim=start_frame=0:end_frame={start_frame},setpts=PTS-STARTPTS[a]')
        parts.append('[a]')
    pad = f',tpad=stop_mode=clone:stop={n - pf}' if pf < n else ''
    fc.append(f'[1:v]{TO709},scale={b["w"]}:{b["h"]}:flags=lanczos,fps={b["fps"]:g},setsar=1,trim=start_frame=0:end_frame={n}'
              f'{pad},setpts=PTS-STARTPTS[p]')
    parts.append('[p]')
    if e < bf:
        fc.append(f'[0:v]{TO709},trim=start_frame={e}:end_frame={bf},setpts=PTS-STARTPTS[c]')
        parts.append('[c]')
    fc.append(''.join(parts) + f'concat=n={len(parts)}:v=1:a=0,format=yuv420p[v]')
    cmd = [ffmpeg(), '-y', '-v', 'error', '-i', base, '-i', patch, '-filter_complex', ';'.join(fc), '-map', '[v]']
    if b['has_audio']:
        cmd += ['-map', '0:a', '-c:a', 'copy']
    cmd += ['-fps_mode', 'passthrough', '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p', *COLOR709, '-movflags', '+faststart', out]
    subprocess.run(cmd, check=True)
    of = exact_frames(out)
    rep = dict(base=base, out=out, start_frame=start_frame, frames=n, end_frame=e, base_frames=bf, out_frames=of,
               frames_match=(of == bf), seams=seam_report(out, [start_frame, e], b['fps']))
    return rep


def splice_multi(base, patches, out, hold_last=False):
    """Several patches, ONE re-encode. patches = [(start_frame, patch_path, n_frames_or_None), ...] (any order, no overlap).
    Same rules as splice(). Returns the report dict with a seam entry at every join."""
    if not out or os.path.abspath(out) == os.path.abspath(base):
        raise SystemExit('splice: -o must be given and must not be the base file')
    b = probe(base)
    bf = exact_frames(base)
    items = []
    for st, pp, n in patches:
        pf = exact_frames(pp)
        n = n if n is not None else pf
        if st < 0 or st + n > bf:
            raise SystemExit(f'splice: range {st}-{st + n} is outside the base ({bf} frames); nothing written, patch {pp} kept')
        if pf < n and not hold_last:
            raise SystemExit(f'splice: patch {pp} has {pf} frames, range needs {n} (use hold_last)')
        items.append((st, pp, n, pf))
    items.sort()
    for (s0, _, n0, _), (s1, _, _, _) in zip(items, items[1:]):
        if s0 + n0 > s1:
            raise SystemExit(f'splice: patches overlap at frame {s1}')
    fc, parts, pos, ins = [], [], 0, ['-i', base]
    for i, (st, pp, n, pf) in enumerate(items):
        if st > pos:
            fc.append(f'[0:v]{TO709},trim=start_frame={pos}:end_frame={st},setpts=PTS-STARTPTS[b{i}]')
            parts.append(f'[b{i}]')
        pad = f',tpad=stop_mode=clone:stop={n - pf}' if pf < n else ''
        ins += ['-i', pp]
        fc.append(f'[{i + 1}:v]{TO709},scale={b["w"]}:{b["h"]}:flags=lanczos,fps={b["fps"]:g},setsar=1,'
                  f'trim=start_frame=0:end_frame={n}{pad},setpts=PTS-STARTPTS[p{i}]')
        parts.append(f'[p{i}]')
        pos = st + n
    if pos < bf:
        fc.append(f'[0:v]{TO709},trim=start_frame={pos}:end_frame={bf},setpts=PTS-STARTPTS[bz]')
        parts.append('[bz]')
    fc.append(''.join(parts) + f'concat=n={len(parts)}:v=1:a=0,format=yuv420p[v]')
    cmd = [ffmpeg(), '-y', '-v', 'error', *ins, '-filter_complex', ';'.join(fc), '-map', '[v]']
    if b['has_audio']:
        cmd += ['-map', '0:a', '-c:a', 'copy']
    cmd += ['-fps_mode', 'passthrough', '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p', *COLOR709, '-movflags', '+faststart', out]
    subprocess.run(cmd, check=True)
    of = exact_frames(out)
    joins = sorted({j for st, _, n, _ in items for j in (st, st + n) if 0 < j < bf})
    return dict(base=base, out=out, patches=[(st, n) for st, _, n, _ in items], base_frames=bf, out_frames=of,
                frames_match=(of == bf), seams=seam_report(out, joins, b['fps']))


def _steps(path, f0, w=90):
    """Mean abs gray diff between consecutive frames starting at frame f0-3 (up to 7 frames): [step,...]."""
    import numpy as np
    h = w * 16 // 9
    t0 = max(0, (f0 - 3) / FPS)
    p = subprocess.run([ffmpeg(), '-v', 'error', '-ss', repr(t0), '-i', path, '-frames:v', '7', '-vf',
                        'scale=%d:%d,format=gray' % (w, h), '-f', 'rawvideo', '-'], capture_output=True)
    b = np.frombuffer(p.stdout, np.uint8)
    n = len(b) // (w * h)
    if n < 3:
        return []
    f = b[:n * w * h].reshape(n, h, w).astype(np.float32)
    return [float(np.abs(f[k + 1] - f[k]).mean()) for k in range(n - 1)]


def seam_report(path, frames, fps=FPS):
    """For each join frame, the step across the join against the median step next to it. ratio > 3 is a pop (reported,
    never failing: a real cut in the scene at that frame looks the same)."""
    import numpy as np
    out = []
    for f in frames:
        if f <= 0:
            continue
        s = _steps(path, f)
        if len(s) < 3:
            continue
        k = min(min(3, f) - 1, len(s) - 1)   # index of the step across the join (frame f-1 -> f)
        neigh = [x for i, x in enumerate(s) if i != k]
        med = float(np.median(neigh)) if neigh else 0.0
        out.append(dict(frame=f, t=round(f / fps, 3), step=round(s[k], 2), local_median=round(med, 2),
                        ratio=round(s[k] / med, 1) if med > 0.05 else None, pop=bool(s[k] > 1.0 and s[k] > 3 * med)))
    return out


def print_report(r):
    rng = (f"frames {r['start_frame']}-{r['end_frame']} ({r['start_frame'] / FPS:.2f}-{r['end_frame'] / FPS:.2f} s)"
           if 'start_frame' in r else f"{len(r['patches'])} patches {r['patches']}")
    print(f"spliced {rng} "
          f"into {os.path.basename(r['base'])}: {r['out_frames']} frames (base {r['base_frames']}) -> {r['out']}")
    if not r['frames_match']:
        print('  WARNING: output frame count differs from the base')
    for s in r['seams']:
        print(f"  seam @ frame {s['frame']} ({s['t']} s): step {s['step']} vs local {s['local_median']}"
              + (f"  x{s['ratio']}" if s['ratio'] else '') + ('  POP (check: a scene cut here looks the same)' if s['pop'] else ''))


def _render_range(scene, a, b, workdir, extra):
    cmd = ['node', os.path.join(VIDEOS, 'web', 'render.mjs'), scene, '--from', repr(a / FPS), '--to', repr(b / FPS), '--out', workdir] + extra
    env = dict(os.environ, ACP_CODEC='0')
    r = subprocess.run(cmd, cwd=VIDEOS, env=env)
    if r.returncode not in (0, 3):
        raise SystemExit(f'splice: render.mjs failed ({r.returncode})')
    g = [f for f in sorted(glob.glob(os.path.join(workdir, '*.mp4'))) if not f.endswith('.ct.mp4')]
    if not g:
        raise SystemExit('splice: render.mjs wrote no clip')
    return g[0]


def _beat_s(scene, beat):
    hp = os.path.join(VIDEOS, 'out', f'.{scene}.hits.json')
    for p in (hp, os.path.join(VIDEOS, 'out', f'{scene}.hits.json')):
        if os.path.exists(p):
            bpm = json.load(open(p)).get('bpm')
            if bpm:
                return beat * 60.0 / bpm
    raise SystemExit(f'splice: no BPM for {scene} (no hits.json in out/); use --from/--to seconds')


def _selftest():
    d = tempfile.mkdtemp(prefix='splice_test_')
    ok = True

    def chk(name, cond, extra=''):
        nonlocal ok
        ok &= bool(cond)
        print(('ok   ' if cond else 'FAIL ') + name + (' ' + extra if extra else ''))
    try:
        ff = ffmpeg()
        base = os.path.join(d, 'base.mp4')
        subprocess.run([ff, '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x204060:s=180x320:r=30:d=4', '-f', 'lavfi', '-i',
                        'sine=f=440:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', base], check=True)
        # stills: 6 red PNGs -> clip with hold 3 = 18 frames
        sd = os.path.join(d, 's')
        os.makedirs(sd)
        for i in range(6):
            subprocess.run([ff, '-y', '-v', 'error', '-f', 'lavfi', '-i', f'color=c=0xc02020:s=90x160', '-frames:v', '1',
                            os.path.join(sd, f'{i:02d}.png')], check=True)
        clip = os.path.join(d, 'st.mp4')
        n = stills_to_clip(sd, clip, hold=3)
        chk('stills_to_clip frames', n == 18 and exact_frames(clip) == 18, f'({n})')
        out = os.path.join(d, 'out.mp4')
        r = splice(base, clip, 45, out=out)
        bf = exact_frames(base)
        chk('frame count kept', r['frames_match'] and r['out_frames'] == bf, f'({r["out_frames"]}/{bf})')
        chk('size kept', (probe(out)['w'], probe(out)['h']) == (180, 320))
        chk('audio kept', probe(out)['has_audio'])
        # the patched range is red, the rest is blue: sample mean R
        def red(f):
            p = subprocess.run([ff, '-v', 'error', '-i', out, '-vf', f'select=eq(n\\,{f}),scale=1:1,format=rgb24', '-frames:v', '1',
                                '-f', 'rawvideo', '-'], capture_output=True)
            return p.stdout[0] if p.stdout else -1
        chk('inside range is patched', red(50) > 150 and red(44) < 100 and red(63) < 100, f'(R {red(44)},{red(50)},{red(63)})')
        chk('two seams reported', len(r['seams']) == 2 and all(s['pop'] for s in r['seams']), str([s['ratio'] for s in r['seams']]))
        # short patch needs --hold-last
        try:
            splice(base, clip, 10, n_frames=30, out=os.path.join(d, 'x.mp4'))
            chk('short patch refused', False)
        except SystemExit:
            chk('short patch refused', True)
        r2 = splice(base, clip, 10, n_frames=30, out=os.path.join(d, 'y.mp4'), hold_last=True)
        chk('hold-last', r2['frames_match'])
        try:
            splice(base, clip, 0, out=base)
            chk('refuses to overwrite base', False)
        except SystemExit:
            chk('refuses to overwrite base', True)
        r3 = splice(base, clip, 0, out=os.path.join(d, 'z.mp4'))     # range at the start: one seam only
        chk('start-of-file range', r3['frames_match'] and len(r3['seams']) == 1)
        # multi: two single-frame patches and one range, one re-encode
        one = os.path.join(d, 'one.mp4')
        subprocess.run([ff, '-y', '-v', 'error', '-i', clip, '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', one], check=True)
        mo = os.path.join(d, 'm.mp4')
        rm = splice_multi(base, [(80, one, None), (20, one, None), (50, clip, 6)], mo)
        chk('multi frame count', rm['frames_match'], f'({rm["out_frames"]}/{bf})')
        chk('multi seams at every join', len(rm['seams']) == 6, str(len(rm['seams'])))
        try:
            splice_multi(base, [(10, clip, None), (15, clip, None)], os.path.join(d, 'o.mp4'))
            chk('multi overlap refused', False)
        except SystemExit:
            chk('multi overlap refused', True)
        try:
            splice_multi(base, [(bf - 2, clip, None)], os.path.join(d, 'q.mp4'))
            chk('past-end refused, patch kept', os.path.exists(clip))
        except SystemExit:
            chk('past-end refused, patch kept', os.path.exists(clip))
    finally:
        shutil.rmtree(d, ignore_errors=True)
    print('selftest', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
        sys.exit(_selftest())
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd')
    r = sub.add_parser('render')
    r.add_argument('scene')
    r.add_argument('base')
    r.add_argument('--from', dest='t0', type=float)
    r.add_argument('--to', dest='t1', type=float)
    r.add_argument('--from-beat', type=float)
    r.add_argument('--to-beat', type=float)
    r.add_argument('--reuse-audio', action='store_true')
    r.add_argument('--render-args', default='')
    r.add_argument('-o', '--out', required=True)
    r.add_argument('--keep', action='store_true')
    c = sub.add_parser('clip')
    c.add_argument('base')
    c.add_argument('patch')
    c.add_argument('--at', type=float)
    c.add_argument('--at-frame', type=int)
    c.add_argument('--frames', type=int)
    c.add_argument('--hold-last', action='store_true')
    c.add_argument('-o', '--out', required=True)
    m = sub.add_parser('multi', help='several patches, one re-encode: multi BASE -o OUT SPEC [SPEC...]; SPEC = SECONDS:clip.mp4 or fFRAME:clip.mp4')
    m.add_argument('base')
    m.add_argument('specs', nargs='+')
    m.add_argument('--hold-last', action='store_true')
    m.add_argument('-o', '--out', required=True)
    s = sub.add_parser('stills')
    s.add_argument('src', help='directory or glob of stills')
    s.add_argument('--hold', type=int, default=1)
    s.add_argument('--fps', type=float, default=FPS)
    s.add_argument('--at', type=float)
    s.add_argument('--at-frame', type=int)
    s.add_argument('--into')
    s.add_argument('--hold-last', action='store_true')
    s.add_argument('-o', '--out', required=True)
    a = ap.parse_args()
    if not a.cmd:
        print(__doc__)
        sys.exit(2)
    if a.cmd == 'stills':
        if a.into:
            tmp = a.out + '.stills.mp4'
            n = stills_to_clip(a.src, tmp, a.fps, a.hold, size=(probe(a.into)['w'], probe(a.into)['h']))
            at = a.at_frame if a.at_frame is not None else round((a.at or 0) * FPS)
            try:
                print_report(splice(a.into, tmp, at, out=a.out, hold_last=a.hold_last))
            finally:
                os.remove(tmp)
        else:
            print(stills_to_clip(a.src, a.out, a.fps, a.hold), 'frames ->', a.out)
        return
    if a.cmd == 'multi':
        pl = []
        for sp in a.specs:
            k, _, f = sp.partition(':')
            if not f:
                sys.exit(f'splice multi: bad spec {sp!r}; want SECONDS:clip or fFRAME:clip')
            pl.append((int(k[1:]) if k[:1] == 'f' else round(float(k) * FPS), f, None))
        r = splice_multi(a.base, pl, a.out, a.hold_last)
        print('multi:', len(pl), 'patches, one re-encode,', r['out_frames'], 'of', r['base_frames'], 'frames')
        print_report(r)
        return
    if a.cmd == 'clip':
        at = a.at_frame if a.at_frame is not None else (round(a.at * FPS) if a.at is not None else None)
        if at is None:
            sys.exit('splice clip: give --at or --at-frame')
        print_report(splice(a.base, a.patch, at, a.frames, a.out, a.hold_last))
        return
    if a.t0 is None and a.from_beat is not None:
        a.t0 = _beat_s(a.scene, a.from_beat)
    if a.t1 is None and a.to_beat is not None:
        a.t1 = _beat_s(a.scene, a.to_beat)
    if a.t0 is None or a.t1 is None:
        sys.exit('splice render: give --from/--to (seconds) or --from-beat/--to-beat')
    f0, f1 = round(a.t0 * FPS), round(a.t1 * FPS)
    bf = exact_frames(a.base)
    if f0 >= bf:
        sys.exit(f'splice render: --from {a.t0} s is past the base ({bf} frames = {bf / FPS:.2f} s); nothing rendered')
    if f1 > bf:   # a --to a few frames past the last frame is the usual slip: clamp it, say so
        print(f'splice render: --to {a.t1} s is past the base end ({bf / FPS:.3f} s); clamped to the last frame')
        f1 = bf
    wd = tempfile.mkdtemp(prefix='splice_render_', dir=os.path.join(VIDEOS, 'out'))
    ok = False
    try:
        clip = _render_range(a.scene, f0, f1, wd, (['--reuse-audio'] if a.reuse_audio else []) + a.render_args.split())
        # patch may come back a frame or two short/long of the request: splice what exists, hold the last frame
        n = min(f1 - f0, exact_frames(clip)) if exact_frames(clip) >= (f1 - f0) - 2 else f1 - f0
        print_report(splice(a.base, clip, f0, n, a.out, hold_last=True))
        ok = True
    finally:
        if ok and not a.keep:
            shutil.rmtree(wd, ignore_errors=True)
        elif not ok:   # never throw away a rendered patch because the join failed: it can cost an hour
            print(f'splice render: join failed; the rendered patch is KEPT in {wd} (use: splice.py clip BASE <patch> --at {a.t0} -o OUT)')


if __name__ == '__main__':
    main()
