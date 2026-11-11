#!/usr/bin/env python3
"""BY AUTHORITY: bake the piece's plates and its card (research/series/authority/ep1_brief.md; the record is assets/byauthority/reel.json).

  python3 videos/web/scenes/byauthority.bake.py [plates] [card] [--frames DIR]
    plates  each 1919 plate: one frame of the Pathe .mov through tools/rangeproxy.py (cached in --frames, default a temp dir), cut to
            the picture, tools/archive_bake.py (the depth pack, assets/archive/<name>/), tools/devplate_bake.py (assets/devplate/<name>/)
    card    LAC e000008173 (the 1024 x 694 web copy until the TIFF arrives) -> assets/devplate/lac_e000008173/ with
            assets/byauthority/card_holes.json (the paper's rect, the four tack holes traced, the fold, the court form's box)
The 2026 plates (the person pipeline's Cycles stills) bake the same way once fetched from the farm:
  python3 videos/tools/devplate_bake.py bya26_<who> --src videos/out/gpu/<id>/<still>.png --stock orwocolor --plate 8x10 --orient portrait
"""
import json, os, subprocess, sys, tempfile, time, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE); VID = os.path.dirname(WEB)
REEL = os.path.join(WEB, 'assets', 'byauthority', 'reel.json')
HOLES = os.path.join(WEB, 'assets', 'byauthority', 'card_holes.json')
CARD_URL = 'https://data2.collectionscanada.gc.ca/e/e001/e000008173.jpg'


def ff():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def pull(spec, plate, frames):
    out = os.path.join(frames, plate['name'] + '.png')
    if os.path.exists(out):
        return out
    sys.path.insert(0, os.path.join(VID, 'tools'))
    from rangeproxy import RangeProxy
    with RangeProxy(spec['url']) as p:
        subprocess.run([ff(), '-hide_banner', '-loglevel', 'error', '-ss', '%.4f' % plate['t'], '-i', p.local_url, '-map', '0:v:0', '-frames:v', '1',
                        '-pix_fmt', 'rgb48be', '-y', out], check=True)
    return out


def inner(src, box, dst):
    import cv2
    a = cv2.imread(src, cv2.IMREAD_UNCHANGED); x0, y0, x1, y1 = box
    cv2.imwrite(dst, a[y0:y1, x0:x1])
    return dst


def plates(frames):
    R = json.load(open(REEL)); S = R['source']
    for P in R['plates']:
        f = pull(S, P, frames); fi = inner(f, S['inner_px'], os.path.join(frames, P['name'] + '_inner.png'))
        subprocess.run([sys.executable, os.path.join(VID, 'tools', 'archive_bake.py'), P['name'], '--src', fi, '--long', '1400',
                        '--credit', S['credit'], '--rights', S['rights'], '--source-url', S['item'],
                        '--note', 'BY AUTHORITY plate, t=%.3f s of %s; the depth is only used to move the camera inside the plate' % (P['t'], S['url'])], check=True)
        dp = os.path.join(WEB, 'assets', 'archive', P['name'], 'depth.png')
        x0, y0, x1, y1 = P['crop']
        subprocess.run([sys.executable, os.path.join(VID, 'tools', 'devplate_bake.py'), P['name'], '--src', fi, '--depth', dp,
                        '--crop', '%d,%d,%d,%d' % (x0, y0, x1, y1), '--stock', 'nitrate_bw', '--plate', '5x7', '--seed', str(P['seed']),
                        '--source-gamma', '1.1', '--credit', S['credit'], '--rights', S['rights'], '--source-url', S['item'],
                        '--note', '%s (t=%.3f s)' % (P['what'], P['t'])], check=True)


def card(frames):
    scan = os.path.join(frames, 'e000008173.jpg')
    if not os.path.exists(scan):
        subprocess.run(['curl', '-sSL', '-o', scan, '-A', 'acp-agitprop (https://github.com/flip-engineer/automated-content-pipeline)', CARD_URL], check=True)
    subprocess.run([sys.executable, os.path.join(VID, 'tools', 'devplate_bake.py'), 'lac_e000008173', '--card', scan, '--holes', HOLES, '--relief', '0.08'], check=True)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    frames = sys.argv[sys.argv.index('--frames') + 1] if '--frames' in sys.argv else tempfile.mkdtemp(prefix='bya_frames_')
    if '--frames' in sys.argv:
        args = [a for a in args if a != frames]
    os.makedirs(frames, exist_ok=True)
    todo = args or ['plates', 'card']
    if 'plates' in todo:
        plates(frames)
    if 'card' in todo:
        card(frames)
