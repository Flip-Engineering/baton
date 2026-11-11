#!/usr/bin/env python3
"""MODELING c4: the weight board. From probe_erect.mjs dumps: where the centre of mass is against what holds the giant up, and
how far each ram is out of its stroke, through the kneel-to-stand and the girder carry. Lines are direct-labelled (no colour-only
identity); one y-axis per panel."""
import json, sys, os
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
def spread(vals, gap=.045):
    o = sorted(range(len(vals)), key=lambda i: vals[i]); out = list(vals)
    for a, b in zip(o, o[1:]):
        if out[b] - out[a] < gap: out[b] = out[a] + gap
    return out
W = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'review', 'studio_modeling_c4', 'after')
S = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']; INK, INK2, GRID, SURF = '#0b0b0b', '#52514e', '#e4e3df', '#fcfcfb'
def load(n): return json.load(open(os.path.join(W, 'work', n)))
def style(ax):
    ax.set_facecolor(SURF); [s.set_visible(False) for k, s in ax.spines.items() if k in ('top', 'right')]
    for k in ('left', 'bottom'): ax.spines[k].set_color(INK2)
    ax.tick_params(colors=INK2, labelsize=9); ax.grid(color=GRID, lw=.8); ax.set_axisbelow(True)
K, Cr = load('weight_kneel.json'), load('weight_carry.json')
fig = plt.figure(figsize=(16, 10), facecolor=SURF)
fig.text(.02, .965, 'MODELING c4: where the weight is. ERECTOR, kneel-to-stand (top) and girder carry (bottom).', fontsize=15, color=INK, weight='bold')
fig.text(.02, .94, 'Centre of mass from segment masses (5,700 t + a 240 t girder) against the support polygon of whatever is on the ground (soles, toe pads, the knee). Ram extension = (length - closed length) / stroke: 0 closed, 1 fully out.', fontsize=10, color=INK2)
# --- kneel: top view
ax = fig.add_axes([.03, .5, .25, .4]); style(ax); ax.set_aspect('equal'); ax.set_title('Top view, kneel to stand (m)', fontsize=11, color=INK, loc='left')
for t, ls, lab in [(0.0, '-', 'kneeling: knee + toe + left foot'), (5.0, '--', 't 5.0: left foot only'), (9.8, ':', 'standing: both feet')]:
    r = min(K, key=lambda r: abs(r['t'] - t)); h = r['s']['hull'] + [r['s']['hull'][0]]
    ax.plot([p[0] for p in h], [p[1] for p in h], ls, color=INK2, lw=1.4); c = r['s']['com']; ax.plot(c['x'], c['z'], 'o', color=INK, ms=6)
    ax.annotate(lab, (h[0][0], h[0][1]), fontsize=8, color=INK2, xytext=(3, -12), textcoords='offset points')
ax.plot([r['s']['com']['x'] for r in K], [r['s']['com']['z'] for r in K], color=S[0], lw=2); ax.annotate('COM path', (K[len(K)//2]['s']['com']['x'], K[len(K)//2]['s']['com']['z']), color=INK, fontsize=9, xytext=(8, 0), textcoords='offset points')
ax.set_xlabel('x (left +)', color=INK2); ax.set_ylabel('z (forward +)', color=INK2)
# --- kneel: margin
ax = fig.add_axes([.33, .5, .3, .4]); style(ax); ax.set_title('Stability margin, kneel to stand (m inside the support)', fontsize=11, color=INK, loc='left')
ts = [r['t'] for r in K]; ax.plot(ts, [r['s']['margin'] for r in K], color=S[0], lw=2); ax.axhline(0, color=INK2, lw=1)
for t, lab in [(2.9, 'knee lifts'), (4.3, 'right foot lifts'), (5.7, 'plant')]: ax.axvline(t, color=GRID, lw=1.5, ls='--'); ax.text(t + .05, ax.get_ylim()[1] * .92 if ax.get_ylim()[1] > 0 else 5, lab, fontsize=8, color=INK2, rotation=90, va='top')
ax.set_xlabel('s', color=INK2); ax.text(ts[-1], K[-1]['s']['margin'], ' margin', fontsize=9, color=INK, va='center')
# --- kneel: rams
ax = fig.add_axes([.68, .5, .3, .4]); style(ax); ax.set_title('Ram extension, kneel to stand (0 closed, 1 full stroke)', fontsize=11, color=INK, loc='left')
KR = [('kneeL1', 'left knee'), ('hipL', 'left hip'), ('ankleR', 'right ankle'), ('kneeR1', 'right knee')]; ys = spread([K[-1]['s']['rams'].get(k) for k, _ in KR])
for i, (k, lab) in enumerate(KR):
    y = [r['s']['rams'].get(k) for r in K]; ax.plot(ts, y, color=S[i], lw=2); ax.text(ts[-1] + .1, ys[i], lab, fontsize=9, color=INK, va='center')
ax.axhspan(-.1, 0, color=GRID); ax.axhspan(1, 1.1, color=GRID); ax.set_ylim(-.25, 1.12); ax.set_xlim(0, 11.2); ax.set_xlabel('s', color=INK2)
# --- carry: margin and rams
tc = [r['t'] for r in Cr]
ax = fig.add_axes([.33, .06, .3, .36]); style(ax); ax.set_title('Stability margin with the girder (m)', fontsize=11, color=INK, loc='left')
ax.plot(tc, [r['s']['margin'] for r in Cr], color=S[0], lw=2); ax.axhline(0, color=INK2, lw=1)
for t, lab in [(4.4, 'grip'), (7.4, 'stood up'), (11.6, 'set down')]: ax.axvline(t, color=GRID, lw=1.5, ls='--'); ax.text(t + .05, 5.0, lab, fontsize=8, color=INK2, rotation=90, va='top')
ax.set_ylim(0, 5.4); ax.set_xlabel('s', color=INK2)
ax = fig.add_axes([.68, .06, .3, .36]); style(ax); ax.set_title('Ram extension, girder carry', fontsize=11, color=INK, loc='left')
for i, (k, lab) in enumerate([('kneeL1', 'knee'), ('hipL', 'hip'), ('shoulderL', 'shoulder'), ('elbowL', 'elbow')]):
    y = [r['s']['rams'].get(k) for r in Cr]; ax.plot(tc, y, color=S[i], lw=2); ax.text(tc[-1] + .1, y[-1], lab, fontsize=9, color=INK, va='center')
ax.axhspan(-.1, 0, color=GRID); ax.axhspan(1, 1.1, color=GRID); ax.set_ylim(-.1, 1.12); ax.set_xlim(0, 15); ax.set_xlabel('s', color=INK2)
ax = fig.add_axes([.03, .06, .25, .36]); ax.axis('off')
mk = max(r['s']['margin'] for r in K); mn = min(r['s']['margin'] for r in K); ms = max(max(abs(v) for v in r['s']['miss'].values()) for r in K + Cr)
over = max(max([v for v in r['s']['rams'].values()]) for r in K + Cr); under = min(min([v for v in r['s']['rams'].values()]) for r in K + Cr)
txt = (f'Kneel-to-stand, 0-9.8 s at 0.1 s:\n  COM inside the support all the way: min margin {mn:.2f} m\n  (single support on the left foot, 4.3-5.7 s)\n'
       f'  largest IK miss, legs and arms: {ms:.2f} m\n\nRams (both acts): extension {under:.2f} to {over:.2f}\n  (>1 = past full stroke; sized from the joints\' ranges,\n  telescopic where the stroke exceeds the barrel)\n\n'
       f'Pace: sqrt-scaled from a person (~4x slower),\n  not a human move slowed down.')
ax.text(0, .95, txt, fontsize=10, color=INK, va='top', family='monospace')
fig.savefig(os.path.join(W, '08_weight.jpg'), dpi=110, facecolor=SURF); print('wrote 08_weight.jpg', mn, ms, under, over)
