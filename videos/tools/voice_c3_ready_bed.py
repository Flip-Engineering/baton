"""Render READY c9's bed (web/audio/songs2/ready_c9.py) to a wav for the VOICE c3 demo: make_audio only knows the
names in songs.py, so this adds ready_c9 to it in memory and runs make_audio's main unchanged.
    python3 tools/voice_c3_ready_bed.py OUTDIR   ->  OUTDIR/.ready_c9.wav, .ready_c9.hits.json"""
import importlib
import os
import runpy
import sys

V = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(V, "web", "audio")
sys.path[:0] = [V, A]
import songs  # noqa: E402


def _c9():
    importlib.import_module("songs2.music_c3").activate("ready")
    return importlib.import_module("songs2.ready_c9").song()


songs.ready_c9 = _c9
sys.argv = [os.path.join(A, "make_audio.py"), "ready_c9", "--out", sys.argv[1], "--no-codec", "--quiet"]
runpy.run_path(sys.argv[0], run_name="__main__")
