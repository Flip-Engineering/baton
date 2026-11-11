"""TYPE c2: onsets of a song and the sync of a rendered clip's event against its own audio.

  python3 scripts/type_sync.py onsets <wav> [--top 25] [--from s] [--to s]
      spectral-flux onsets (8.3 ms hop, the c2 brief's method), normalised to the song's strongest; prints t, flux, rms
  python3 scripts/type_sync.py clip <mp4> [--event f] [--json out.json]
      per-frame mean abs change at 135x240 (0..1) and the clip's own audio onsets; names the frame of the largest change,
      the nearest onset and the lag between them in frames (is the picture event on the sound?). --event f checks frame f
      instead of the largest. Whether the event lands is for whoever watches the clip.
"""
import json
import subprocess
import sys

import numpy as np


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


def load_audio(path, sr=48000, t0=None, t1=None):
    a = [ffmpeg(), '-v', 'error']
    if t0 is not None:
        a += ['-ss', str(t0)]
    a += ['-i', path]
    if t1 is not None:
        a += ['-t', str(t1 - (t0 or 0))]
    a += ['-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(a, capture_output=True, check=True).stdout, np.float32), sr


def flux_curve(x, sr):
    hop, win = int(sr / 120), 1024
    fr = np.lib.stride_tricks.sliding_window_view(np.pad(x, (0, win)), win)[::hop] * np.hanning(win)
    M = np.log1p(10 * np.abs(np.fft.rfft(fr, axis=1)))
    fl = np.r_[0, np.maximum(0, np.diff(M, axis=0)).sum(1)]
    rms = 20 * np.log10(np.sqrt((fr ** 2).mean(1)) + 1e-9)
    return fl, rms, hop


def onsets(x, sr, norm=None, k=7):
    fl, rms, hop = flux_curve(x, sr)
    med = np.median(fl); mad = np.median(abs(fl - med)) + 1e-9
    pk = [i for i in range(k, len(fl) - k) if fl[i] == fl[i - k:i + k + 1].max() and fl[i] > med + 6 * mad]
    mx = norm if norm else (max(fl[pk]) if pk else 1)
    return [(round(i * hop / sr, 3), round(float(fl[i] / mx), 2), round(float(rms[min(i + 6, len(rms) - 1)]), 1)) for i in pk], float(mx), fl, hop


def frames(mp4, w=135, h=240):
    raw = subprocess.run([ffmpeg(), '-v', 'error', '-i', mp4, '-vf', f'scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32) / 255


def main():
    mode, path = sys.argv[1], sys.argv[2]
    opt = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    if mode == 'onsets':
        x, sr = load_audio(path)
        ons, mx, fl, hop = onsets(x, sr)
        t0, t1 = float(opt('--from', 0)), float(opt('--to', 1e9))
        sel = [o for o in ons if t0 <= o[0] <= t1]
        p = np.percentile([o[1] for o in ons], [90, 95, 99]) if ons else [0, 0, 0]
        print(f'{path}: {len(ons)} onsets, p90 {p[0]:.2f} p95 {p[1]:.2f} p99 {p[2]:.2f}')
        for t, f, r in sorted(sel, key=lambda o: -o[1])[:int(opt('--top', 25))]:
            print(f'  {t:7.3f}  flux {f:.2f}  rms {r:.1f} dB')
        return
    F = frames(path)
    if opt('--roi'):                                     # x0,y0,x1,y1 in 1080x1920 px: a local event (a punch, a stamp)
        x0, y0, x1, y1 = [int(v) for v in opt('--roi').split(',')]
        F = F[:, y0 * 240 // 1920:max(y0 * 240 // 1920 + 1, y1 * 240 // 1920), x0 * 135 // 1080:max(x0 * 135 // 1080 + 1, x1 * 135 // 1080)]
    d = np.r_[0, np.abs(np.diff(F, axis=0)).mean((1, 2))]    # mean abs luma change (0..1), the LOOKS c1 / WORLDS c2 scale
    x, sr = load_audio(path)
    ons, mx, fl, hop = onsets(x, sr)
    ev = int(opt('--event', int(np.argmax(d))))
    te = ev / 30
    # strongest onset near the event, in frames (an onset at t shows on frame ceil(t*30))
    # the onset this frame answers: the nearest one of flux >= 0.3 within 0.1 s (an onset at t shows on frame ceil(t*30)),
    # else the strongest within 0.2 s
    close = sorted([o for o in ons if o[1] >= 0.3 and abs(o[0] - te) <= 0.1], key=lambda o: abs(o[0] * 30 - (ev - 0.5)))
    near = close or sorted([o for o in ons if abs(o[0] - te) < 0.2], key=lambda o: -o[1])
    best = near[0] if near else None
    lag = None if not best else round(ev - best[0] * 30, 2)
    out = {'clip': path, 'frames': len(F), 'event_frame': ev, 'onset': best, 'lag_frames': lag,
           'curve': [round(float(v), 3) for v in d], 'onsets': [o for o in ons if o[1] >= 0.3]}
    print(f"{path}: event f{ev} ({te:.3f} s), nearest onset {best}, lag {lag} frames")
    top = np.argsort(-d)[:5]
    print('  largest changes at frames: ' + ', '.join(f'f{i}' for i in sorted(top)))
    if opt('--json'):
        json.dump(out, open(opt('--json'), 'w'))


if __name__ == '__main__':
    main()
