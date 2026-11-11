"""subject_loop_audio.py: a loop-true AAC for THE SUBJECT (v3, 1 Oct). The judges measured the delivered AAC's seam at -39 dBFS and its
length at 35.008 s: an AAC stream starts with codec ringing and ends on padding, so a player looping the file steps at the seam.

    python3 tools/subject_loop_audio.py out/.subject.wav OUT.m4a [--pre 0.2]          # run from videos/

The encoder is fed the loop with its own tail before it and its own head after it (pre-roll and post-roll from the loop itself), so
the codec's start and end are mid-music (pre-roll + loop is a whole number of AAC frames); the mp4 then carries an edit list (ffmpeg -ss/-t on a stream copy) that presents exactly
the loop: 35.000 s, from sample 0 of the loop to its last sample. Decoders that honour edit lists (ffmpeg, browsers, the platforms'
transcoders) then see the loop's own continuity at the seam. The script decodes the result and prints the length and the seam step.
"""
import argparse, json, os, subprocess, sys, tempfile
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from engine import codec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wav'); ap.add_argument('out'); ap.add_argument('--pre', type=float, default=0.2)
    a = ap.parse_args()
    sr, x = codec.read_audio(a.wav)
    x = codec.to48(x, sr); sr = 48000
    n = len(x)
    # the pre-roll is chosen so that pre-roll + loop is a whole number of AAC frames (1024 samples): the -ss/-t copy then ends on a
    # packet boundary and decodes to exactly the loop (ffmpeg honours the edit list's start skip but not an end trim inside a packet)
    P = int(round(a.pre * sr / 1024.0)) * 1024 + ((-n) % 1024)
    pad = np.concatenate([x[-P:], x, x[:P]], 0).astype(np.float32)
    ff = codec.ffmpeg_exe()
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.join(td, 'pad.m4a')
        info = codec.encode_true(pad, sr, tmp)
        subprocess.run([ff, '-y', '-v', 'error', '-ss', '%.6f' % (P / sr), '-i', tmp, '-t', '%.6f' % (n / sr), '-c:a', 'copy', '-movflags', '+faststart', a.out], check=True)
    y = subprocess.run([ff, '-v', 'error', '-i', a.out, '-f', 'f32le', '-ac', '2', '-'], capture_output=True).stdout
    y = np.frombuffer(y, np.float32).reshape(-1, 2)
    step = float(np.abs(y[-1] - y[0]).max())
    ref = float(np.abs(x[-1] - x[0]).max())
    out = dict(out=a.out, samples=len(y), seconds=round(len(y) / sr, 5), loop_samples=n, seam_step_dbfs=round(20 * np.log10(step + 1e-12), 1),
               source_seam_step_dbfs=round(20 * np.log10(ref + 1e-12), 1), decoded_tp=info if not isinstance(info, dict) else {k: info[k] for k in info if 'tp' in k})
    print(json.dumps(out))


if __name__ == '__main__':
    main()
