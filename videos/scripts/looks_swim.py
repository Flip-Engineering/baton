"""LOOKS c2b: screen / dither swim on a moving camera, motion-compensated.

Swim is a screen crawling over geometry: the dots stay in screen space while the thing they print moves. Plain frame
differencing cannot see it (correctly pinned dots that ride with a moving object also change every pixel), so:
  1. dense optical flow (Farneback) between consecutive frames, computed on BLURRED frames so the screen itself does not
     drive the flow (the flow follows the geometry);
  2. warp the previous frame's high-pass detail (the dots, lines, grain: f - blur(f)) along that flow;
  3. swim = mean |hp(next) - warp(hp(prev))| over the MOVING pixels (flow > 0.3 px at 540 wide), for pairs where at least
     5% of the frame moves (on twos half the pairs are identical and are skipped).
Pinned dots ride with the geometry, so their residual is small; screen-space dots leave a residual wherever the
geometry moved. Compare a clip against the same span rendered with screen-space screens (lab_adopt &pin=0).

    python3 scripts/looks_swim.py PINNED.mp4 --t0 S [UNPINNED.mp4 --u0 S] [--from S --to S]
"""
import argparse, json, subprocess
import numpy as np
import cv2


def load(path, t0, a, b, w=540, h=960):
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    raw = subprocess.run([ff, '-loglevel', 'error', '-ss', str(max(0, a - t0)), '-t', str(b - a), '-i', path,
                          '-vf', f'scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32) / 255


def swim(fr):
    hp = [f - cv2.GaussianBlur(f, (0, 0), 3) for f in fr]
    bl = [(cv2.GaussianBlur(f, (0, 0), 4) * 255).astype(np.uint8) for f in fr]
    H, W = fr[0].shape; gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    res, raw, mags = [], [], []
    for i in range(1, len(fr)):
        # backward flow: for each pixel of the next frame, where it was in the previous one
        fl = cv2.calcOpticalFlowFarneback(bl[i], bl[i - 1], None, 0.5, 4, 25, 3, 7, 1.5, 0)
        mag = np.hypot(fl[..., 0], fl[..., 1]); mv = mag > 0.3; mv[:8] = mv[-8:] = False; mv[:, :8] = mv[:, -8:] = False
        if mv.mean() < 0.05: continue                                   # fewer than 5% of pixels moving: a held or twos frame
        wp = cv2.remap(hp[i - 1], gx + fl[..., 0], gy + fl[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        res.append(float(np.abs(hp[i] - wp)[mv].mean())); raw.append(float(np.abs(hp[i] - hp[i - 1])[mv].mean())); mags.append(float(np.median(mag[mv])))
    if not res: return {'moving_pairs': 0}
    return {'moving_pairs': len(res), 'flow_med_px': round(float(np.median(mags)), 2),
            'swim_x1000': round(float(np.median(res)) * 1000, 2),          # compensated residual of the fine detail
            'uncomp_x1000': round(float(np.median(raw)) * 1000, 2),        # the same without compensation (for scale)
            'swim_ratio': round(float(np.median(res)) / max(float(np.median(raw)), 1e-6), 3)}   # < 1: detail rides with the geometry


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('pinned'); ap.add_argument('unpinned', nargs='?')
    ap.add_argument('--t0', type=float, required=True); ap.add_argument('--u0', type=float, default=None)
    ap.add_argument('--from', dest='a', type=float); ap.add_argument('--to', dest='b', type=float)
    o = ap.parse_args()
    a = o.a if o.a is not None else (o.u0 if o.u0 is not None else o.t0); b = o.b if o.b is not None else a + 1.5
    r = {'span': [a, b], 'pinned': swim(load(o.pinned, o.t0, a, b))}
    if o.unpinned:
        r['unpinned'] = swim(load(o.unpinned, o.u0, a, b))
        if r['pinned'].get('swim_x1000') and r['unpinned'].get('swim_x1000'):
            r['unpinned_over_pinned'] = round(r['unpinned']['swim_x1000'] / r['pinned']['swim_x1000'], 2)
    print(json.dumps(r))
