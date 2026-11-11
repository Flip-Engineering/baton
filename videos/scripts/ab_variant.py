#!/usr/bin/env python3
"""A/B VARIANT PAGES (GRAPHICS 4.0, 8 Oct 2026; research/GRAPHICS_UPGRADE_20261008.md section 4.0 step 4).

The farm renders one recipe, `local_render.sh --seg SCENE:CLOSER[:BPM]`, with no query string, so each variant of a scene is a
page of its own: scenes/<scene>__ab_<tag>.html is the scene's own html plus ONE line before its module script,

    <script>/* A/B ... */ history.replaceState(0, '', '?<query>'); { ...fetch redirect... } window.ACP_FX = {...};</script>

Scenes read their knobs from location.search at module start, so ?sc=, ?q=, ?K=, ?rq= work unchanged; window.ACP_FX (set
only when given) carries knobs that are not query strings (lib/rq.js reads ACP_FX.rq).

The beat map. Scenes that load beats by literal name (everydollar, mecha, giant_c5: loadBeats('<scene>') -> fetch of
out/.<scene>.hits.json) would ask for a file the farm never has: the pipeline repo tracks no out/.*.hits.json, the sync never
copies videos/out, and the worker's local_render.sh builds only out/.<job scene>.hits.json, here out/.<scene>__ab_<tag>.hits.json
(songs.py maps <scene>__ab_<tag> to the scene's own song, __getattr__, so it is the same song and the same beats). So the line
also wraps window.fetch to send /.<scene>.hits.json to /.<scene>__ab_<tag>.hits.json. It is on every variant: a scene that
fetches no such file (gary2036, ladder, skies) never meets it.

The audio path also looks the scene's name up in the audio registries (web/audio/logo_at.json: the sonic logo's lock;
closers.json; logo_gain.json; finish/<scene>.json: the span, e.g. MECHA's 31.4 s loop cut). Without those the variant's song
is mixed without the scene's logo and its span (so its frame count) can differ from the published master's. So, by default,
the variant gets the same entries as its scene (added as new keys at the end of each registry, nothing else in them changes;
the finish sheet is copied). --no-audio-alias leaves the registries alone.

  ab_variant.py SCENE TAG "QUERY" ['ACP_FX JSON']     write scenes/SCENE__ab_TAG.html (+ the audio aliases); prints the page
                                                      QUERY may be "" (a control: the unchanged scene, e.g. TAG ctl)
  ab_variant.py --rm SCENE__ab_TAG [...]              delete variant pages and their aliases (once a decision is made)
  ab_variant.py --list                                the variant pages present, with their line

  e.g.  ab_variant.py everydollar ctl ""
        ab_variant.py everydollar sc1 "sc=1&rq=1"
        ab_variant.py gary2036 k12 "K=12"
        ab_variant.py spectre beam "" '{"beam": {"march": 1}}'

Nothing here renders. Post the variants with farm.py, in the worker's one recipe, the plain run line (the homelab worker
refuses anything else, an ACP_GPU=1 prefix included: 1008-060253, 1008-060249, 1008-062820 failed "Supported recipe: ..."):
    farm.py post --commit SHA --run "sh videos/scripts/local_render.sh --seg <scene>__ab_<tag>:CLOSER[:BPM]" ...
with ONE pipeline commit (SHA) for a control and all its variants, and check the GPU afterwards from each delivery's
*-renderer.json (the homelab renders the plain recipe on its V100s).
"""
import argparse, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(HERE), 'web')
SCENES = os.path.join(WEB, 'scenes')
AUDIO = os.path.join(WEB, 'audio')
REGISTRIES = ('logo_at.json', 'closers.json', 'logo_gain.json')
MARK = '/* A/B variant (videos/scripts/ab_variant.py)'
NAME = re.compile(r'([a-z0-9_]+?)__ab_([a-z0-9_]+)')


def die(msg):
    sys.exit('ab_variant: ' + msg)


def hits_redirect(scene, variant):
    """JS: the page's fetch of out/.<scene>.hits.json goes to out/.<variant>.hits.json (the file the worker builds for this job)"""
    k, v = json.dumps('/.%s.hits.json' % scene), json.dumps('/.%s.hits.json' % variant)
    return (" { const f0 = window.fetch.bind(window), K = %s, V = %s;"
            " window.fetch = (u, ...a) => f0(typeof u === 'string' || u instanceof URL ? String(u).replace(K, V) : u, ...a); }" % (k, v))


def page_line(scene, tag, query, fx):
    q = query.strip().lstrip('?')
    if re.search(r'[\s<>"\'`\\]', q):
        die('the query %r holds a space, quote, backslash or angle bracket; pass it URL-encoded' % q)
    js = "%s: %s %s */ history.replaceState(0, '', %s);" % (MARK, scene, tag, json.dumps('?' + q))
    js += hits_redirect(scene, '%s__ab_%s' % (scene, tag))
    if fx is not None:
        js += ' window.ACP_FX = %s;' % json.dumps(fx, separators=(', ', ': ')).replace('</', '<\\/')
    return '<script>%s</script>' % js


def registry_alias(scene, variant, remove=False):
    """the variant's entries in the audio registries: the scene's own (or, with remove, none). A registry is touched only when
    it round-trips byte for byte through json (indent 1), so nothing else in it can change; it is read and written at once."""
    done = []
    for name in REGISTRIES:
        p = os.path.join(AUDIO, name)
        try:
            raw = open(p, 'rb').read()
            d = json.loads(raw)
        except (OSError, ValueError) as e:
            print('ab_variant: NOTE %s not read (%s); left alone' % (name, e)); continue
        nl = b'\n' if raw.endswith(b'\n') else b''
        if (json.dumps(d, indent=1) + nl.decode()).encode() != raw:
            print('ab_variant: NOTE %s does not round-trip through json; left alone (add "%s" by hand if %s has an entry)' % (name, variant, scene))
            continue
        if remove:
            if variant not in d:
                continue
            d.pop(variant)
        else:
            if scene not in d or d.get(variant) == d[scene]:
                continue
            d[variant] = d[scene]
        with open(p, 'wb') as f:
            f.write((json.dumps(d, indent=1) + nl.decode()).encode())
        done.append(name)
    sheet, vsheet = os.path.join(AUDIO, 'finish', scene + '.json'), os.path.join(AUDIO, 'finish', variant + '.json')
    if remove:
        if os.path.exists(vsheet):
            os.remove(vsheet); done.append('finish/%s.json' % variant)
    elif os.path.exists(sheet):
        shutil.copyfile(sheet, vsheet); done.append('finish/%s.json (copy of finish/%s.json)' % (variant, scene))
    return done


def write(a):
    scene, tag = a.scene, a.tag
    if not re.fullmatch(r'[a-z0-9_]+', scene) or '__ab_' in scene:
        die('SCENE: the scene name under videos/web/scenes (letters, digits, _), not a variant')
    if not re.fullmatch(r'[a-z0-9_]{1,24}', tag):
        die('TAG: [a-z0-9_]{1,24} (songs.py maps <scene>__ab_<tag> by that rule)')
    src = os.path.join(SCENES, scene + '.html')
    if not os.path.isfile(src):
        die('no scene page %s' % os.path.relpath(src, WEB))
    fx = None
    if a.fx not in (None, ''):
        try:
            fx = json.loads(a.fx)
        except ValueError as e:
            die('ACP_FX is not JSON (%s)' % e)
        if not isinstance(fx, dict):
            die('ACP_FX must be a JSON object')
    html = open(src, encoding='utf-8').read()
    if MARK in html:
        die('%s already carries an A/B line' % os.path.relpath(src, WEB))
    m = re.search(r'^([ \t]*)<script\b[^>]*type=["\']module["\']', html, re.M)
    if not m:
        die('%s has no <script type="module"> to put the line before' % os.path.relpath(src, WEB))
    line = page_line(scene, tag, a.query, fx)
    out = html[:m.start()] + m.group(1) + line + '\n' + html[m.start():]
    variant = '%s__ab_%s' % (scene, tag)
    dst = os.path.join(SCENES, variant + '.html')
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(out)
    print('wrote %s' % os.path.relpath(dst, os.path.dirname(os.path.dirname(WEB))))
    print('  ' + line)
    if not a.no_audio_alias:
        for d in registry_alias(scene, variant):
            print('  audio alias: %s' % d)
    return variant


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('scene', nargs='?'); ap.add_argument('tag', nargs='?'); ap.add_argument('query', nargs='?')
    ap.add_argument('fx', nargs='?', help='window.ACP_FX as a JSON object (optional)')
    ap.add_argument('--rm', nargs='+', metavar='SCENE__ab_TAG')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--no-audio-alias', action='store_true', help='do not give the variant its scene\'s audio registry entries')
    a = ap.parse_args()
    if a.list:
        for f in sorted(os.listdir(SCENES)):
            if f.endswith('.html') and NAME.fullmatch(f[:-5]):
                ln = next((l.strip() for l in open(os.path.join(SCENES, f), encoding='utf-8') if MARK in l), '(no A/B line)')
                print('%-36s %s' % (f[:-5], ln))
        return
    if a.rm:
        for v in a.rm:
            v = v.replace('.html', '')
            m = NAME.fullmatch(v)
            if not m:
                die('%s is not a <scene>__ab_<tag> name' % v)
            p = os.path.join(SCENES, v + '.html')
            if os.path.exists(p):
                os.remove(p); print('removed scenes/%s.html' % v)
            for d in registry_alias(m.group(1), v, remove=True):
                print('  removed audio alias: %s' % d)
        return
    if a.scene is None or a.tag is None or a.query is None:
        ap.error('SCENE TAG "QUERY" [ACP_FX JSON]  (QUERY may be "")')
    write(a)


if __name__ == '__main__':
    main()
