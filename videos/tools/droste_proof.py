"""droste_proof.py: the studio's proofs (droste c2): window sheets and short clips from a chain key.

    python3 tools/droste_proof.py window KEY OUT_STEM --from-beat 55 --to-beat 59.5 --step 3 [--cards]
        renders every `step`-th frame between the beats and writes OUT_STEM_full.jpg (frames at 240 px, labelled) and OUT_STEM_270.jpg (152x270 each,
        one row), the lock windows of the studio notes
    python3 tools/droste_proof.py clip KEY OUT.mp4 --from-beat 28 --to-beat 33 [--cards]
        a short mp4 of the range (x264 crf 20, no audio)
    python3 tools/droste_proof.py frames KEY OUT_DIR 100,200,300 [--cards]
        full-size jpgs
Run from videos/. KEY is a chain key (subject_v3, subject_v3_A ...); a variant with `root` shares another chain's layout.
"""
import argparse, os, subprocess, sys
import numpy as np
import cv2
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.droste.render import Renderer, FPS


def render_frames(R, fs, cards):
    out = []
    if cards:
        from engine.droste import type_layer
    for f in fs:
        im = R.frame(f)
        if cards:
            im = type_layer.overlay(im, f, R.tl, R)
        out.append(im)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd'); ap.add_argument('key'); ap.add_argument('out'); ap.add_argument('frames', nargs='?')
    ap.add_argument('--from-beat', type=float); ap.add_argument('--to-beat', type=float); ap.add_argument('--step', type=int, default=3)
    ap.add_argument('--cards', action='store_true'); ap.add_argument('--w', type=int, default=240)
    a = ap.parse_args()
    R = Renderer(a.key)
    bf = R.bf
    if a.cmd == 'frames':
        os.makedirs(a.out, exist_ok=True)
        fs = [int(x) for x in a.frames.split(',')]
        for f, im in zip(fs, render_frames(R, fs, a.cards)):
            cv2.imwrite(os.path.join(a.out, 'f%04d.jpg' % f), im[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 92])
        return
    f0, f1 = int(round(a.from_beat * bf)), int(round(a.to_beat * bf))
    if a.cmd == 'window':
        fs = list(range(f0, f1, a.step))
        ims = render_frames(R, fs, a.cards)
        w = a.w; h = int(w * 16 / 9)
        cells = []
        for f, im in zip(fs, ims):
            c = cv2.resize(im, (w, h), interpolation=cv2.INTER_AREA)[:, :, ::-1].copy()
            cv2.rectangle(c, (0, 0), (w, 24), (0, 0, 0), -1)
            cv2.putText(c, 'f%d b%.2f' % (f, f / bf), (4, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            cells.append(c)
        cols = min(len(cells), 8)
        while len(cells) % cols:
            cells.append(np.zeros_like(cells[0]))
        cv2.imwrite(a.out + '_full.jpg', np.vstack([np.hstack(cells[i:i + cols]) for i in range(0, len(cells), cols)]), [cv2.IMWRITE_JPEG_QUALITY, 88])
        small = [cv2.resize(im, (152, 270), interpolation=cv2.INTER_AREA)[:, :, ::-1] for im in ims]
        cols = min(len(small), 16)
        while len(small) % cols:
            small.append(np.zeros_like(small[0]))
        cv2.imwrite(a.out + '_270.jpg', np.vstack([np.hstack(small[i:i + cols]) for i in range(0, len(small), cols)]), [cv2.IMWRITE_JPEG_QUALITY, 90])
    elif a.cmd == 'clip':
        from engine.droste.render import ffmpeg
        cmd = [ffmpeg(), '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '1080x1920', '-r', str(FPS), '-i', '-',
               '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', a.out]
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        for f in range(f0, f1):
            p.stdin.write(render_frames(R, [f], a.cards)[0].tobytes())
        p.stdin.close(); p.wait()


if __name__ == '__main__':
    main()
