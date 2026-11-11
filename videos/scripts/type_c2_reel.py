"""TYPE c2: assemble the after/ reel from the work renders: clips, -8..+8 strips, payoff stills, before/after sheets.
python3 scripts/type_c2_reel.py   (paths relative to videos/)"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw

V = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(V, 'review/studio_type_c2/after'); Wk = os.path.join(A, 'work')   # clip_<demo>.mp4 renders land here (scripts/type_c2.mjs clip ... out=review/studio_type_c2/after/work); strips come from them; B = os.path.join(V, 'review/studio_type_c2/before/frames')
FF = subprocess.run(['python3', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], capture_output=True, text=True).stdout.strip()
CLIPS = [('01_otf_buttoncopy', 'clip_otf', 21.083, 19.683), ('02_giant_swarm', 'clip_giant', 26.233, 24.933), ('03_bank_intaglio_pull', 'clip_bank', 10.058, 8.6),
         ('04_1776_platen', 'clip_1776', 19.15, 17.8), ('05_civ_riso', 'clip_civ', 15.983, 15.0), ('06_wedge_punch', 'clip_wedge', 12.783, 12.55)]
for d in ('reel', 'strips', 'payoffs'):
    os.makedirs(os.path.join(A, d), exist_ok=True)


def frame(mp4, n, out):
    r = subprocess.run([FF, '-v', 'error', '-y', '-i', mp4, '-vf', f'select=eq(n\\,{n})', '-vframes', '1', '-q:v', '2', out], capture_output=True, text=True)
    if not os.path.exists(out): raise SystemExit(f'frame {n} of {mp4}: {r.stderr[:200]}')


def lab(im, text, h):
    d = ImageDraw.Draw(im); d.rectangle([0, 0, 9 * len(text) + 10, 18], fill=(0, 0, 0)); d.text((5, 3), text, fill=(255, 230, 0)); return im


for name, src, hit, a0 in CLIPS:
    shutil.copy(os.path.join(Wk, src + '.mp4'), os.path.join(A, 'reel', name + '.mp4'))
    hf = round((hit - a0) * 30 + 1e-6) if (hit - a0) * 30 % 1 < 0.5 else int((hit - a0) * 30) + 1   # the first frame at or after the onset
    tiles = []
    for k in range(-8, 9):
        if hf + k < 0:
            tiles.append(Image.new('RGB', (203, 360), (0, 0, 0))); continue
        p = os.path.join(Wk, f'_s{k}.jpg'); frame(os.path.join(Wk, src + '.mp4'), hf + k, p)
        im = Image.open(p).convert('RGB').resize((203, 360), Image.LANCZOS); tiles.append(lab(im, f'{k:+d}' + (' HIT' if k == 0 else ''), 360)); os.remove(p)
    S = Image.new('RGB', (9 * 205, 2 * 362), (30, 30, 30))
    for i, t in enumerate(tiles):
        S.paste(t, ((i % 9) * 205, (i // 9) * 362))
    S.save(os.path.join(A, 'strips', name + '_m8_p8.jpg'), quality=88)
# payoff stills: the authored objects
frame(os.path.join(Wk, 'clip_otf.mp4'), 45, os.path.join(A, 'payoffs', 'otf_sign.jpg'))       # hit + 3 frames: the high beams on
frame(os.path.join(Wk, 'clip_giant.mp4'), 45, os.path.join(A, 'payoffs', 'giant_sky_lock.jpg'))   # lock + 6
frame(os.path.join(Wk, 'clip_giant.mp4'), 59, os.path.join(A, 'payoffs', 'giant_sky_sun.jpg'))    # the disc
shutil.copy(os.path.join(Wk, 'stamp.jpg'), os.path.join(A, 'payoffs', 'bank_stamp.jpg'))
shutil.copy(os.path.join(Wk, 'poster.jpg'), os.path.join(A, 'payoffs', '1776_broadside.jpg'))
PAIRS = [('OWN THE FUTURE', 'OWN_THE_FUTURE_v6_26.2.jpg', 'otf_sign.jpg'), ("PEOPLE'S BANK", 'PEOPLES_BANK_v7_28.0.jpg', 'bank_stamp.jpg'),
         ('1776', 'SECOND_INDEPENDENCE_1776_v7_21.3.jpg', '1776_broadside.jpg'), ('THE GIANT', 'THE_GIANT_v1_24.2.jpg', 'giant_sky_lock.jpg')]
for h, tag in ((960, 'payoffs_before_after.jpg'), (480, 'payoffs_before_after_feed270.jpg')):
    w = round(h * 1080 / 1920); ww = 270 if h == 480 else w
    S = Image.new('RGB', (len(PAIRS) * (2 * ww + 20), h + 24), (24, 24, 24)); d = ImageDraw.Draw(S)
    for i, (piece, bef, aft) in enumerate(PAIRS):
        x = i * (2 * ww + 20)
        for j, p in enumerate((os.path.join(B, bef), os.path.join(A, 'payoffs', aft))):
            im = Image.open(p).convert('RGB').resize((ww, round(ww * 1920 / 1080)), Image.LANCZOS)
            S.paste(im, (x + j * ww, 24))
        d.text((x + 4, 5), f'{piece}: published | TYPE c2', fill=(255, 230, 0))
    S.save(os.path.join(A, tag), quality=88)
print('ok')
