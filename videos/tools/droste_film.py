"""droste_film.py: grade an archival clip to its still and store it as the come-alive of a droste chain (engine/droste/film.py).

    python3 tools/droste_film.py --key subject_v3 --id ring --src sources/footage/droste/westinghouse_ring_60_150.mp4 --ss 44 --t 2.4 \\
        --still LB --cx 0.5 --out-w 810 [--gray] [--zoom 1.0] [--strength 0.45]

* the clip is decoded at 15 fps (shot on twos on the 30 fps timeline, like the grain), cropped to 9:16 around `--cx` (0..1 across the source, `--zoom`
  crops tighter) and resized with Lanczos to `--out-w` x (out-w * 16/9);
* grading to the still: the tint goes (a monochrome still gets a luminance-only film, a colour still keeps the film's colour with its cast removed
  by a grey-world gain), the film's tone is moved `--strength` of the way to the still's tone curve (a histogram match, partial: a forge lit by its own
  fire must not be flattened into an overcast sky), its blacks are lifted to the still's, and a mild unsharp hides the upsampling;
* writes videos/out/<key>/films/<id>/%04d.jpg (q92) and meta.json {frames, fps, src, ss, t, still}.
"""
import argparse, json, os, subprocess, sys, tempfile, shutil
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
if not os.path.exists(FF):          # 16 Oct: on the farm (a GPU job's venv) the static binary lives elsewhere
    import imageio_ffmpeg
    FF = imageio_ffmpeg.get_ffmpeg_exe()


def hist_lut(src_y, dst_y):
    """LUT mapping the CDF of src_y onto that of dst_y (uint8 arrays)."""
    hs = np.bincount(src_y.ravel(), minlength=256).astype(np.float64); hd = np.bincount(dst_y.ravel(), minlength=256).astype(np.float64)
    cs = np.cumsum(hs) / hs.sum(); cd = np.cumsum(hd) / hd.sum()
    return np.interp(cs, cd, np.arange(256))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--key', required=True); ap.add_argument('--id', required=True); ap.add_argument('--src', required=True)
    ap.add_argument('--ss', type=float, default=0); ap.add_argument('--t', type=float, default=3)
    ap.add_argument('--still', required=True, help='targets name (T1, HV, LB ...)')
    ap.add_argument('--cx', type=float, default=0.5); ap.add_argument('--cy', type=float, default=0.5); ap.add_argument('--zoom', type=float, default=1.0)
    ap.add_argument('--out-w', type=int, default=810); ap.add_argument('--aspect', default='9:16'); ap.add_argument('--fps', type=float, default=15)
    ap.add_argument('--deint', action='store_true'); ap.add_argument('--gray', action='store_true'); ap.add_argument('--colour', action='store_true'); ap.add_argument('--strength', type=float, default=0.45)
    ap.add_argument('--tint', type=float, default=0.6, help='colour stills: how far the film takes the still\'s colour-by-luminance (0 = the film stays grey)')
    ap.add_argument('--sharp', type=float, default=0.6); ap.add_argument('--crop-in', default='', help='source crop x0,y0,x1,y1 in px (burned-in timecode etc.)')
    a = ap.parse_args()
    from engine.droste import targets as T
    still = T.load(a.still)
    sg = cv2.cvtColor(still, cv2.COLOR_RGB2GRAY)
    h0, w0 = sg.shape
    sg = sg[int(h0 * .05):int(h0 * .95), int(w0 * .05):int(w0 * .95)]
    chroma = float(np.abs(still[..., 0].astype(np.float32) - still[..., 2]).mean())
    colour_still = (chroma > 12 or a.colour) and not a.gray
    src = a.src if os.path.isabs(a.src) else os.path.join(VIDEOS, a.src)
    out = os.path.join(VIDEOS, 'out', a.key, 'films', a.id)
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    tmp = tempfile.mkdtemp(dir=os.path.join(VIDEOS, 'out'))
    subprocess.run([FF, '-nostdin', '-loglevel', 'error', '-ss', str(a.ss), '-t', str(a.t), '-i', src, '-vf', ('yadif=0:-1:0,' if a.deint else '') + 'fps=%g' % a.fps, '-q:v', '1', os.path.join(tmp, '%04d.png')], check=True)
    fr = sorted(os.listdir(tmp))
    AW, AH = [int(v) for v in a.aspect.split(':')]
    OW = a.out_w; OH = int(round(OW * AH / AW))
    lut = None
    for k, fn in enumerate(fr):
        im = cv2.imread(os.path.join(tmp, fn))
        if a.crop_in:
            x0, y0, x1, y1 = [int(v) for v in a.crop_in.split(',')]
            im = im[y0:y1, x0:x1]
        h, w = im.shape[:2]
        cw = min(w, h * AW / AH / a.zoom); ch = cw * AH / AW
        if ch > h:
            ch = h; cw = ch * AW / AH
        x0 = int(np.clip(a.cx * w - cw / 2, 0, w - cw)); y0 = int(np.clip(a.cy * h - ch / 2, 0, h - ch))
        c = im[y0:y0 + int(ch), x0:x0 + int(cw)]
        c = cv2.resize(c, (OW, OH), interpolation=cv2.INTER_LANCZOS4)
        y = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY)
        if lut is None:                       # one tone curve per clip (no flicker): from the first frame's neighbourhood, set again on the whole clip below
            lut = 'pending'
        if colour_still:
            c = cv2.cvtColor(y, cv2.COLOR_GRAY2BGR)           # the film's own colour (tint, cast) is discarded: grey, then the still's palette by luminance
        else:
            c = cv2.cvtColor(y, cv2.COLOR_GRAY2BGR)
        cv2.imwrite(os.path.join(tmp, 'g_' + fn[:-4] + '.png'), c)
    # one tone curve for the whole clip
    ys = np.concatenate([cv2.cvtColor(cv2.imread(os.path.join(tmp, 'g_' + fn[:-4] + '.png')), cv2.COLOR_BGR2GRAY)[::4, ::4].ravel() for fn in fr[::3]])
    L = hist_lut(ys, sg[::4, ::4].ravel())
    L = np.arange(256) * (1 - a.strength) + L * a.strength
    lutu = np.clip(L, 0, 255).astype(np.uint8)
    # the still's mean colour at each luminance (BGR curves), smoothed: the palette a grey film borrows
    sbgr = still[int(h0 * .05):int(h0 * .95), int(w0 * .05):int(w0 * .95)][::4, ::4, ::-1].reshape(-1, 3).astype(np.float32)
    sl = sg[::4, ::4].reshape(-1)
    TINT = []
    for ch in range(3):
        m = np.array([sbgr[(sl >= b0) & (sl < b0 + 16), ch].mean() if ((sl >= b0) & (sl < b0 + 16)).sum() > 50 else np.nan for b0 in range(0, 256, 16)])
        xs = np.arange(8, 256, 16); ok = ~np.isnan(m)
        TINT.append(np.clip(np.interp(np.arange(256), xs[ok], m[ok]), 0, 255))
    # keep the film's luminance exactly: scale each channel curve so its luma equals the index
    lum = 0.114 * TINT[0] + 0.587 * TINT[1] + 0.299 * TINT[2]
    TINT = [np.clip(t * (np.arange(256) + 1) / (lum + 1), 0, 255) for t in TINT]
    n = 0
    for k, fn in enumerate(fr):
        c = cv2.imread(os.path.join(tmp, 'g_' + fn[:-4] + '.png'))
        c = cv2.LUT(c, lutu)
        if colour_still and a.tint > 0:
            g = c[..., 0]
            col = np.stack([TINT[k][g] for k in range(3)], -1).astype(np.float32)      # BGR
            c = np.clip(c.astype(np.float32) * (1 - a.tint) + col * a.tint, 0, 255).astype(np.uint8)
        if a.sharp > 0:
            bl = cv2.GaussianBlur(c, (0, 0), 1.6); c = cv2.addWeighted(c, 1 + a.sharp, bl, -a.sharp, 0)
        cv2.imwrite(os.path.join(out, '%04d.jpg' % k), c, [cv2.IMWRITE_JPEG_QUALITY, 92]); n += 1
    shutil.rmtree(tmp)
    json.dump(dict(frames=n, fps=a.fps, src=os.path.relpath(src, VIDEOS), ss=a.ss, t=a.t, still=a.still, colour=bool(colour_still)), open(os.path.join(out, 'meta.json'), 'w'))
    print('wrote', n, 'frames to', out)


if __name__ == '__main__':
    main()
