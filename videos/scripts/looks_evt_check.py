"""LOOKS c2b: look at an event clip. A strip of frames around the hit and a trace of per-frame change (mean abs RGB
difference at 135x240) and blurred structural change (the same after a 9 px blur at 135 wide, so grain and dot boil do
not count), with the hit and the audio onset (if --wav) marked: whether the picture lands on the hit is judged on the
strip and the clip. The audio onset's offset from the hit frame is sync, printed in frames.

    python3 scripts/looks_evt_check.py CLIP.mp4 --t0 S --hit S [--out PREFIX] [--wav SONG.wav]
"""
import argparse, json, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def frames(path):
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    raw = subprocess.run([ff, '-loglevel', 'error', '-i', path, '-vf', 'scale=135:240', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                         capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.uint8).reshape(-1, 240, 135, 3).astype(np.float32) / 255
    return a


def full(path, idx):
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    out = []
    for i in idx:
        raw = subprocess.run([ff, '-loglevel', 'error', '-i', path, '-vf', f'select=eq(n\\,{i}),scale=225:400', '-vframes', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                             capture_output=True, check=True).stdout
        out.append(Image.frombytes('RGB', (225, 400), raw) if len(raw) == 225 * 400 * 3 else Image.new('RGB', (225, 400)))
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('clip'); ap.add_argument('--t0', type=float, required=True); ap.add_argument('--hit', type=float, required=True)
    ap.add_argument('--out', default=None); ap.add_argument('--wav', default=None); a = ap.parse_args()
    F = frames(a.clip); n = len(F)
    d = np.r_[0, np.abs(np.diff(F, axis=0)).mean((1, 2, 3))]
    B = np.stack([np.asarray(Image.fromarray((f * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4)), np.float32) / 255 for f in F])
    sd = np.r_[0, np.abs(np.diff(B, axis=0)).mean((1, 2, 3))]
    h = round((a.hit - a.t0) * 30)
    nb = [d[i] for i in range(h - 4, h + 5) if i != h and 0 < i < n]
    win = [i for i in range(max(1, h - 12), min(n, h + 13))]
    static = [i - h for i in win if sd[i] < 0.004]
    # per-window structural motion: the mean over each 12-frame window (a readout)
    w12 = [float(sd[i:i + 12].mean()) for i in range(1, max(2, n - 11))]
    res = {'clip': a.clip.split('/')[-1], 'frames': n, 'hit_frame': h, 'hit_d': round(float(d[h]), 3) if h < n else None,
           'nb_max': round(float(max(nb)), 3) if nb else None, 'ratio': round(float(d[h] / max(max(nb), 1e-4)), 2) if nb else None,
           'argmax_d': int(np.argmax(d)) - h, 'static_within_12': static, 'min_12win_struct': round(min(w12), 4)}
    if a.wav:
        import wave
        with wave.open(a.wav) as w:
            sr = w.getframerate(); ch = w.getnchannels(); sw = w.getsampwidth(); w.setpos(int(a.t0 * sr)); x = np.frombuffer(w.readframes(int(n / 30 * sr)), {2: np.int16, 4: np.int32}[sw]).astype(np.float32)
        x = x.reshape(-1, ch).mean(1); x /= max(np.abs(x).max(), 1)
        spf = sr // 30; env = np.array([np.sqrt((x[i * spf:(i + 1) * spf] ** 2).mean() + 1e-12) for i in range(n)])
        db = 20 * np.log10(env + 1e-9); jump = np.r_[0, np.diff(db)]
        lo = max(1, h - 6); on = lo + int(np.argmax(jump[lo:h + 7])); res['audio_onset_frame'] = on - h
    else: env = None
    print(json.dumps(res))
    if a.out:
        idx = [i for i in range(h - 12, h + 13, 2) if 0 <= i < n] if n > 30 else list(range(n))
        idx = sorted(set(idx + [h - 1, h, h + 1, h + 2]) & set(range(n)))
        ims = full(a.clip, idx); cols = 9; rows = (len(ims) + cols - 1) // cols
        S = Image.new('RGB', (cols * 225, rows * 416 + 170), (14, 14, 14)); g = ImageDraw.Draw(S)
        for k, (i, im) in enumerate(zip(idx, ims)):
            x, y = (k % cols) * 225, (k // cols) * 416; S.paste(im, (x, y + 16))
            g.text((x + 3, y + 2), f'k={i - h:+d} d={d[i]:.3f} s={sd[i]:.3f}', fill=(255, 80, 255) if i == h else (230, 220, 90))
        y0 = rows * 416 + 10; W = S.width - 20; mx = max(d.max(), 0.01)
        for i in range(1, n):
            x0 = 10 + (i - 1) * W / n; x1 = 10 + i * W / n
            g.line([(x0, y0 + 140 - d[i - 1] / mx * 130), (x1, y0 + 140 - d[i] / mx * 130)], fill=(230, 220, 90), width=2)
            g.line([(x0, y0 + 140 - sd[i - 1] / mx * 130), (x1, y0 + 140 - sd[i] / mx * 130)], fill=(90, 200, 230), width=2)
            if env is not None: g.line([(x0, y0 + 150), (x0, y0 + 150 - env[i] * 40)], fill=(120, 120, 120))
        xh = 10 + h * W / n; g.line([(xh, y0), (xh, y0 + 150)], fill=(255, 60, 255), width=2)
        if 'audio_onset_frame' in res: xa = 10 + (h + res['audio_onset_frame']) * W / n; g.line([(xa, y0 + 100), (xa, y0 + 150)], fill=(60, 255, 60), width=3)
        g.text((12, y0), 'yellow: frame change   blue: structural (blurred)   grey: audio   magenta: hit   green: measured onset', fill=(200, 200, 200))
        S.save(a.out + '_strip.jpg', quality=88)
        with open(a.out + '_check.json', 'w') as f: json.dump({**res, 'd': [round(float(v), 4) for v in d], 'sd': [round(float(v), 4) for v in sd]}, f)


if __name__ == '__main__':
    main()
