"""CLOSER c1: build the remade-ending demo scenes (copies of the published scenes with ONLY the ending swapped for web/lib/closer.js).
The originals are not touched.  python3 videos/tools/closer_make_scenes.py  -> web/scenes/closer_c1_{meltdown,ready,giant,redwedge}.{js,html}
A piece adopts the same way: import { CLOSERS } from '../lib/closer.js' and call the one closer in its last frame."""
import os, re
V = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); S = os.path.join(V, 'web', 'scenes')
IMP = "import { CLOSERS } from '../lib/closer.js';\n"
def rd(n): return open(os.path.join(S, n)).read()
def wr(n, t): open(os.path.join(S, n), 'w').write(t)
def first_import_end(s):
    m = re.search(r"^import .*from '\.\./lib/kit\.js';\n", s, re.M)
    if not m:                                              # multi-line import
        m = re.search(r"^import \{[^}]*\} from '\.\./lib/kit\.js';\n", s, re.M | re.S)
    return m.end()
def html(js, title, src_html):
    h = rd(src_html); h = re.sub(r'<title>.*?</title>', f'<title>{title}</title>', h); return re.sub(r'src="[^"]+\.js"', f'src="{js}"', h)

# MELTDOWN: the lockup card (closer(ctx, age + 0.4)) becomes the flap board
s = rd('meltdown8.js'); assert "closer(ctx, age + 0.4);" in s
s = s.replace("closer(ctx, age + 0.4);", "CLOSERS.flaps(ctx, age);"); i = first_import_end(s); s = s[:i] + IMP + s[i:]
wr('closer_c1_meltdown.js', "// CLOSER c1 demo: meltdown8.js with its closer card replaced by CLOSERS.flaps (web/lib/closer.js). Everything else is the published scene.\n" + s)
wr('closer_c1_meltdown.html', html('closer_c1_meltdown.js', 'MELTDOWN closer c1', 'meltdown8.html'))

# READY: the lockup() card becomes the hard hat's decal
s = rd('ready.js'); a = s.index("function lockup(g, age, world) {"); b = s.index("window._dbg")
new = """function lockup(g, age, world) {
  const a = ease.outExpo(clamp(age / 0.25));
  world.fillStyle = `rgba(6,10,24,${0.5 * a})`; world.fillRect(0, 0, W, H);      // the frame stays; only dimmed under the decal
  CLOSERS.decal(g, age, { dim: 0 });
}

"""
s = s[:a] + new + s[b:]; i = first_import_end(s); s = s[:i] + IMP + s[i:]
wr('closer_c1_ready.js', "// CLOSER c1 demo: ready.js (c9 song via window.__SONG) with lockup() replaced by CLOSERS.decal.\n" + s)
wr('closer_c1_ready.html', html('closer_c1_ready.js', 'READY closer c1', 'ready_c9.html').replace('src="closer_c1_ready.js"', 'src="closer_c1_ready_boot.js"'))
wr('closer_c1_ready_boot.js', "window.__SONG = 'ready_c9';\nawait import('./closer_c1_ready.js');\n")

# GIANT: the kit card on the darkened last image becomes the stencilled beam
s = rd('giant_c5.js')
a = s.index("    ctx.fillStyle = 'rgba(6,1,1,0.66)'; ctx.fillRect(0, 0, W, H);"); b = s.index("    finish.apply(ctx, frame, { grain: 0.06, vignette: 0.35 }); return; }")
s = s[:a] + "    CLOSERS.beam(ctx, t - CLOSE * B.spb);\n" + s[b:]; i = first_import_end(s); s = s[:i] + IMP + s[i:]
wr('closer_c1_giant.js', "// CLOSER c1 demo: giant_c5.js with the closer card replaced by CLOSERS.beam.\n" + s)
wr('closer_c1_giant.html', html('closer_c1_giant.js', 'GIANT closer c1', 'giant_c5.html'))

# RED WEDGE: closerRW becomes the last stamp
s = rd('red_wedge2.js'); a = s.index("function closerRW(b, t) {"); b = s.index("// ===", a)
new = "function closerRW(b, t) {\n  const age = (b - 88) * SPB;\n  CLOSERS.stamp(ctx, age, { ground: '#a8161e' });\n}\n\n"
s = s[:a] + new + s[b:]; i = first_import_end(s); s = s[:i] + IMP + s[i:]
wr('closer_c1_redwedge.js', "// CLOSER c1 demo: red_wedge2.js with closerRW replaced by CLOSERS.stamp.\n" + s)
wr('closer_c1_redwedge.html', html('closer_c1_redwedge.js', 'RED WEDGE closer c1', 'red_wedge2.html'))
print('ok')
