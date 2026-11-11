"""LOOKS studio: where the picture's biggest change and the song's onset sit around each hit.

    python3 scripts/looks_impact.py CLIP.mp4 --t0 SONG_START --hits 10.2857[,7.94] [--fps 30] [--hits-json out/.song.hits.json]

For every hit (song seconds): the hit frame = round(hit*fps) - round(t0*fps); the picture's impact frame = the frame
with the largest mean luma change from its predecessor within +-6 frames (270x480); the audio onset = the frame whose
20 ms energy rises most within +-6 frames. audio_ok when the transient onset (first-difference energy, 1/120 s bins) is within
+-1 frame (the song's own hit is really there: sync). The frame numbers are information; whether the impact lands is judged by
watching the clip. The flash marker (lab_looks.js ?marker, a square in the top-right on the hit frame) is found too, to check
the render's timing.
"""
import argparse
import json
import subprocess

import numpy as np


def ff():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('clip'); ap.add_argument('--t0', type=float, required=True); ap.add_argument('--hits', required=True)
    ap.add_argument('--fps', type=float, default=30)
    a = ap.parse_args()
    w, h = 270, 480
    r = subprocess.run([ff(), '-v', 'error', '-i', a.clip, '-vf', f'scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
    fr = np.frombuffer(r.stdout, np.uint8).reshape(-1, h, w, 3).astype(np.float32) / 255
    lum = fr[..., 0] * .2126 + fr[..., 1] * .7152 + fr[..., 2] * .0722
    body = lum[:, 40:, :]                                             # below the marker band
    ch = np.r_[0, np.abs(np.diff(body, axis=0)).mean(axis=(1, 2))]
    mk_ = fr[:, 6:16, w - 16:w - 6]; marker = ((mk_[..., 0] + mk_[..., 2]) / 2 - mk_[..., 1]).mean(axis=(1, 2))   # magenta
    au = subprocess.run([ff(), '-v', 'error', '-i', a.clip, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], capture_output=True).stdout
    x = np.frombuffer(au, np.float32)
    xd = np.diff(x, prepend=0.0)                                         # first difference: the transient / high band
    sub = 4; spf = int(48000 / a.fps / sub)                              # 1/120 s energy bins
    en = np.array([np.sqrt(np.mean(xd[i * spf:(i + 1) * spf] ** 2) + 1e-12) for i in range(len(xd) // spf)])
    rise = np.r_[0, np.diff(20 * np.log10(en + 1e-9))]
    out = []
    for hs in [float(v) for v in a.hits.split(',')]:
        hf = int(round(hs * a.fps) - round(a.t0 * a.fps))
        lo, hi = max(1, hf - 6), min(len(ch) - 1, hf + 6)
        imp = lo + int(np.argmax(ch[lo:hi + 1]))
        b0, b1 = max(1, (hf - 3) * sub), min(len(rise) - 1, (hf + 3) * sub)
        ons = round((b0 + int(np.argmax(rise[b0:b1 + 1]))) / sub, 2) if b1 > b0 else None
        mk = [int(i) for i in np.where(marker > 0.6)[0]]
        out.append({'hit_s': hs, 'hit_frame': hf, 'impact_frame': imp, 'impact_change': round(float(ch[imp]), 3),
                    'next_biggest_change': round(float(np.sort(ch[lo:hi + 1])[-2]), 3), 'audio_onset_frame': ons,
                    'audio_ok': ons is not None and abs(ons - hf) <= 1, 'marker_frames': mk})
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
