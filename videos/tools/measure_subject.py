"""THE SUBJECT's loop: the checks that catch breakage and content facts. How the music sounds is judged by listening.

    python3 videos/tools/measure_subject.py [--wav out/.subject.wav] [--out videos/review/studio_music_subject/measure.json] [--whisper]

Reads the mastered loop (out/.subject.wav, 44.1 kHz) and out/subject/music/build_info.json (written by songs2/subject.py at
render time: the grains, the voice count) and reports:
  the seam                  the step from the last sample to the first (dBFS), and the largest step in the first / last 10 ms:
                            a loop that clicks where it closes is broken
  whisper                   faster-whisper tiny.en on the mix: any intelligible word (the piece is wordless)
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)
BPM = 96
SPB = 60.0 / BPM


def load(path):
    import soundfile as sf
    x, sr = sf.read(path, dtype="float64")
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    return x, sr


def lufs_win(x, sr, t0, t1):
    import pyloudnorm as pyln
    seg = x[int(t0 * sr):int(t1 * sr)]
    if len(seg) < int(0.4 * sr):
        seg = np.pad(seg, ((0, int(0.4 * sr) - len(seg)), (0, 0)))
    v = pyln.Meter(sr).integrated_loudness(seg)
    return float(v) if np.isfinite(v) else -99.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", default=os.path.join(VIDEOS, "out", ".subject.wav"))
    ap.add_argument("--info", default=os.path.join(VIDEOS, "out", "subject", "music", "build_info.json"))
    ap.add_argument("--out", default=os.path.join(VIDEOS, "review", "studio_music_subject", "measure.json"))
    ap.add_argument("--whisper", action="store_true")
    a = ap.parse_args()
    x, sr = load(a.wav)
    m = x.mean(1)
    R = {}
    R["file"] = {"wav": a.wav, "seconds": round(len(x) / sr, 4), "sr": sr, "peak": round(float(np.abs(x).max()), 3)}

    # ---- the seam
    d = float(np.abs(x[0] - x[-1]).max())
    rng = lambda seg: float(np.abs(np.diff(seg, axis=0)).max())
    R["seam"] = {"step_last_to_first_dbfs": round(20 * np.log10(d + 1e-12), 1), "first_sample": [float(v) for v in x[0]], "last_sample": [float(v) for v in x[-1]],
                 "max_step_first_10ms_dbfs": round(20 * np.log10(rng(x[:int(0.01 * sr)]) + 1e-12), 1),
                 "max_step_last_10ms_dbfs": round(20 * np.log10(rng(x[-int(0.01 * sr):]) + 1e-12), 1),
                 "note": "the loop closes from x[-1] to x[0]: the step between them is d; frame 1050 of the picture is frame 0"}
    # ---- the build's own numbers
    if os.path.exists(a.info):
        R["build"] = json.load(open(a.info))
    if a.whisper:
        try:
            from faster_whisper import WhisperModel
            import tempfile
            import soundfile as sf
            mdl = WhisperModel("tiny.en", device="cpu", compute_type="int8")
            tmp = os.path.join(tempfile.gettempdir(), "subject_whisper.wav")
            sf.write(tmp, m, sr)
            segs, _ = mdl.transcribe(tmp, language="en", vad_filter=False, condition_on_previous_text=False, no_speech_threshold=0.2)
            R["whisper_tiny_en_on_mix"] = [{"t": [round(s.start, 2), round(s.end, 2)], "text": s.text.strip(), "no_speech_prob": round(s.no_speech_prob, 2)} for s in segs]
            os.remove(tmp)
        except Exception as e:                       # noqa: BLE001
            R["whisper_tiny_en_on_mix"] = f"not run: {type(e).__name__}: {e}"
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(R, open(a.out, "w"), indent=1)
    keep = {k: v for k, v in R.items() if k != "build"}
    print(json.dumps(keep, indent=1))


if __name__ == "__main__":
    main()
