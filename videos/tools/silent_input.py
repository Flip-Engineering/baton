#!/usr/bin/env python3
"""A picture-only render's stand-in input (benches have no soundtrack; the client, 8 Oct: 'bench doesnt need a soundtrack').

render.mjs must stay byte-identical to the version the farm's renderer adapter verified (a changed render.mjs makes the homelab
worker refuse every bench: 'Renderer changed: adapter needs review'), so it keeps reading out/.<scene>.wav + .hits.json. For a
picture-only render this writes a silent wav and a beat map of the given length as that input, the render runs with --reuse-audio,
and the caller drops the audio stream from what it delivers (ffmpeg -an): no song is ever built and the delivered mp4 has no audio.

  python3 videos/tools/silent_input.py SCENE SECONDS [--bpm 102]   write out/.SCENE.wav + out/.SCENE.hits.json (refuses to overwrite a real song's)
  python3 videos/tools/silent_input.py SCENE --clean                remove them again (only if this tool wrote them)
"""
import argparse, json, os, sys, wave
VIDEOS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(VIDEOS, 'out')
MARK = 'silent_input.py: picture-only stand-in, no soundtrack'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scene'); ap.add_argument('seconds', nargs='?', type=float)
    ap.add_argument('--bpm', type=float, default=102.0); ap.add_argument('--clean', action='store_true')
    ap.add_argument('--videos', help='the videos/ tree to write into (default: the one this tool sits in)')
    a = ap.parse_args()
    out = os.path.join(a.videos, 'out') if a.videos else OUT
    wav, hj = os.path.join(out, '.%s.wav' % a.scene), os.path.join(out, '.%s.hits.json' % a.scene)
    ours = os.path.exists(hj) and json.load(open(hj)).get('note') == MARK
    if a.clean:
        if ours:
            for f in (wav, hj, os.path.join(out, '.%s.render_hits.json' % a.scene)):
                try:
                    os.remove(f)
                except OSError:
                    pass
        return 0
    if a.seconds is None:
        ap.error('SECONDS required')
    if os.path.exists(hj) and not ours:
        sys.exit('silent_input: %s holds a real beat map; not overwriting it' % hj)
    os.makedirs(out, exist_ok=True)
    n = int((a.seconds + 1.0) * 48000)
    with wave.open(wav, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000)
        w.writeframes(b'\0' * (n * 4))
    json.dump({'bpm': a.bpm, 'duration': a.seconds, 'text': [], 'note': MARK}, open(hj, 'w'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
