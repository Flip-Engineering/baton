#!/usr/bin/env python3
"""photo_cut: cut people (or one object) out of a STILL PHOTOGRAPH to a clean RGBA, the still-image mode of scripts/roto.py.

roto.py cuts from film frames listed in its FIGS table. This takes any image file: IRON IS HOT v11's cut_figs.py made general.
Same pipeline as roto (BiRefNet-lite proposal, trimap band, guided-filter refine, specks and holes cleaned, colour decontaminated
inward so no halo survives a print), plus hand strokes and a 1:1 check sheet.

  python3 videos/tools/photo_cut.py cut SRC.jpg --out DIR [--name NAME] [--box x0,y0,x1,y1] [--long 1600] [--band 5]
                                      [--strokes strokes.json] [--min-share 0.02] [--keep-all] [--force]
  python3 videos/tools/photo_cut.py sheet DIR/NAME.png [...] [--out sheet.jpg]     # grey | red | alpha, with measures
  python3 videos/tools/photo_cut.py --selftest      # no model: strokes, measures, sheet, decontamination on a synthetic matte

Writes DIR/NAME.png (RGBA, straight alpha), DIR/NAME_a.jpg (alpha), DIR/NAME.json (source, box, size, measures, head, foot).
--box crops the source first (source px); coordinates in the json are crop px. --long downsizes the working image to that long side
(default 1600: BiRefNet sees 1024 anyway; use 2400+ only for a hero whose edge will be seen at 1:1).
--strokes: {"fg": [[width, [[x,y],...]], ...], "bg": [...]} in working (post-crop, post-resize) px, applied after the refine.
--keep-all keeps every component (a pair or group); the default keeps the main one and anything >= --min-share of its area.
The model lives outside the repo (ACP_ROTO_CACHE, ~/.cache/acp_roto); about 6.5 GB of RAM, one image at a time: do not run beside a render.
Rights stay with the caller: put the credit in the scene's RIGHTS file; this tool does not read or write one.
Limits: BiRefNet separates by salience. Two men touching share one matte (use strokes); a hard-lit rim against a bright ground can bleed.
"""
import argparse, json, os, sys
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'scripts'))
import roto  # noqa: E402


def finish(im, a0, band=5, strokes=None, min_share=0.02, keep_all=False, hole=1500):
    """proposal alpha -> (rgba uint8, alpha float, measures). im BGR uint8."""
    a, _ = roto.refine(im, a0, band=band)
    if strokes: a = roto.strokes(a, strokes)
    a = a if keep_all else roto.keep_main(a, min_share)
    a = roto.fill_holes(a, hole)
    a = np.where(cv2.dilate((a > 0.5).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0, a, 0).astype(np.float32)   # half-alpha residue the band leaves off the subject
    rgb = roto.decontaminate(im, a)
    rgba = np.dstack([rgb, np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)])
    return rgba, a, roto.measures(im, a)


def head_foot(a):
    ys, xs = np.where(a > 0.5)
    if not len(ys): return None, None
    top = ys.min(); hx = int(xs[ys <= top + 3].mean()); bot = ys.max()
    return [hx, int(top)], [int(xs[ys >= bot - 3].mean()), int(bot)]


def cut_one(S, src, out, name=None, box=None, long_side=1600, band=5, strokes=None, min_share=0.02, keep_all=False, force=False):
    name = name or os.path.splitext(os.path.basename(src))[0]
    os.makedirs(out, exist_ok=True)
    png = os.path.join(out, name + '.png')
    if os.path.exists(png) and not force: print('have', name); return json.load(open(os.path.join(out, name + '.json')))
    im = cv2.imread(src, cv2.IMREAD_COLOR)
    if im is None: raise SystemExit('cannot read ' + src)
    if box: x0, y0, x1, y1 = box; im = im[y0:y1, x0:x1]
    k = long_side / max(im.shape[:2])
    if k < 1: im = cv2.resize(im, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    rgba, a, m = finish(im, roto.propose(S, im), band, strokes, min_share, keep_all)
    cv2.imwrite(png, rgba)
    cv2.imwrite(os.path.join(out, name + '_a.jpg'), (a * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 80])
    head, foot = head_foot(a)
    meta = dict(name=name, source=os.path.basename(src), box=box, size=[im.shape[1], im.shape[0]], measures=m, head=head, foot=foot, band=band, keep_all=keep_all)
    json.dump(meta, open(os.path.join(out, name + '.json'), 'w'), indent=1)
    print(name, im.shape[:2], m, flush=True)
    return meta


def sheet(pngs, outp):
    rows = []
    for p in pngs:
        im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
        if im is None or im.shape[2] < 4: print('skip (no alpha)', p); continue
        a = im[..., 3:].astype(np.float32) / 255; c = im[..., :3].astype(np.float32)
        grey = c * a + 128 * (1 - a); red = c * a + np.array([30, 30, 200], np.float32) * (1 - a)
        mp = os.path.splitext(p)[0] + '.json'
        meta = json.load(open(mp)) if os.path.exists(mp) else {}
        hx, hy = (meta.get('head') or [im.shape[1] // 2, 0])
        x0 = int(np.clip(hx - 180, 0, max(0, im.shape[1] - 360))); y0 = int(np.clip(hy - 40, 0, max(0, im.shape[0] - 360)))
        def crop(A):
            t = A[y0:y0 + 360, x0:x0 + 360]
            return cv2.copyMakeBorder(t, 0, 360 - t.shape[0], 0, 360 - t.shape[1], cv2.BORDER_CONSTANT)
        fit = lambda A: cv2.resize(A, (max(1, int(360 * A.shape[1] / A.shape[0])), 360), interpolation=cv2.INTER_AREA)
        row = np.hstack([fit(grey), crop(grey), crop(red), fit(np.dstack([a[..., 0] * 255] * 3))]).astype(np.uint8)
        cv2.putText(row, '%s %s' % (os.path.basename(p), meta.get('measures', '')), (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)
        rows.append(row)
    if not rows: raise SystemExit('nothing to show')
    w = max(r.shape[1] for r in rows)
    rows = [cv2.copyMakeBorder(r, 2, 2, 0, w - r.shape[1], cv2.BORDER_CONSTANT, value=(20, 20, 20)) for r in rows]
    cv2.imwrite(outp, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 90]); print(outp)


def selftest():
    import tempfile
    rng = np.random.RandomState(1)
    im = (rng.rand(300, 400, 3) * 40 + 100).astype(np.uint8)
    yy, xx = np.mgrid[:300, :400]
    disc = ((xx - 200) ** 2 + (yy - 150) ** 2 < 90 ** 2).astype(np.float32)
    im[disc > 0] = (200, 90, 60)
    a0 = cv2.GaussianBlur(disc, (0, 0), 3)            # a soft stand-in for the model's proposal
    a0[20:40, 20:40] = 1.0                            # a speck: must go
    a0[140:150, 190:200] = 0.0                        # a small hole: must fill
    rgba, a, m = finish(im, a0)
    assert rgba.shape == (300, 400, 4) and rgba.dtype == np.uint8
    assert a[30, 30] < 0.1, 'speck kept'
    assert a[145, 195] > 0.9, 'hole not filled'
    assert a[160, 210] > 0.99 and a[5, 5] < 0.01
    assert m['parts'] == 1 and m['holes'] == 0, m
    r2, a2, _ = finish(im, a0, strokes={'bg': [[8, [[110, 150], [160, 150]]]]})
    assert a2[150, 130] < 0.1, 'bg stroke not applied'
    r3, a3, m3 = finish(im, a0, keep_all=True)
    assert a3[30, 30] > 0.9, '--keep-all must keep the speck'
    assert head_foot(a)[0][1] < 70 < head_foot(a)[1][1], head_foot(a)
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 't.png'); cv2.imwrite(p, rgba)
        json.dump(dict(measures=m, head=head_foot(a)[0]), open(os.path.join(d, 't.json'), 'w'))
        sheet([p], os.path.join(d, 's.jpg')); assert os.path.getsize(os.path.join(d, 's.jpg')) > 1000
    print('photo_cut selftest ok')


if __name__ == '__main__':
    if '--selftest' in sys.argv: selftest(); sys.exit(0)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    c = sp.add_parser('cut'); c.add_argument('src', nargs='+'); c.add_argument('--out', required=True); c.add_argument('--name')
    c.add_argument('--box'); c.add_argument('--long', type=int, default=1600); c.add_argument('--band', type=int, default=5)
    c.add_argument('--strokes'); c.add_argument('--min-share', type=float, default=0.02); c.add_argument('--keep-all', action='store_true'); c.add_argument('--force', action='store_true')
    s = sp.add_parser('sheet'); s.add_argument('png', nargs='+'); s.add_argument('--out', default='photo_cut_sheet.jpg')
    a = ap.parse_args()
    if a.cmd == 'cut':
        if a.name and len(a.src) > 1: raise SystemExit('--name needs one source')
        S = roto.session()
        for src in a.src:
            cut_one(S, src, a.out, a.name, [int(v) for v in a.box.split(',')] if a.box else None, a.long, a.band,
                    json.load(open(a.strokes)) if a.strokes else None, a.min_share, a.keep_all, a.force)
    else: sheet(a.png, a.out)
