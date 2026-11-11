"""droste_variants.py: derive the studio's variant chain specs from chains/v3.json (droste c2), so a change to v3 reaches every variant.

    python3 tools/droste_variants.py        # writes engine/droste/chains/{v3d,v3_A,v3_lat,v3_fullsd,v4}.json and builds their timelines

  v3d        v3 + variant D's neighbour: the cell beside the dam plays the skip film while the dam pulls back into the Liberty mosaic (shares v3's layout)
  v3_A       variant A: stills only, no come-alive (hands lock)                                                         (shares v3's layout)
  v3_lat     v2's lock on this layout: the white lattice and additive flash, no films, for the lock-window comparison    (shares v3's layout)
  v3_fullsd  the 640x480 Hoover film played full-bleed in a hold, to judge it against the in-cell placement              (proof only; shares v3's layout)
  v4         v3 + the computing stage (IBM 704, lit by its own lamps) after the lock and the big ring: its own layout (MC) and events
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)
CH = os.path.join(VIDEOS, 'engine', 'droste', 'chains')
v3 = json.load(open(os.path.join(CH, 'v3.json')))


def variant(name, key, note, mod, root='subject_v3'):
    d = json.loads(json.dumps(v3)); d['key'] = key; d['note'] = note
    if root:
        d['root'] = root
    mod(d)
    json.dump(d, open(os.path.join(CH, name + '.json'), 'w'), indent=1)


def v3d(d):
    d['cellfilms'] = [{"id": "skip", "level": "ML", "cell": {"dc": 1, "dr": 0}, "s_hi": 520, "s_lo": 90, "freeze_beats": 0.25}]


def fullsd(d):
    L = {l['id']: l for l in d['levels']}
    L['ML']['beats'] = [44, 60]; L['ML']['hold'] = 5; L['M3']['beats'] = [60, 80]
    d.update(beats=80, resolutions=[28, 44, 60, 80], lock_beat=60, silence=[59, 59.5])
    d['films'] = [{"node": "M1", "id": "hammer", "mode": "full", "start_beat": 29.2, "end_beat": 32.0, "freeze_beats": 0.5},
                  {"node": "MH", "id": "scalers", "mode": "full", "start_beat": 45.2, "end_beat": 48.0, "freeze_beats": 0.4},
                  {"node": "ML", "id": "ring2", "mode": "full", "start_beat": 61.2, "end_beat": 64.3, "freeze_beats": 0.5}]
    d['card_beats'] = {}; d['records'] = []; d['closer'] = [77.76, 79.47]


def v4(d):
    d['beats'] = 88
    d['levels'] = [l for l in d['levels'] if l['id'] != 'M3'] + [
        {"id": "MC", "kind": "mosaic", "target": "IB", "child": "ML", "beats": [56, 73], "rate": "M2", "hold": 6},
        {"id": "M3", "kind": "mosaic", "target": "E", "child": "MC", "beats": [73, 88], "rate": "M3", "hold": 3}]
    d['resolutions'] = [28, 44, 56, 73, 88]
    d['films'].append({"node": "MC", "id": "lamps", "mode": "full", "start_beat": 73.35, "end_beat": 75.9, "freeze_beats": 0.3})
    d['card_beats'].update({"14": {"beat": 54.6, "stress": [["MASS", 56]], "band_top": 200, "hold_until": 68.0}, "15": {"beat": 70, "band_top": 20},
                            "16": {"beat": 73.5, "band_top": 20}, "17": {"beat": 77, "band_top": 20}})
    d['closer'] = [85.76, 87.47]
    d['records'] = d['records'][:6] + [{"beat": 73.2, "until": 77, "rate": 40, "text": "IBM 704, NACA Langley, Virginia · 1957"}]


if __name__ == '__main__':
    variant('v3d', 'subject_v3d', "v3 with variant D's neighbour: the cell beside the dam plays the skip film while the dam pulls back.", v3d)
    variant('v3_A', 'subject_v3_A', "variant A: stills only (no come-alive), the hands lock", lambda d: d.update(films=[]))
    variant('v3_lat', 'subject_v3_lat', "v2's lock on this layout: the white lattice and additive flash (for the lock-window comparison)", lambda d: d.update(films=[], lock_style='lattice'))
    variant('v3_fullsd', 'subject_v3_fullsd', "the Hoover film (640x480) played full-bleed during a hold, to judge it against the in-cell placement", fullsd)
    variant('v4', 'subject_v4', "THE SUBJECT v4 (droste c2): v3 plus the computing stage, the IBM 704 lit only by its own lamps.", v4, root=None)
    from engine.droste import chains
    for n in ('v3', 'v3d', 'v3_A', 'v3_lat', 'v3_fullsd', 'v4', 'v3_15'):
        t = chains.build(n)
        print(n, t['key'], t['frames'], 'frames', t['beats'], 'beats')
