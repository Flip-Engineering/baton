#!/usr/bin/env python3
"""I-frame-drop datamosh for a rendered clip (the post path of lib/fx/footage.js).

    python3 scripts/fx_datamosh.py in.mp4 out.mp4 --cuts 0.29,2.0 [--bloom 2.3:12] [--q 3]

1. re-encode the clip as raw MPEG-4 Part 2 (.m4v) with no B-frames and no automatic keyframes,
   forcing an I-frame (keyframe) exactly at each --cuts time (seconds, relative to the clip);
2. walk the VOPs (start code 00 00 01 B6; the next 2 bits are the coding type: 0=I 1=P 2=B) and
   replace every I-VOP after the first with a copy of the P-VOP that follows it, so the new shot's
   motion vectors push the OLD shot's pixels around (the classic bleed) and the frame count holds;
3. --bloom T:N repeats the P-VOP at time T N extra times (the "bloom": pixels keep swelling along the
   same vectors), then drops N later P-VOPs to keep the length / audio sync;
4. decode back to H.264 1080x1920 and mux the original audio.
"""
import argparse, os, subprocess, sys, tempfile

import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
VOP = b"\x00\x00\x01\xb6"


def split_vops(data):
    first = data.find(VOP)
    head, body, out, i = data[:first], data[first:], [], 0
    while True:
        j = body.find(VOP, i + 4)
        if j < 0:
            out.append(body[i:]); break
        out.append(body[i:j]); i = j
    return head, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--cuts", default="", help="comma list of seconds where the old image should bleed into the new shot")
    ap.add_argument("--bloom", default="", help="T:N  repeat the P-frame at T seconds N times")
    ap.add_argument("--q", default="3", help="mpeg4 qscale (2 = cleaner, 8 = blockier mosh)")
    ap.add_argument("--fps", type=float, default=30)
    a = ap.parse_args()
    tmp = tempfile.mkdtemp(prefix="mosh_")
    m4v, moshed = os.path.join(tmp, "a.m4v"), os.path.join(tmp, "b.m4v")
    fk = ["-force_key_frames", a.cuts] if a.cuts else []
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", a.src, "-an", "-c:v", "mpeg4", "-q:v", a.q, "-bf", "0",
                    "-g", "100000", "-sc_threshold", "1000000000", *fk, "-f", "m4v", m4v], check=True)
    head, vops = split_vops(open(m4v, "rb").read())
    kinds = [(v[4] >> 6) for v in vops]
    out, dropped = [], 0
    for n, (v, k) in enumerate(zip(vops, kinds)):
        if k == 0 and n > 0:                                # I-VOP after the first: bleed
            nxt = next((vops[m] for m in range(n + 1, len(vops)) if kinds[m] == 1), None)
            out.append(nxt if nxt else out[-1]); dropped += 1
        else:
            out.append(v)
    if a.bloom:
        t, reps = a.bloom.split(":"); at, reps = int(float(t) * a.fps), int(reps)
        if 0 < at < len(out):
            p = out[at]
            out = out[:at] + [p] * reps + out[at:]
            del out[at + reps + 1: at + 2 * reps + 1]          # keep total length (and sync) by trimming after
    open(moshed, "wb").write(head + b"".join(out))
    subprocess.run([FF, "-y", "-loglevel", "error", "-r", str(a.fps), "-i", moshed, "-i", a.src, "-map", "0:v", "-map", "1:a?",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest",
                    "-movflags", "+faststart", a.dst], check=True)
    print(f"datamosh: {len(vops)} VOPs, {kinds.count(0)} I, {dropped} I dropped -> {a.dst}")


if __name__ == "__main__":
    sys.exit(main())
