"""LOOKS c2b: sheets, 1:1 crops and the cost table for a crowd run (web/looks2_reel.mjs stills ... --out DIR).

    python3 scripts/looks_c2b_report.py DIR
Writes DIR/sheet_270.jpg, DIR/sheet_135.jpg (3 rows x raw + 8 looks), DIR/crops_1to1.jpg (hero and rank crops),
DIR/cost.md (look pass and frame per look, with the load average recorded next to the run) and DIR/metrics.jsonl.
"""
import sys, json, os, statistics
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

LOOKS = ['raw', 'KLUTSIS', 'SERIGRAPH', 'INTAGLIO', 'RISO', 'NEWSREEL', 'BROADSIDE', 'SODIUM', 'NOTAN']
ROWS = ['close', 'mid', 'far']


def sheet(D, w, out):
    cells = [[Image.open(f'{D}/crowd_{r}_{m}.jpg').convert('RGB') for m in LOOKS] for r in ROWS]
    h = round(1920 * w / 1080); lab = 14
    S = Image.new('RGB', (w * len(LOOKS), (h + lab) * len(ROWS)), (12, 12, 12)); g = ImageDraw.Draw(S)
    for i, row in enumerate(cells):
        for j, im in enumerate(row):
            S.paste(im.resize((w, h), Image.LANCZOS), (j * w, i * (h + lab) + lab)); g.text((j * w + 3, i * (h + lab) + 1), f'{ROWS[i]} {LOOKS[j]}', fill=(235, 220, 90))
    S.save(out, quality=90)


def crops(D, out):
    boxes = {'close': (380, 700, 780, 1100), 'far': (380, 1000, 780, 1400), 'mid': (200, 1150, 600, 1550)}
    tiles = []
    for r in ROWS:
        for m in ['KLUTSIS', 'SERIGRAPH', 'INTAGLIO', 'BROADSIDE', 'RISO', 'NOTAN']:
            tiles.append((f'{r} {m}', Image.open(f'{D}/crowd_{r}_{m}.jpg').convert('RGB').crop(boxes[r])))
    cols = 6; S = Image.new('RGB', (cols * 400, (len(tiles) // cols) * 414), (12, 12, 12)); g = ImageDraw.Draw(S)
    for k, (lab, im) in enumerate(tiles):
        x, y = (k % cols) * 400, (k // cols) * 414; S.paste(im, (x, y + 14)); g.text((x + 3, y + 1), lab + ' (1:1)', fill=(235, 220, 90))
    S.save(out, quality=90)


def metrics(p, dark=0.14):
    L = np.asarray(Image.open(p).convert('L').resize((270, 480), Image.LANCZOS), np.float32) / 255
    lab, n = ndimage.label(L <= dark); big = np.bincount(lab.ravel())[1:].max() / L.size if n else 0
    return {'dark': round(float((L <= dark).mean()), 3), 'darkMax_all': round(float(big), 3)}


def main(D):
    sheet(D, 270, f'{D}/sheet_270.jpg'); sheet(D, 135, f'{D}/sheet_135.jpg'); crops(D, f'{D}/crops_1to1.jpg')
    rows = [json.loads(l) for l in open(f'{D}/checks.jsonl') if l.startswith('{')]
    with open(f'{D}/metrics.jsonl', 'w') as f:
        for r in rows:
            m = metrics(f"{D}/{r['file']}"); f.write(json.dumps({**{k: r.get(k) for k in ('file', 'look_ms', 'frame_ms', 'rankValues', 'distinctRanks', 'darkMax')}, **m}) + '\n')
    load = ' / '.join(open(f'{D}/{n}').read().split('load average:')[-1].strip() for n in ('load_start.txt', 'load_end.txt') if os.path.exists(f'{D}/{n}'))
    out = ['| look | look pass (s), close / mid / far | full frame (s), median | target |', '|---|---|---|---|']
    for m in LOOKS[1:]:
        lk = [next((r['look_ms'] for r in rows if r['subject'] == s and r['mode'] == m), None) for s in ROWS]
        fr = [r['frame_ms'] for r in rows if r['mode'] == m]
        out.append(f"| {m} | {' / '.join(f'{v / 1000:.2f}' if v else '-' for v in lk)} | {statistics.median(fr) / 1000:.2f} | {'1.2' if m == 'SODIUM' else '0.8'} / 1.5 |")
    comp = sorted({r['compose_once_ms'] for r in rows})
    out += ['', f'compose once per shot: {", ".join(f"{c / 1000:.1f}" for c in comp)} s. Load average at start / end of the run: {load} (4 cores).']
    open(f'{D}/cost.md', 'w').write('\n'.join(out) + '\n'); print('\n'.join(out))


if __name__ == '__main__':
    main(sys.argv[1])
