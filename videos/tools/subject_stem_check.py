"""faster-whisper tiny.en over THE SUBJECT's mix, every track's stem and every bus: does any of it contain an intelligible word?
(No word is sung or spoken anywhere in the piece: wordless "ah" of recorded men and work sounds.  This is the check that says so by a
recogniser, and it is a proxy: the model hallucinates words on noise, so a hit is reported with its no-speech probability and read by a person.)

    python3 videos/tools/subject_stem_check.py            # builds the song (cached men), writes review/studio_music_subject/whisper_stems.json
"""
import json
import os
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
for p in (VIDEOS, os.path.join(VIDEOS, "web", "audio")):
    sys.path.insert(0, p)
os.environ.setdefault("ACP_SUBJECT_CACHE", "1")

import soundfile as sf  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402
from songs2 import subject as S  # noqa: E402

SR = 44100


def main():
    sg = S.song()
    x, k, h = sg.render()
    mix = sg.mix
    items = {"MIX (premaster, after the softclip)": x}
    for nm, st in mix.stems.items():
        items["stem: " + nm] = st
    for nm, b in mix.buses.items():
        items["bus: " + nm] = b
    mdl = WhisperModel("tiny.en", device="cpu", compute_type="int8")
    out = {}
    for nm, sig in items.items():
        m = np.asarray(sig, float).mean(1)
        pk = np.abs(m).max()
        if pk < 1e-6:
            out[nm] = "silent"
            continue
        m = m / pk * 0.5
        tmp = os.path.join(tempfile.gettempdir(), "subject_ws.wav")
        sf.write(tmp, m, SR)
        segs, _ = mdl.transcribe(tmp, language="en", vad_filter=False, condition_on_previous_text=False, no_speech_threshold=0.2)
        segs = [{"t": [round(s.start, 1), round(s.end, 1)], "text": s.text.strip(), "no_speech_prob": round(s.no_speech_prob, 2),
                 "avg_logprob": round(s.avg_logprob, 2)} for s in segs]
        out[nm] = segs
        os.remove(tmp)
        print(nm, "->", [s["text"] for s in segs] or "no words", flush=True)
    dst = os.path.join(VIDEOS, "review", "studio_music_subject", "whisper_stems.json")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    json.dump(out, open(dst, "w"), indent=1)


if __name__ == "__main__":
    main()
