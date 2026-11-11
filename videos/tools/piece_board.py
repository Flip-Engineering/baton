#!/usr/bin/env python3
"""piece_board: see a whole piece, or several versions of it, on one aligned board. Report only; it never fails a piece.

Why: reviewing a 35 s piece meant a contact sheet with no timestamps (this box's ffmpeg has no drawtext), a separate
loudness log, a separate text timeline, and nothing that put v10 and v11 on one time axis. This lays them out together.

One lane per video, all on one shared x axis (seconds, or --norm for 0..1 of each piece's own length):
  frames   thumbnails at equal steps, each stamped with its time (and beat, when --bpm is given)
  cuts     a tick per detected cut (low-res frame difference), the number of cuts in the lane label
  loud     ffmpeg ebur128 momentary loudness as a curve, a guide line at -14 LUFS (about where YouTube and Spotify play a
           louder piece), integrated LUFS in the label
  text     (optional, --timeline FILE) one bar per text frame: width = its hold, height = words per second, the frame's
           words printed inside when they fit. How the words read is judged by watching the piece.
Beat gridlines are drawn when --bpm is given, and a dashed line marks --closer (the beat of the ACP lockup).

Usage:
  piece_board.py A.mp4 [B.mp4 ...] [--label v10 --label v11] [--timeline tlA.txt --timeline tlB.txt]
                 [--bpm 150] [--closer 88] [--norm] [--width 1800] [--out board.jpg] [--json summary.json]
  piece_board.py --diff-text tlA.txt tlB.txt     # word-level diff of two text timelines (what changed between versions)
  piece_board.py --selftest                      # synthetic clips, no repo files; needs only ffmpeg + PIL + numpy

--timeline takes the builders' timeline format ("beat t(s) hold(s) words w/s frame" rows, as in
review/red_wedge_c7/timeline_v11.txt), a markdown table with t (s), text/frame and hold columns (MECHA c7, ACCELERATE v5), or a plain "t<TAB>hold<TAB>text" file. Give one per video, in order, or none.
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FFMPEG = os.environ.get('FFMPEG') or next((p for p in [
    '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2',
    '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux'] if os.path.exists(p)), 'ffmpeg')
_FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']


def font(sz):
    for f in _FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, **kw)


# ---------------------------------------------------------------- probing and decoding
def probe(path):
    r = run([FFMPEG, '-hide_banner', '-i', path], text=True)
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r.stderr)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0
    m = re.search(r'(\d+(?:\.\d+)?) fps', r.stderr)
    fps = float(m.group(1)) if m else 30.0
    m = re.search(r'Video: .*?, (\d{2,5})x(\d{2,5})', r.stderr)
    wh = (int(m.group(1)), int(m.group(2))) if m else (1080, 1920)
    return dur, fps, wh, 'Audio:' in r.stderr


def small_frames(path, fps, w=36, h=64):
    """Every frame at w x h grey, one pass, no files: uint8 (N, h, w)."""
    r = run([FFMPEG, '-hide_banner', '-v', 'error', '-i', path, '-an', '-vf', f'scale={w}:{h}:flags=area,format=gray',
             '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'])
    a = np.frombuffer(r.stdout, np.uint8)
    n = len(a) // (w * h)
    return a[:n * w * h].reshape(n, h, w)


def find_cuts(fr, fps, thresh=0.08, min_gap_s=0.12):
    """Cut times from the mean absolute low-res frame difference. A cut is a jump over `thresh` (of 255) that is also
    well above the frames around it, so a fast camera move or a flash is not a cut. Report-only heuristic."""
    if len(fr) < 3:
        return [], np.zeros(0)
    d = np.abs(np.diff(fr.astype(np.int16), axis=0)).mean(axis=(1, 2)) / 255.0
    cuts, last = [], -9
    for i, v in enumerate(d):
        nb = np.r_[d[max(0, i - 3):i], d[i + 1:i + 4]]
        ref = np.median(nb) if len(nb) else 0
        if v > thresh and v > 2.5 * ref and (i + 1) / fps - last >= min_gap_s:
            cuts.append((i + 1) / fps)
            last = cuts[-1]
    return cuts, d


def thumbs(path, dur, n, tw, th):
    """n thumbnails at the middle of n equal slices of the piece."""
    out = []
    for i in range(n):
        t = min(max(dur - 0.05, 0), (i + 0.5) * dur / n)
        r = run([FFMPEG, '-hide_banner', '-v', 'error', '-ss', f'{t:.3f}', '-i', path, '-frames:v', '1', '-vf',
                 f'scale={tw}:{th}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
        b = np.frombuffer(r.stdout, np.uint8)
        if b.size == tw * th * 3:
            out.append((t, Image.fromarray(b.reshape(th, tw, 3))))
        else:
            out.append((t, Image.new('RGB', (tw, th), (40, 40, 40))))
    return out


def loudness(path):
    r = run([FFMPEG, '-hide_banner', '-nostats', '-v', 'verbose', '-i', path, '-vn', '-af',
             'ebur128=peak=true:framelog=verbose', '-f', 'null', '-'], text=True)
    e = r.stderr
    log = [(float(t), float(m)) for t, m in re.findall(r't:\s*([\d.]+)\s+TARGET:.*?M:\s*(-?[\d.]+|-inf)', e)
           if m != '-inf']
    summ = e[e.rfind('Summary:'):] if 'Summary:' in e else ''
    g = lambda p: (float(re.search(p, summ, re.S).group(1)) if re.search(p, summ, re.S) else None)
    return {'I': g(r'Integrated loudness:.*?I:\s*(-?[\d.]+)'), 'LRA': g(r'Loudness range:.*?LRA:\s*(-?[\d.]+)'),
            'TP': g(r'True peak:.*?Peak:\s*(-?[\d.]+)'), 'log': log}


# ---------------------------------------------------------------- text timelines
ROW = re.compile(r'^\s*(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s+(\d+)\s+([\d.]+)\s+(.*?)\s*$')
TSV = re.compile(r'^\s*([\d.]+)[\t,]\s*([\d.]+)[\t,]\s*(.+?)\s*$')


def read_timeline(path):
    """[{t, hold, words, wps, text}] from the builders' timeline format or a plain t/hold/text file."""
    rows, hdr = [], None
    for ln in open(path, encoding='utf-8', errors='replace'):
        if ln.lstrip().startswith('|'):  # markdown table: columns found by header name
            cells = [c.strip() for c in ln.strip().strip('|').split('|')]
            low = [c.lower() for c in cells]
            if any(c.startswith('t (s)') or c in ('t', 's') for c in low) and any(
                    c.startswith('text') or c.startswith('frame') for c in low):
                hdr = {'t': next(i for i, c in enumerate(low) if c.startswith('t (s)') or c in ('t', 's')),
                       'text': next(i for i, c in enumerate(low) if c.startswith('text') or c.startswith('frame')),
                       'hold': next((i for i, c in enumerate(low) if c.startswith('hold')), None)}
                continue
            if hdr and len(cells) > max(v for v in hdr.values() if v is not None):
                try:
                    t = float(cells[hdr['t']])
                    hold = float(cells[hdr['hold']]) if hdr['hold'] is not None else 1.0
                except ValueError:
                    continue
                txt = re.sub(r'<-+.*$', '', cells[hdr['text']]).replace('*', '').strip()
                if txt and not txt.startswith('('):
                    w = len(txt.split())
                    rows.append({'t': t, 'hold': hold, 'words': w, 'wps': w / hold if hold else 0, 'text': txt})
            continue
        m = ROW.match(ln)
        if m:
            txt = re.sub(r'\s*<--.*$', '', m.group(6))
            if txt.startswith('(no text)'):
                continue
            rows.append({'t': float(m.group(2)), 'hold': float(m.group(3)), 'words': int(m.group(4)),
                         'wps': float(m.group(5)), 'text': txt})
            continue
        m = TSV.match(ln)
        if m:
            txt = m.group(3)
            w = len(txt.split())
            hold = float(m.group(2))
            rows.append({'t': float(m.group(1)), 'hold': hold, 'words': w, 'wps': w / hold if hold else 0, 'text': txt})
    return rows


def diff_text(a, b):
    ta = [r['text'] for r in read_timeline(a)]
    tb = [r['text'] for r in read_timeline(b)]
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ta, tb, autojunk=False).get_opcodes():
        if op == 'equal':
            out += [f'  {x}' for x in ta[i1:i2]]
        else:
            out += [f'- {x}' for x in ta[i1:i2]] + [f'+ {x}' for x in tb[j1:j2]]
    kept = sum(1 for x in out if x.startswith('  '))
    out.append(f'\n{kept} frames kept, {sum(x.startswith("- ") for x in out)} only in A, '
               f'{sum(x.startswith("+ ") for x in out)} only in B')
    return '\n'.join(out)


# ---------------------------------------------------------------- the board
BG, FG, DIM, GRID = (16, 16, 18), (235, 235, 235), (140, 140, 150), (48, 48, 54)


def loud_lane(dr, x0, y0, W, H, log, tmax, xmap, f):
    dr.rectangle([x0, y0, x0 + W, y0 + H], fill=(22, 22, 26))
    lo, hi = -30.0, -3.0
    ymap = lambda v: y0 + H - (min(max(v, lo), hi) - lo) / (hi - lo) * H
    for g, c in ((-14, (60, 90, 60)),):
        dr.line([x0, ymap(g), x0 + W, ymap(g)], fill=c)
        dr.text((x0 + 2, ymap(g) - 10), f'{g}', font=f, fill=c)
    pts = [(xmap(t), ymap(m)) for t, m in log if t <= tmax]
    if len(pts) > 1:
        dr.line(pts, fill=(255, 190, 60), width=2)


def text_lane(dr, x0, y0, W, H, rows, xmap, f):
    dr.rectangle([x0, y0, x0 + W, y0 + H], fill=(22, 22, 26))
    top = 8.0
    for r in rows:
        xa, xb = xmap(r['t']), xmap(r['t'] + r['hold'])
        hh = max(3, min(1.0, r['wps'] / top) * (H - 2))
        col = (120, 170, 235)
        dr.rectangle([xa, y0 + H - hh, max(xa + 1, xb - 1), y0 + H], fill=col)
        if xb - xa > 34:
            ws, words = r['text'].split(), ''
            for w in ws:
                cand = (words + ' ' + w).strip()
                if dr.textlength(cand + ('..' if cand != r['text'] else ''), font=f) > xb - xa - 4:
                    break
                words = cand
            if words and words != r['text']:
                words += '..'
            dr.text((xa + 2, y0 + 2), words, font=f, fill=(255, 255, 255))


def build(videos, labels, timelines, bpm=None, closer=None, norm=False, width=1800, warn=None, out='board.jpg'):
    f, fb = font(11), font(13)
    LM = 150
    infos = []
    for i, v in enumerate(videos):
        dur, fps, (w, h), has_a = probe(v)
        fr = small_frames(v, fps)
        cuts, _ = find_cuts(fr, fps)
        ld = loudness(v) if has_a else {'I': None, 'LRA': None, 'TP': None, 'log': []}
        tl = read_timeline(timelines[i]) if i < len(timelines) and timelines[i] else []
        infos.append(dict(path=v, label=labels[i], dur=dur, fps=fps, wh=(w, h), cuts=cuts, ld=ld, tl=tl))
    tmax = max(i['dur'] for i in infos)
    PW = width - LM - 10
    xmap_for = lambda inf: (lambda t: LM + (t / (inf['dur'] if norm else tmax)) * PW)
    th = 120
    tw = max(20, int(th * infos[0]['wh'][0] / infos[0]['wh'][1]))
    lane_h = th + 30 + 62 + (56 if any(i['tl'] for i in infos) else 0) + 22
    H = 36 + lane_h * len(infos) + 10
    img = Image.new('RGB', (width, H), BG)
    dr = ImageDraw.Draw(img)
    # axis
    span = 1.0 if norm else tmax
    step = 0.1 if norm else (1 if tmax <= 40 else 2 if tmax <= 90 else 5)
    k = 0.0
    while k <= span + 1e-6:
        x = LM + k / span * PW
        dr.line([x, 28, x, H - 6], fill=GRID)
        dr.text((x + 2, 14), f'{k:.1f}' if norm else f'{k:g}s', font=f, fill=DIM)
        k += step
    if bpm and not norm:
        spb = 60.0 / bpm
        b = 0
        while b * spb <= tmax:
            if b % 4 == 0:
                x = LM + b * spb / tmax * PW
                dr.line([x, 28, x, 34], fill=(200, 200, 90))
            b += 1
    summary = []
    y = 36
    for inf in infos:
        xm = xmap_for(inf)
        dur = inf['dur']
        n = max(2, int(PW * (1.0 if norm else dur / tmax) // (tw + 2)))
        for t, im in thumbs(inf['path'], dur, n, tw, th):
            x = int(xm(t) - tw / 2)
            img.paste(im, (x, y))
            lab = f'{t:.1f}' + (f' b{t * bpm / 60:.0f}' if bpm else '')
            dr.rectangle([x, y + th - 12, x + tw, y + th], fill=(0, 0, 0))
            dr.text((x + 1, y + th - 12), lab, font=f, fill=(255, 235, 120))
        cy = y + th + 2
        dr.rectangle([LM, cy, xm(dur), cy + 12], fill=(22, 22, 26))
        for c in inf['cuts']:
            dr.line([xm(c), cy, xm(c), cy + 12], fill=(255, 80, 80), width=1)
        ly = cy + 16
        loud_lane(dr, LM, ly, xm(dur) - LM, 46, inf['ld']['log'], dur, xm, f)
        yy = ly + 50
        if any(i['tl'] for i in infos):
            if inf['tl']:
                text_lane(dr, LM, yy, xm(dur) - LM, 50, inf['tl'], xm, f)
            yy += 54
        if closer and bpm:
            xc = xm(closer * 60.0 / bpm)
            for yd in range(int(y), int(yy), 8):
                dr.line([xc, yd, xc, yd + 4], fill=(240, 60, 60))
        # lane label
        nc = len(inf['cuts'])
        L = inf['ld']
        wps = [r['wps'] for r in inf['tl']]
        lines = [inf['label'], f'{dur:.1f}s  {inf["wh"][0]}x{inf["wh"][1]}', f'{nc} cuts',
                 (f'{L["I"]:.1f} LUFS  LRA {L["LRA"]:.1f}' if L['I'] is not None and L['LRA'] is not None else 'no audio')]
        if L['TP'] is not None:
            lines.append(f'TP {L["TP"]:.1f}')
        if wps:
            lines.append(f'text {len(wps)} frames')
        dr.text((6, y), lines[0][:22], font=fb, fill=FG)
        for j, ln in enumerate(lines[1:]):
            dr.text((6, y + 18 + j * 13), ln, font=f, fill=DIM)
        summary.append({'label': inf['label'], 'path': inf['path'], 'dur_s': round(dur, 2), 'cuts': len(inf['cuts']),
                        'cut_times_s': [round(c, 2) for c in inf['cuts']],
                        'lufs': L['I'], 'lra': L['LRA'], 'true_peak': L['TP'],
                        'text_frames': len(wps)})
        y += lane_h
    img.save(out, quality=88)
    return summary


def selftest():
    tmp = tempfile.mkdtemp(prefix='piece_board_')
    vids = []
    for name, dur, hz in (('a', 6, 220), ('b', 8, 330)):
        p = os.path.join(tmp, name + '.mp4')
        r = run([FFMPEG, '-y', '-v', 'error', '-f', 'lavfi', '-i', f'testsrc2=s=144x256:r=30:d={dur}', '-f', 'lavfi',
                 '-i', f'sine=frequency={hz}:duration={dur}', '-vf',
                 "hue=h='t*90*(1+2*floor(t))'", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p])
        assert r.returncode == 0, r.stderr
        vids.append(p)
    tl = os.path.join(tmp, 'tl.txt')
    open(tl, 'w').write('beat t(s) hold(s) words w/s frame\n  0.0   0.0   0.80    2    2.5  ONE TWO\n'
                        '  2.0   1.0   0.60    3    5.0  THREE FOUR FIVE  <-- over\n  4.0   2.0   1.0    0    0.0  (no text)\n')
    out = os.path.join(tmp, 'board.jpg')
    s = build(vids, ['A', 'B'], [tl, None], bpm=120, closer=8, out=out)
    assert os.path.getsize(out) > 5000 and len(s) == 2
    assert s[0]['text_frames'] == 2 and s[1]['text_frames'] == 0
    assert s[0]['lufs'] is not None
    assert read_timeline(tl)[1]['text'] == 'THREE FOUR FIVE'
    assert '+ ' in diff_text(tl, tl) or 'kept' in diff_text(tl, tl)
    build(vids[:1], ['A'], [], norm=True, out=out)
    print('selftest ok:', json.dumps({k: s[0][k] for k in ('cuts', 'lufs')}), 'cuts_b', s[1]['cuts'])
    for p in vids + [tl, out]:
        os.remove(p)
    os.rmdir(tmp)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('videos', nargs='*')
    ap.add_argument('--label', action='append', default=[])
    ap.add_argument('--timeline', action='append', default=[])
    ap.add_argument('--bpm', type=float)
    ap.add_argument('--closer', type=float)
    ap.add_argument('--norm', action='store_true')
    ap.add_argument('--width', type=int, default=1800)
    ap.add_argument('--wps-warn', type=float, help='(unused; kept for old command lines)')
    ap.add_argument('--out', default='board.jpg')
    ap.add_argument('--json')
    ap.add_argument('--diff-text', nargs=2, metavar=('A', 'B'))
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.diff_text:
        print(diff_text(*a.diff_text))
        return
    if not a.videos:
        ap.error('give at least one video')
    labels = [a.label[i] if i < len(a.label) else os.path.splitext(os.path.basename(v))[0]
              for i, v in enumerate(a.videos)]
    s = build(a.videos, labels, a.timeline, a.bpm, a.closer, a.norm, a.width, a.wps_warn, a.out)
    if a.json:
        json.dump(s, open(a.json, 'w'), indent=1)
    for r in s:
        print(f'{r["label"]}: {r["dur_s"]}s, {r["cuts"]} cuts, {r["lufs"]} LUFS, LRA {r["lra"]}, text {r["text_frames"]} frames')
    print('board:', a.out)


if __name__ == '__main__':
    main()
