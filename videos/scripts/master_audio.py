#!/usr/bin/env python3
"""Publish-time audio check and repair: a published file's audio at or under -1 dBTP as DECODED, with the master and the
share carrying the same tested stream.

  python3 videos/scripts/master_audio.py MASTER.mp4 [--share SHARE.mp4] [--scene S]
  python3 videos/scripts/master_audio.py IN.mp4 [OUT.mp4]          # the old form: one file (OUT defaults to IN)

What it does (AUDIO FINISH c1; the finishing itself lives in engine/finish.py and normally ran at render time):
  - a master already at or under -1.0 dBTP decoded is left alone. If a share is given and its audio is not the
    master's stream, the master's stream is copied into it (the share carries the tested stream; nothing re-encoded);
  - a master over -1.0 dBTP is repaired ONCE, before any encoder, never AAC to AAC twice:
      * from the PCM source when the render left a finish report (<master>.finish.json, or out/farm/<scene>.finish.json
        whose span matches): the whole finish is re-run from the song with the same span and sheet. The repair lowers
        peaks only: the level stays the one the builder chose in the sheet (there is no house level or anchor);
      * otherwise (a legacy file) the audio is decoded once, given the pre-encode ceiling only (no level, edge, sub or
        ending moves: the piece is as published), encoded once through finish.ENC and measured as decoded;
    and that one stream is muxed into the master AND the share (pictures copied).
Every move is printed; a failure exits non-zero and leaves the files as they were.

Why -1 dBTP: phones and platforms re-encode audio; peaks above about -1 dBTP before that become audible clipping after
it. It is a delivery spec, not taste. The overshoot of ffmpeg's AAC encoder is transient HF ringing (MELTDOWN's dense
master decoded at +3.5 dBTP from -1.3 in PCM), so the repair dips the band above 7 kHz first, locally, and says where.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)
from engine import codec, finish  # noqa: E402

TARGET = -1.0
ENCODE = finish.ENC                       # the one encoder setting (kept as a name for older imports)


def decoded_tp(path):
    sr, x = codec.read_audio(path)
    return finish.tp_db(x, sr), sr, x


def audio_md5(path):
    r = subprocess.run([codec.ffmpeg_exe(), "-loglevel", "error", "-i", path, "-map", "0:a:0", "-c", "copy", "-f", "md5", "-"],
                       capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def duration(path):
    r = subprocess.run([codec.ffmpeg_exe(), "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else None


def extract_m4a(src, dst):
    subprocess.run([codec.ffmpeg_exe(), "-y", "-loglevel", "error", "-i", src, "-vn", "-map", "0:a:0", "-c:a", "copy", dst], check=True)


def swap_audio(video, m4a, log):
    tmp = video + ".ma.mp4"
    codec.mux(video, m4a, tmp)
    os.replace(tmp, video)
    log(f"master_audio: {os.path.basename(video)}: the tested stream muxed in (picture copied)")


def find_report(master, scene):
    cands = [os.path.splitext(master)[0] + ".finish.json"]
    if scene:
        cands.append(os.path.join(VIDEOS, "out", "farm", f"{scene}.finish.json"))
    dur = duration(master)
    for c in cands:
        if os.path.exists(c):
            with open(c) as f:
                r = json.load(f)
            sp = r.get("span", {})
            if r.get("src") and os.path.exists(r["src"]) and dur and abs((sp.get("to", 0) - sp.get("from", 0)) - dur) < 0.15:
                return r
    return None


def master(src, share=None, scene=None, dst=None, log=lambda s: print(s, file=sys.stderr)):
    if dst and dst != src:
        shutil.copyfile(src, dst)
        src = dst
    tp, sr, x = decoded_tp(src)
    name = os.path.basename(src)
    tmpd = tempfile.mkdtemp(dir=os.path.dirname(os.path.abspath(src)))
    try:
        m4a = os.path.join(tmpd, "a.m4a")
        if tp <= TARGET:
            log(f"master_audio: {name}: decoded true peak {tp:+.2f} dBTP, left as is")
            if share and audio_md5(share) != audio_md5(src):
                d1, d2 = duration(src), duration(share)
                if d1 and d2 and abs(d1 - d2) < 0.1:
                    extract_m4a(src, m4a)
                    swap_audio(share, m4a, log)
                    log(f"master_audio: {os.path.basename(share)}: carried a different audio stream; now the master's")
                else:
                    stp, _, _ = decoded_tp(share)
                    log(f"master_audio: {os.path.basename(share)}: its own stream ({stp:+.2f} dBTP); lengths differ, left")
            return 0
        rep = find_report(src, scene)
        if rep:
            log(f"master_audio: {name}: decoded {tp:+.2f} dBTP; re-finishing from the PCM source {rep['src']}")
            sp = rep["span"]
            r2 = finish.finish(rep["src"], m4a, rep.get("scene"), rep.get("sheet"), sp.get("lock"), sp.get("from", 0.0),
                               sp.get("to"), (), None, os.path.join(tmpd, "r.json"), log=lambda s: log("  " + s))
        else:
            log(f"master_audio: {name}: decoded {tp:+.2f} dBTP and no PCM source: decode once, ceiling, encode once")
            sheet = finish.load_sheet(None)
            sheet["level"]["mode"] = "keep"
            sheet["start"]["fade_in_ms"] = 0
            sheet["end"]["guard_s"] = 0.0
            sheet["end"]["fade_s"] = 0.0
            sheet["sub"] = {"hp_hz": 0, "mono_below_hz": 0}
            sheet["stops"]["mode"] = "describe"
            y, _ = finish.process(x, sr, sheet, None, 0.0, len(x) / sr, (), None, log=lambda s: log("  " + s))
            r2 = {"encode": finish.encode_true(y, m4a, finish.TARGET_TP)}
        E = r2["encode"]
        log(f"master_audio: {name}: decoded {tp:+.2f} -> {E['decoded_tp']:+.2f} dBTP; HF dips max {E['hf_dip_max_db']} dB over "
            f"{E['hf_dip_s']} s, broadband max {E['broadband_dip_max_db']} dB over {E['broadband_dip_s']} s")
        swap_audio(src, m4a, log)
        if share:
            swap_audio(share, m4a, log)
        return 0
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dst", nargs="?")
    ap.add_argument("--share")
    ap.add_argument("--scene")
    a = ap.parse_args()
    sys.exit(master(a.src, a.share, a.scene, a.dst))
