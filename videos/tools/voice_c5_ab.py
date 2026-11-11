#!/usr/bin/env python3
"""voice_c5_ab.py (VOICE c5): published-versus-voiced phone copies of a real piece, for the client's ear.

For each piece with a voiced review build (a scene <build>_vox and a song songs.<build>_vox that places a voice drop with
engine/voice/found.drop), this writes to review/studio_voice_c5/after/:

    <PIECE>_A_published.mp4      the published share copy, as the archive holds it (re-encoded to a phone bitrate, audio copied)
    <PIECE>_B_voiced.mp4         the voiced build: the published picture with the voiced range spliced in (tools/splice.py) and the
                                 voiced song, codec-true (engine/codec)
    <PIECE>_C_voice_on_cards.mp4 the voice over the PUBLISHED cards (published picture + B's audio): why the type has to change
    <PIECE>_AB_window.mp4        the voiced passage only, A then B, back to back (the 20-second listen)
    <PIECE>_B_muted_strip.jpg    B's frames across the voiced passage, no sound: does the type still make the line silent?
    provenance.json              the drop's provenance, frame check and clearance and the cards over the passage (from
                                 hits.json): facts, not scores (8 Oct: the recogniser and band-share metrics are removed)

    python3 videos/tools/voice_c5_ab.py fetch RED_WEDGE_v11 DIR      # the published share copy from the archive (LFS batch API)
    python3 videos/tools/voice_c5_ab.py build rw  --published DIR/RED_WEDGE_v11_share.mp4 --picture B_picture.mp4
    python3 videos/tools/voice_c5_ab.py build giant --published ... --picture ...

The picture for B comes from `splice.py render <build>_vox <published> --from S --to S --reuse-audio -o B_picture.mp4`; the song
is built with ACP_STOCK_LOGO=1 so its closer is the published one (MUSIC c11 retired the stock mark after these were published):
`ACP_STOCK_LOGO=1 python3 videos/web/audio/make_audio.py <build>_vox`. The A/B files are for listening on a phone.
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path[:0] = [VIDEOS]
OUT = os.path.join(VIDEOS, 'review', 'studio_voice_c5', 'after')
ARCHIVE = 'https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive'

PIECES = {   # build, published name, END (lockup + 1.4 s), the voiced passage (s) for the window copy and the strip, strip times
    'rw': dict(build='red_wedge2_vox', name='RED_WEDGE', pub='RED_WEDGE_v11', end=36.6, win=(10.4, 19.6), hear=(11.8, 17.8),
               strip=[11.9, 12.4, 13.2, 14.4, 15.0, 16.2, 16.9, 17.4, 18.0]),
    'giant': dict(build='giant_c5_vox', name='THE_GIANT', pub='GIANT_v2', end=37.025, win=(0.0, 13.6), hear=(0.5, 11.4),
                  strip=[0.4, 1.2, 2.2, 3.4, 5.0, 6.6, 8.3, 9.5, 10.6, 12.0, 13.2]),
}


def ff():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit('voice_c5_ab: failed: %s\n%s' % (' '.join(cmd[:6]), r.stderr[-1500:]))
    return r


def fetch(pub, d):
    """The published share copy from the archive repo: the tree's LFS pointer, then the LFS batch API (git lfs pull stalls here)."""
    import urllib.request
    os.makedirs(d, exist_ok=True)
    path = f'videos/out/{pub}_share.mp4'
    ptr = urllib.request.urlopen(f'https://raw.githubusercontent.com/flip-engineer/automated-content-pipeline-video-studies-archive/main/{path}').read().decode()
    oid = ptr.split('oid sha256:')[1].split()[0]
    size = int(ptr.split('size ')[1].split()[0])
    req = urllib.request.Request(ARCHIVE + '.git/info/lfs/objects/batch', method='POST',
                                 data=json.dumps({'operation': 'download', 'transfers': ['basic'],
                                                  'objects': [{'oid': oid, 'size': size}]}).encode(),
                                 headers={'Accept': 'application/vnd.git-lfs+json', 'Content-Type': 'application/vnd.git-lfs+json'})
    href = json.load(urllib.request.urlopen(req))['objects'][0]['actions']['download']['href']
    out = os.path.join(d, f'{pub}_share.mp4')
    urllib.request.urlretrieve(href, out)
    print(out, os.path.getsize(out))
    return out


def phone(src, dst, vb='3200k'):
    """A phone copy: 1080x1920, H.264 at a phone bitrate, the (codec-true) audio stream copied."""
    run([ff(), '-v', 'error', '-y', '-i', src, '-c:v', 'libx264', '-preset', 'medium', '-b:v', vb, '-maxrate', '5000k', '-bufsize', '8000k',
         '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', dst])


def mux(picture, wav, end, dst):
    """Codec-true audio (engine/codec: one AAC encode, dips only where the decoded TP is over) under a copied picture."""
    run([sys.executable, '-m', 'engine.codec', wav, '--to', str(end), '--fade', '0.5', '--mux', picture, '-o', dst])


def window(a, b, win, dst):
    t0, t1 = win
    run([ff(), '-v', 'error', '-y', '-ss', str(t0), '-t', str(t1 - t0), '-i', a, '-ss', str(t0), '-t', str(t1 - t0), '-i', b,
         '-f', 'lavfi', '-t', '0.6', '-i', 'color=c=black:s=1080x1920:r=30', '-f', 'lavfi', '-t', '0.6', '-i', 'anullsrc=r=48000:cl=stereo',
         '-filter_complex', '[0:v]fps=30,format=yuv420p,setsar=1[a];[1:v]fps=30,format=yuv420p,setsar=1[b];[2:v]format=yuv420p,setsar=1[k];'
         '[0:a]aresample=48000[aa];[1:a]aresample=48000[ba];[3:a]aresample=48000[ka];'
         '[a][aa][k][ka][b][ba]concat=n=3:v=1:a=1[v][au]', '-map', '[v]', '-map', '[au]',
         '-c:v', 'libx264', '-preset', 'medium', '-b:v', '3200k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', dst])


def strip(src, times, dst, title):
    """B's frames over the passage, silent: a reader checks the type alone carries the line."""
    import tempfile
    from PIL import Image, ImageDraw
    tmp = tempfile.mkdtemp()
    ims = []
    for i, t in enumerate(times):
        p = os.path.join(tmp, f'{i:02d}.jpg')
        run([ff(), '-v', 'error', '-y', '-ss', str(t), '-i', src, '-frames:v', '1', '-vf', 'scale=270:480', p])
        ims.append((t, Image.open(p).convert('RGB')))
    W = 270 * len(ims)
    sheet = Image.new('RGB', (W, 480 + 70), (14, 10, 10))
    d = ImageDraw.Draw(sheet)
    d.text((10, 8), title, fill=(240, 228, 200))
    for i, (t, im) in enumerate(ims):
        sheet.paste(im, (270 * i, 40))
        d.text((270 * i + 8, 524), f'{t:.1f} s', fill=(240, 228, 200))
    sheet.save(dst, quality=88)
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)


def build(key, published, picture):
    P = PIECES[key]
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(VIDEOS, 'out', f".{P['build']}.wav")
    hits = json.load(open(os.path.join(VIDEOS, 'out', f".{P['build']}.hits.json")))
    A = os.path.join(OUT, f"{P['name']}_A_published.mp4")
    B = os.path.join(OUT, f"{P['name']}_B_voiced.mp4")
    C = os.path.join(OUT, f"{P['name']}_C_voice_on_cards.mp4")
    tmpB, tmpC = B + '.master.mp4', C + '.master.mp4'
    phone(published, A)
    mux(picture, wav, P['end'], tmpB); phone(tmpB, B); os.remove(tmpB)
    mux(published, wav, P['end'], tmpC); phone(tmpC, C); os.remove(tmpC)
    window(A, B, P['win'], os.path.join(OUT, f"{P['name']}_AB_window.mp4"))
    strip(B, P['strip'], os.path.join(OUT, f"{P['name']}_B_muted_strip.jpg"),
          f"{P['name']} B (voiced), muted: the type alone over the voiced passage")
    mp = os.path.join(OUT, 'provenance.json')
    M = json.load(open(mp)) if os.path.exists(mp) else {}
    M[key] = dict(build=P['build'], published=P['pub'], window_s=P['win'], listen_window_s=P['hear'],
                  voices=hits.get('voices'), cards=[c for c in hits.get('text', []) if P['win'][0] <= c['t'] <= P['win'][1]])
    json.dump(M, open(mp, 'w'), indent=1, ensure_ascii=False)
    for f in (A, B, C):
        print(f, round(os.path.getsize(f) / 1e6, 1), 'MB')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['fetch', 'build'])
    ap.add_argument('arg', nargs='*')
    ap.add_argument('--published'); ap.add_argument('--picture')
    a = ap.parse_args()
    if a.cmd == 'fetch':
        return fetch(a.arg[0], a.arg[1])
    return build(a.arg[0], a.published, a.picture)


if __name__ == '__main__':
    main()
