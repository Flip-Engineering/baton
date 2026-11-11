"""Render a READY bed to a wav for the VOICE c4 demo (make_audio only knows the names in songs.py; this adds them in memory).
    python3 tools/voice_c4_bed.py VARIANT OUTDIR     VARIANT: pub (the published songs2/ready.py), c9 (c9 as built, the c3 demo's bed), c10 (c4: rebuilt riff, no synthesized choir, NA-tion left to real voices), c10choir (c10 with c9's synthesized choir back in the held bar), c10t (c10 with the troupe's HEY-HAH kept at NA-tion)
    -> OUTDIR/.<name>.wav (.prelogo.wav, .hits.json)"""
import importlib
import os
import runpy
import sys

V = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(V, "web", "audio")
sys.path[:0] = [V, A]
import songs  # noqa: E402

variant, out = sys.argv[1], sys.argv[2]
if variant == "pub":
    name = "ready"
else:
    name = "ready_c9"          # logo_at / logo_gain / closers are keyed by song name: c9 and c10 share c9's entries (same lock beat b56)

    def _b():
        importlib.import_module("songs2.music_c3").activate("ready")
        if variant == "c9":
            return importlib.import_module("songs2.ready_c9").song()
        if variant == "c10t":          # c10's riff and held bar WITHOUT the real-voice NA-tion answer: the troupe's HEY-HAH stays (the main review build)
            return importlib.import_module("songs2.ready_c10").song(real_answers=False)
        if variant == "c10choir":      # c10's riff and answers, with c9's synthesized choir in the held bar (the BEFORE of the held-layer A/B)
            return importlib.import_module("songs2.ready_c10").song(synth_choir=True)
        return importlib.import_module("songs2.ready_c10").song()
    setattr(songs, name, _b)
sys.argv = [os.path.join(A, "make_audio.py"), name, "--out", out, "--no-codec", "--quiet"]
runpy.run_path(sys.argv[0], run_name="__main__")
