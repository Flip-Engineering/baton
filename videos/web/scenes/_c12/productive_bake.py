"""PRODUCTIVE FORCES c12: bake the thermal wall's film (public-domain archive film -> heat atlases via tools/heat_key.py).
Sources: Master Hands (1936, Prelinger, PD), Steel: Man's Servant (1938, NFPF, PD mark), A Great Railroad at Work II (1942, Prelinger, PD),
and the remote films fetched to a scratch dir (see CATALOG in sources/footage). Usage: python3 productive_bake.py [name ...]  (default: all local)
Writes videos/web/assets/productive/<name>.jpg + clips.json.  cx given = a portrait window baked for a full-bleed shot."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'tools'))
import heat_key as hk
F = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'sources', 'footage')
S = lambda f: os.path.join(F, f)
SCR = os.environ.get('PF_SRC', '/tmp/claude-0/-home-user-Blog-Posts/3001c6c1-cab9-5784-8806-2fdf4f7a480a/scratchpad/pf/src')
R = lambda f: os.path.join(SCR, f)
M1, M2, M3, M4, GR2 = [S(x) for x in ('MasterHa1936.mp4', 'MasterHa1936_2.mp4', 'MasterHa1936_3.mp4', 'MasterHa1936_4.mp4', 'GreatRai1942_2.mp4')]
# name: (file, t0, dur, options)
CLIPS = {
  'ladle':   (S('steel_1124.mp4'), 0, 5, {'cx': 0.5}), 'ladle2': (S('steel_1124.mp4'), 9, 5, {}),
  'rods':    (S('steel_1258.mp4'), 0, 6, {}), 'group': (S('steel_1258.mp4'), 17, 6, {}),
  'pour':    (S('steel_0516.mp4'), 8, 5, {}), 'hopper': (S('steel_0516.mp4'), 0, 5, {}), 'twomen': (S('steel_0516.mp4'), 5, 3, {}),
  'molds':   (S('steel_1336.mp4'), 0, 6, {}), 'bar': (S('steel_2425.mp4'), 0, 6, {}),
  'faces':   (M1, 88.5, 5, {}), 'micro': (M1, 109, 5, {}), 'lever': (M1, 235.5, 3.5, {}), 'start': (M1, 251, 4.5, {}),
  'valve':   (M1, 215, 3, {}), 'gauge': (M1, 218, 6, {}), 'flywheel': (M1, 240, 6, {'bgain': 0.5, 'bdetail': 0.25, 'motion': 0.7}), 'gear': (M1, 224, 6, {'bgain': 0.5, 'bdetail': 0.25, 'motion': 0.7}),
  'cupola':  (M2, 35, 6, {}), 'fFaces': (M2, 239, 6, {}), 'castings': (M2, 330, 6, {}), 'forge': (M3, 19, 8, {}),
  'frameline': (M4, 96, 8, {}), 'hands': (M4, 320, 6, {}), 'press': (M4, 81, 8, {}), 'floor': (M4, 148, 8, {'topcut': 0.2}), 'bigpress': (M4, 291, 8, {}),
  'assembly': (M4, 504, 8, {'topcut': 0.15}), 'wheelfit': (M4, 500, 6, {}),
  'steam1400': (R('GreatRai1942_512kb.mp4'), 40, 8, {'bgain': 0.55, 'bdetail': 0.2}), 'streamline': (R('GreatRai1942_512kb.mp4'), 160, 8, {'bgain': 0.5, 'bdetail': 0.2}), 'steamApproach': (R('GreatRai1942_512kb.mp4'), 432, 8, {'bgain': 0.55, 'bdetail': 0.2}),
  'tubesA': (R('el.mp4'), 366, 12, {}), 'tubesB': (R('el.mp4'), 946, 8, {}), 'tubesC': (R('el.mp4'), 962, 8, {}),
  'damCrowd': (R('BoulderD1931_2_512kb.mp4'), 443, 8, {}), 'damCage': (R('BoulderD1931_2_512kb.mp4'), 532, 8, {}), 'damForms': (R('BoulderD1931_2_512kb.mp4'), 642, 6, {}),
  'gen':     (M2, 0, 8, {}),
  'loco':    (GR2, 144, 8, {'bgain': 0.5, 'bdetail': 0.2}), 'control': (GR2, 228, 8, {}), 'nightloco': (GR2, 40, 8, {'bgain': 0.5, 'bdetail': 0.2}),
}
if __name__ == '__main__':
    for k in (sys.argv[1:] or CLIPS):
        f, t0, dur, o = CLIPS[k]
        if not os.path.exists(f): print('missing', f); continue
        print(k, hk.bake(k, f, t0, dur, **o), flush=True)
