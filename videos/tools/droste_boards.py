"""droste_boards.py: the variant chain boards of the droste studio (c2): every variant's chain in camera order, each stage with its come-alive frames
(first / middle / last of the graded film or lamp loop, as the engine plays it), the lock stage boxed in red, the placement of each film written on it
(FULL = fills the frame during a hold, CELL = plays inside its cell during the pull-back, LIGHT = lamps only), at full size and at 270 px.

    python3 tools/droste_boards.py OUT_DIR        # -> OUT_DIR/variant_chains_full.jpg and variant_chains_270.jpg
Variants A, B, D, E are built in the engine (chains v3_A, v4, v3d, v3); C and F are boards only (their heroes and films are the candidates of
review/subject_t2_candidates/), F waits on the Willow Run rights answer.
"""
import os, sys
import numpy as np
import cv2
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
OUT = os.path.join(VIDEOS, 'out'); CAND = os.path.join(VIDEOS, 'review', 'subject_t2_candidates')
HZ = os.path.join(OUT, 'subject', 'heroes'); H3 = os.path.join(OUT, 'subject', 'heroes_v3')


def im(p, w=None):
    a = cv2.imread(p)
    if a is None:
        a = np.full((1920, 1080, 3), 60, np.uint8)
    return a


def crop916(a):
    h, w = a.shape[:2]; tw = int(h * 9 / 16)
    if tw <= w:
        x = (w - tw) // 2; return a[:, x:x + tw]
    th = int(w * 16 / 9); y = (h - th) // 2; return a[y:y + th]


def film3(key, fid, ks=(0.0, 0.5, 1.0)):
    d = os.path.join(OUT, key, 'films', fid)
    n = len([f for f in os.listdir(d) if f.endswith('.jpg')])
    return [im(os.path.join(d, '%04d.jpg' % min(n - 1, int(k * (n - 1))))) for k in ks]


P = {'H': crop916(im(os.path.join(HZ, 'H.jpg'))), 'T1': crop916(im(os.path.join(HZ, 'T1.jpg'))), 'EYE': crop916(im(os.path.join(HZ, 'lynch_eye_window.png'))),
     'HV': im(os.path.join(H3, 'HV.jpg')), 'LB': im(os.path.join(H3, 'LB.jpg')), 'IB': im(os.path.join(H3, 'IB.jpg'))}
for k in 'B_coulee_pipe D_hoover_skip G_b17_fuselage L_army_computers'.split():
    P[k.split('_')[0]] = crop916(im(os.path.join(CAND, 'crops', k + '_916.jpg')))
CF = {k: im(os.path.join(CAND, 'film_frames', 'fr_%s.jpg' % k)) for k in ('columbia', 'willowrun')}
NAME = {'H': 'Lynch 1942', 'T1': 'Sievers 1943 steam', 'HV': 'Hoover drillers 1933', 'LB': 'Liberty crew 1941', 'IB': 'IBM 704 1957', 'EYE': 'the eye', 'B': 'Coulee penstock',
        'D': 'Hoover skip', 'G': 'B-17 fuselage', 'L': 'Army computers'}


def stage(k, films=None, lock=False, note=''):
    return dict(k=k, films=films or [], lock=lock, note=note)


def variants():
    hammer, scal, ring = film3('subject_v3', 'hammer'), film3('subject_v3', 'scalers'), film3('subject_v3', 'ring')
    skip = film3('subject_v3', 'skip')
    lamps = film3('subject_v4', 'lamps')
    return [
        ('A  stills only, no come-alive (hands lock)', [stage('H'), stage('T1'), stage('HV'), stage('LB', lock=True), stage('EYE')]),
        ('B  = E + the computing stage, lit by its own lamps (v4)', [stage('H'), stage('T1', hammer, note='FULL'), stage('HV', scal, note='CELL'), stage('LB', ring, True, 'FULL'),
                                                                  stage('IB', lamps, note='LIGHT'), stage('EYE')]),
        ('C  Coulee penstock for the dam (board only)', [stage('H'), stage('T1', hammer, note='FULL'), stage('B', [CF['columbia']] * 3, note='CELL'), stage('LB', ring, True, 'FULL'), stage('EYE')]),
        ('D  = E + a neighbour cell alive (the skip, same shift) (v3d)', [stage('H'), stage('T1', hammer, note='FULL'), stage('HV', [scal[0], scal[2], skip[0]], note='CELL + 1 NEIGHBOUR'),
                                                                        stage('LB', ring, True, 'FULL'), stage('EYE')]),
        ('E  hammer FULL, scalers CELL, big ring FULL (v3)', [stage('H'), stage('T1', hammer, note='FULL'), stage('HV', scal, note='CELL'), stage('LB', ring, True, 'FULL'), stage('EYE')]),
        ('F  lock on the B-17 line + Willow Run (board only; rights open)', [stage('H'), stage('T1', hammer, note='FULL'), stage('HV', scal, note='CELL'),
                                                                           stage('G', [CF['willowrun']] * 3, True, 'FULL'), stage('L'), stage('EYE')]),
    ]


def card(st, w):
    a = P[st['k']]
    h = int(w * 16 / 9)
    c = cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA)
    if st['lock']:
        cv2.rectangle(c, (0, 0), (w - 1, h - 1), (40, 40, 220), max(2, w // 50))
    s = max(w / 300, 0.45)
    cv2.rectangle(c, (0, h - int(28 * s)), (w, h), (0, 0, 0), -1)
    cv2.putText(c, NAME[st['k']] + (' LOCK' if st['lock'] else ''), (4, h - int(8 * s)), cv2.FONT_HERSHEY_SIMPLEX, 0.55 * s, (255, 255, 255), max(1, int(1.4 * s)))
    # the film frames: a strip down the right side, first / middle / last
    fw = int(w * 0.34)
    y = int(4 * s)
    for i, f in enumerate(st['films'][:3]):
        fh = int(fw * f.shape[0] / f.shape[1]) if f.shape[1] > f.shape[0] else int(fw * f.shape[0] / f.shape[1])
        fh = min(fh, int(h * 0.30))
        t = cv2.resize(f, (fw, fh), interpolation=cv2.INTER_AREA)
        c[y:y + fh, w - fw - 4:w - 4] = t
        cv2.rectangle(c, (w - fw - 4, y), (w - 4, y + fh), (255, 200, 60), max(1, int(2 * s)))
        y += fh + int(3 * s)
    if st['note']:
        cv2.putText(c, st['note'], (6, int(18 * s)), cv2.FONT_HERSHEY_SIMPLEX, 0.5 * s, (60, 220, 255), max(1, int(1.5 * s)))
    return c


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    V = variants()
    for w, tag in ((300, 'full'), (152, '270')):
        rows = []
        for name, ch in V:
            cells = [card(s, w) for s in ch]
            while len(cells) < 6:
                cells.append(np.full_like(cells[0], 30))
            gap = max(2, w // 40)
            row = np.hstack([np.hstack([c, np.full((c.shape[0], gap, 3), 245, np.uint8)]) for c in cells])
            sc = max(w / 300, 0.5)
            bar = np.full((int(36 * sc), row.shape[1], 3), 245, np.uint8)
            cv2.putText(bar, name, (6, int(26 * sc)), cv2.FONT_HERSHEY_SIMPLEX, 0.75 * sc, (20, 20, 140), max(1, int(2 * sc)))
            rows.append(np.vstack([bar, row]))
        cv2.imwrite(os.path.join(out, 'variant_chains_%s.jpg' % tag), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])
    print('boards ->', out)


if __name__ == '__main__':
    main()
