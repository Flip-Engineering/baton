#!/usr/bin/env python3
"""REGISTER CHECK (ARCHIVE SCENES): an aid to the eye that says what LOOK each moment of a piece is in and where looks change, as a
timeline for a person to read. It never passes or fails anything and no gate reads it. Whether looks mix well (a declared collage:
Klutsis, Heartfield) is judged by watching; which source films two pieces share is a fact stock_use.py finds.

  python3 videos/tools/register_check.py report OUT_DIR PIECE=path.mp4 [PIECE2=path2.mp4 ...] [--fps 3] [--window 4.2:8.6@HORDE]
                                               [--no-clip] [--keep-models]

What it reports, per piece:
  registers    one label per sampled frame: PHOTOGRAPH, FILM, 3D RENDER, FLAT VECTOR / CUTOUT, PRINT / ENGRAVING, TYPE CARD. Two opinions are combined:
               a zero-shot CLIP read of the whole frame (Xenova ViT-B/32 int8, deleted after the run) and plain image statistics (grain left in flat areas, number
               of distinct colours, share of flat blocks, hard-edged shapes). Where the two disagree the frame is marked uncertain, not forced.
  runs         where the register changes between samples, as runs of one look.
  inside       per frame, whether some regions carry film grain and others none (a flat shape composited into a photograph), by a 3x3 grain map.

Outputs OUT_DIR/register_<PIECE>.json, register_<PIECE>.md, register_<PIECE>_timeline.jpg (frames with a colour bar per register).
A tool for calibration by eye: read the sheet, not only the numbers.
"""
import sys, os, json, math, collections
import numpy as np
import cv2
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'engine'))

LABELS = ['PHOTOGRAPH / FILM', '3D RENDER', 'FLAT VECTOR / CUTOUT', 'PRINT / ENGRAVING', 'TYPE CARD']
PROMPTS = {
    'PHOTOGRAPH / FILM': ['a black and white photograph of people from the 1890s', 'a documentary photograph with film grain', 'a still photograph of a crowd of real people',
                          'a frame from an old silent film with scratches', 'a frame from a 1930s documentary film', 'a blurry frame of archival motion picture footage'],
    '3D RENDER': ['a 3d computer graphics render with smooth shading', 'a low poly 3d scene', 'a cgi render of a character'],
    'FLAT VECTOR / CUTOUT': ['a flat vector illustration with black silhouettes', 'a simple flat cutout graphic of a train and a sun', 'clip art with solid colour shapes'],
    'PRINT / ENGRAVING': ['a letterpress print or an engraving', 'a halftone printed poster', 'a bas relief embossed image'],
    'TYPE CARD': ['a card with large bold white text on a plain background', 'a title card with words', 'big typography on a dark background'],
}
COLORS = {'PHOTOGRAPH / FILM': (60, 150, 90), '3D RENDER': (200, 160, 60), 'FLAT VECTOR / CUTOUT': (200, 60, 60), 'PRINT / ENGRAVING': (150, 90, 190), 'TYPE CARD': (140, 140, 140)}


# ---------------------------------------------------------------- statistics
def stats(bgr):
    """Plain statistics on a 270x480 frame."""
    im = cv2.resize(bgr, (270, 480), interpolation=cv2.INTER_AREA)
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    q = (im >> 4).reshape(-1, 3)
    codes = q[:, 0].astype(np.int32) * 256 + q[:, 1].astype(np.int32) * 16 + q[:, 2]
    cnt = np.bincount(codes, minlength=4096)
    ncol = int((cnt > 0.0005 * len(codes)).sum())                      # colours that matter (>0.05% of pixels)
    top2 = float(np.sort(cnt)[-2:].sum() / len(codes))
    hp = g - cv2.GaussianBlur(g, (0, 0), 1.2)
    B = 8
    h, w = g.shape
    bl = g[:h // B * B, :w // B * B].reshape(h // B, B, w // B, B).transpose(0, 2, 1, 3).reshape(-1, B * B)
    var = bl.var(1)
    flat = var < 2e-5
    hpb = hp[:h // B * B, :w // B * B].reshape(h // B, B, w // B, B).transpose(0, 2, 1, 3).reshape(-1, B * B)
    mid = (bl.mean(1) > .04) & (bl.mean(1) < .93)                       # grain is measured off the clipped blacks/whites
    quiet = (var < 4e-4) & mid                                           # low-structure blocks: where grain shows if there is any
    grain = float(hpb[quiet].std()) if quiet.sum() > 20 else 0.0
    # hard edges: share of strong edge pixels whose profile is a 1-2 px step (vector) rather than a ramp
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1)
    mag = np.hypot(gx, gy)
    strong = mag > .35
    gb = cv2.GaussianBlur(g, (0, 0), 2.0)
    mb = np.hypot(cv2.Sobel(gb, cv2.CV_32F, 1, 0), cv2.Sobel(gb, cv2.CV_32F, 0, 1))
    step = float(((mag > .35) & (mb < .5 * mag)).sum() / max(1, strong.sum())) if strong.sum() > 30 else 0.0
    # 3x3 grain map (is some region grainy and another dead flat?)
    gm = []
    for r in range(3):
        for c in range(3):
            sl = (slice(r * h // 3, (r + 1) * h // 3), slice(c * w // 3, (c + 1) * w // 3))
            a = hp[sl]; v = g[sl]
            m = cv2.GaussianBlur(v, (0, 0), 3)
            qm = (np.abs(v - m) < .03) & (v > .04) & (v < .93)
            gm.append(float(a[qm].std()) if qm.sum() > 200 else -1.0)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    sat = hsv[..., 1] > 40
    hue = hsv[..., 0][sat].astype(np.float32) * 2 * math.pi / 180 if sat.sum() > 200 else np.array([0.], np.float32)
    R = float(np.hypot(np.cos(hue).mean(), np.sin(hue).mean()))        # 1 = one hue (a duotone), 0 = every hue
    ent = float(-(lambda p: (p[p > 0] * np.log2(p[p > 0])).sum())(np.bincount((g * 255).astype(np.uint8).ravel(), minlength=256) / g.size))
    return dict(ncolors=ncol, top2=round(top2, 3), flat=round(float(flat.mean()), 3), grain=round(grain, 4), step=round(step, 3), hue_conc=round(R, 3),
                tone_entropy=round(ent, 2), grain_map=[round(v, 4) for v in gm], dark=round(float((g < .08).mean()), 3), light=round(float((g > .85).mean()), 3))


def stat_label(s):
    """What the statistics alone say (an opinion, with the reason). Grain cannot separate looks here: the pieces lay one film grain over everything.
    What separates a flat drawing from a photograph is the edge: a vector shape has hard 1-2 px steps and big flat areas; a photograph's edges are ramps."""
    if s['top2'] > .86 and s['ncolors'] < 40:
        return 'TYPE CARD', 'two colours cover >86% of the frame'
    if s['flat'] > .5 and s['step'] > .6 and s['ncolors'] < 150:
        return 'FLAT VECTOR / CUTOUT', f"{int(s['flat'] * 100)}% flat blocks, {int(s['step'] * 100)}% of strong edges are hard steps, {s['ncolors']} colours"
    if s['grain'] < .004 and s['tone_entropy'] > 5.4 and s['step'] < .5:
        return '3D RENDER', f"no grain, smooth gradients, tone entropy {s['tone_entropy']}"
    return 'PHOTOGRAPH / FILM', f"soft edges ({int(s['step'] * 100)}% hard steps), tonal range {s['tone_entropy']}"


def mixed_inside(s):
    gm = [v for v in s['grain_map'] if v >= 0]
    if len(gm) >= 4 and max(gm) > .012 and min(gm) < .003:
        return True
    return False


# ---------------------------------------------------------------- CLIP
class Clip:
    def __init__(self):
        from archive import clipx
        self.cx = clipx
        self.ok = clipx.models_present() and os.path.exists(os.path.join(clipx.MODELS, 'text_model_quantized.onnx'))
        if not self.ok:
            return
        self.V = clipx.Vision(threads=2)
        T = clipx.Text(threads=2)
        self.lab, rows = [], []
        for l, ps in PROMPTS.items():
            for p in ps:
                self.lab.append(l)
                rows.append(p)
        self.te = T(rows)
        self.lab = np.array(self.lab)

    def __call__(self, bgr_list):
        MEAN, STD = self.cx.MEAN, self.cx.STD
        xs = []
        for b in bgr_list:                                    # the whole frame, squashed: the register is in the texture, not the middle square
            a = cv2.resize(cv2.cvtColor(b, cv2.COLOR_BGR2RGB), (224, 224), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
            xs.append(((a - MEAN) / STD).transpose(2, 0, 1))
        e = self.V.s.run(None, {'pixel_values': np.stack(xs)})[0]
        e /= np.linalg.norm(e, axis=1, keepdims=True)
        sims = e @ self.te.T * 100
        out = []
        for row in sims:
            # TYPE CARD is decided by the statistics only: nearly every frame of these pieces carries big type over a picture, and the register is the picture's
            sc = {l: float(row[self.lab == l].mean()) for l in LABELS if l != 'TYPE CARD'}
            m = max(sc.values())
            p = {l: math.exp(sc[l] - m) for l in sc}
            z = sum(p.values())
            p = {l: p[l] / z for l in sc}
            best = max(p, key=p.get)
            out.append((best, round(p[best], 2), p))
        return out


# ---------------------------------------------------------------- piece
def read_frames(path, fps):
    cap = cv2.VideoCapture(path)
    vf = cap.get(cv2.CAP_PROP_FPS) or 30
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    dur = n / vf
    out = []
    t = 0.0
    while t < dur - 1e-3:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * vf)))
        ok, fr = cap.read()
        if ok:
            out.append((round(t, 3), fr))
        t += 1.0 / fps
    cap.release()
    return out, dur


def analyse(name, path, fps, clip):
    frames, dur = read_frames(path, fps)
    rows = []
    cl = clip(([f for _, f in frames])[:0]) if False else None
    probs = []
    if clip.ok:
        for i in range(0, len(frames), 16):
            probs += clip([f for _, f in frames[i:i + 16]])
    for k, (t, fr) in enumerate(frames):
        s = stats(fr)
        sl, why = stat_label(s)
        if clip.ok:
            cb, cp, allp = probs[k]
        else:
            cb, cp, allp = None, 0, {}
        # combined: the statistics decide TYPE CARD and FLAT VECTOR (hard-edged flat areas); CLIP reads the rest. Disagreement is kept, not hidden.
        if cb is None:
            lab, unc = sl, True
        elif sl in ('TYPE CARD', 'FLAT VECTOR / CUTOUT'):
            lab, unc = sl, (cb != sl and cp > .8)
        elif cb == 'FLAT VECTOR / CUTOUT':
            lab, unc = ('FLAT VECTOR / CUTOUT', True) if cp > .75 else ('PHOTOGRAPH / FILM', True)
        else:
            lab, unc = cb, (cb != sl and sl != 'PHOTOGRAPH / FILM')
        rows.append(dict(t=t, label=lab, uncertain=bool(unc), clip=cb, clip_p=cp, stats_label=sl, stats_why=why, mixed_inside=mixed_inside(s), stats=s))
    # shots: a cut is a large change between samples; a shot takes its register from the majority of its frames (one frame's noise does not make a change)
    sm = [cv2.cvtColor(cv2.resize(f, (27, 48), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255 for _, f in frames]
    cuts = [0] + [i for i in range(1, len(sm)) if float(np.abs(sm[i] - sm[i - 1]).mean()) > .10] + [len(sm)]
    for a_, b_ in zip(cuts[:-1], cuts[1:]):
        seg = rows[a_:b_]
        if len(seg) < 2:
            continue
        cnt = collections.Counter(r['label'] for r in seg)
        top, n = cnt.most_common(1)[0]
        for r in seg:
            if r['label'] != top and cnt[r['label']] < n:
                r['raw_label'] = r['label']
                r['label'] = top
    for r in rows:
        r['shot_start'] = False
    for c in cuts[1:-1]:
        rows[c]['shot_start'] = True
    return rows, dur, frames


def runs(rows):
    out = []
    for r in rows:
        if out and out[-1]['label'] == r['label']:
            out[-1]['t1'] = r['t']
            out[-1]['n'] += 1
        else:
            out.append(dict(label=r['label'], t0=r['t'], t1=r['t'], n=1))
    return out


def fmt_t(t):
    return f'{int(t // 60)}:{t % 60:04.1f}'


def timeline_sheet(name, rows, frames, out, per=14):
    w = 96
    h = int(w * 16 / 9)
    n = len(rows)
    nrows = math.ceil(n / per)
    img = Image.new('RGB', (per * w, nrows * (h + 22)), (18, 18, 18))
    d = ImageDraw.Draw(img)
    for i, (r, (t, fr)) in enumerate(zip(rows, frames)):
        x, y = (i % per) * w, (i // per) * (h + 22)
        th = Image.fromarray(cv2.cvtColor(cv2.resize(fr, (w, h), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB))
        img.paste(th, (x, y + 10))
        d.rectangle([x, y, x + w - 1, y + 9], fill=COLORS[r['label']])
        if r['uncertain']:
            d.rectangle([x, y + 10, x + w - 1, y + 12], fill=(255, 255, 0))
        if r['mixed_inside']:
            d.rectangle([x, y + h + 10, x + w - 1, y + h + 12], fill=(255, 120, 0))
        d.text((x + 2, y + h + 12), f"{r['t']:.1f}", fill=(255, 255, 0))
    leg = Image.new('RGB', (per * w, 16), (18, 18, 18))
    ld = ImageDraw.Draw(leg)
    x = 4
    for l, c in COLORS.items():
        ld.rectangle([x, 3, x + 9, 12], fill=c)
        ld.text((x + 12, 2), l, fill=(210, 210, 210))
        x += 12 + 7 * len(l) + 12
    ld.text((x, 2), 'yellow = the two opinions disagree; orange = grain in some regions only', fill=(210, 210, 210))
    out_im = Image.new('RGB', (img.width, img.height + 16))
    out_im.paste(leg, (0, 0))
    out_im.paste(img, (0, 16))
    out_im.save(out, quality=88)


def main():
    a = sys.argv[1:]
    if not a or a[0] != 'report':
        print(__doc__)
        return
    outd = a[1]
    os.makedirs(outd, exist_ok=True)
    opt = {a[i]: a[i + 1] for i in range(len(a) - 1) if a[i] in ('--fps', '--window')}
    fps = float(opt.get('--fps', 3))
    pieces = [x.split('=', 1) for x in a[2:] if '=' in x and not x.startswith('--')]
    clip = Clip() if '--no-clip' not in a else type('N', (), {'ok': False})()
    for name, path in pieces:
        rows, dur, frames = analyse(name, path, fps, clip)
        rr = runs(rows)
        md = [f'# Register report: {name}', '', f'{os.path.basename(path)}, {dur:.1f} s, sampled at {fps:g} per second ({len(rows)} frames). '
              f'Opinions: {"CLIP zero-shot + image statistics" if clip.ok else "image statistics only (no CLIP)"}. An aid to the eye: it never fails anything.', '']
        cnt = collections.Counter(r['label'] for r in rows)
        md += ['## Share of the piece by register', ''] + [f'- {l}: {100 * c / len(rows):.0f}%' for l, c in cnt.most_common()] + ['']
        md += ['## Runs', ''] + [f"- {fmt_t(x['t0'])}-{fmt_t(x['t1'] + 1 / fps)}  {x['label']}" for x in rr] + ['']
        mi = [r['t'] for r in rows if r['mixed_inside']]
        md += ['', '## Inside a frame: grain in some regions and none in others', '', ('- at ' + ', '.join(f'{t:.1f}' for t in mi[:40]) + (' ...' if len(mi) > 40 else '')) if mi else '- none seen', '']
        unc = [r for r in rows if r['uncertain']]
        md += [f'## Where the two opinions disagree: {len(unc)} of {len(rows)} frames (marked yellow on the sheet)', '']
        open(os.path.join(outd, f'register_{name}.md'), 'w').write('\n'.join(md))
        json.dump(dict(piece=name, path=os.path.basename(path), duration=dur, fps=fps, frames=rows, runs=rr), open(os.path.join(outd, f'register_{name}.json'), 'w'), indent=1)
        win = None
        if '--window' in opt and opt['--window'].endswith('@' + name):
            t0, t1 = [float(x) for x in opt['--window'].split('@')[0].split(':')]
            sel = [(r, f) for r, f in zip(rows, frames) if t0 <= r['t'] <= t1]
            timeline_sheet(name, [s[0] for s in sel], [s[1] for s in sel], os.path.join(outd, f'register_{name}_window.jpg'), per=min(14, max(4, len(sel))))
        timeline_sheet(name, rows, frames, os.path.join(outd, f'register_{name}_timeline.jpg'))
        print(name, dict(cnt))
    if clip.ok and '--keep-models' not in a:
        for f in ('vision_model_quantized.onnx', 'text_model_quantized.onnx'):
            p = os.path.join(clip.cx.MODELS, f)
            if os.path.exists(p):
                os.remove(p)
        print('CLIP weights removed')


if __name__ == '__main__':
    main()
