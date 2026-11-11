#!/usr/bin/env python3
"""video_find.py: find a SHOT in public-access film and cut it from the ORIGINAL by reading only the bytes it needs, with a provenance file (ARCHIVE SCENES c2).

    python3 videos/tools/video_find.py search "Boulder Dam construction" [--n 8] [--years 1930-1945] [--budget 150]   # film items across archives, merged and ranked; --years filters
    python3 videos/tools/video_find.py files ID                                              # originals and derivatives: format, size, length, WxH
    python3 videos/tools/video_find.py shots ID [--file DERIV] [--sheet out.jpg]             # shot list by scene cut from the quick-look copy, one keyframe each
    python3 videos/tools/video_find.py locate ID "workmen riding down in a skip" [--top 6] [--sheet out.jpg] [--file DERIV]
                                                                                             # CLIP ranks every second of the quick-look copy against your words; windows + a sheet
    python3 videos/tools/video_find.py cut ID --from 621.0 --to 625.5 -o OUT.mp4 [--pad 0.3] [--no-align] [--audio-only]
                                                                                             # times are on the quick-look copy's clock; the cut is from the original, on ITS clock
    python3 videos/tools/video_find.py cutfile URL --from 621 --to 625 -o OUT.mp4              # any http(s) video URL, own clock; mp4/mov are seeked through tools/rangeproxy.py (reads tens of MB of a GB file)
    python3 videos/tools/video_find.py --selftest

How it works and why
- The quick-look copy (IA's 512kb mp4, 320x240) is downloaded once (cap 250 MB, cached under out/.video_find_cache/, delete it when done) and used only to FIND.
- cut() then reads only the needed bytes of the original by HTTP Range: for MPEG program/transport streams the offset of a moment is found by probing (engine/archive/fed/rangecut.py).
  The quick-look copy's clock differs from the original's (0.6-0.7 s on The Story of Hoover Dam): the two audio tracks are cross-correlated over the window and the offset is recorded.
- OUT.mp4 is deinterlaced (yadif) and put to square pixels; OUT.json records the item, rights word for word (item, mirror and NARA origin), original format, byte range, window on both clocks,
  processing and a credit line. Silent film: the source frame rate is recorded so a cadence fix (Jackson) can be applied downstream.
Never writes tracked files. Delete the cache and the clip once you have your sheet (disk is tight).
"""
import argparse, hashlib, json, os, re, subprocess, sys, tempfile, time, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'engine'))
import numpy as np
from archive import fed
from archive.fed import net, measure, rangecut, nara, rights as R, sheet as fsheet
ROOT = os.path.abspath(os.path.join(HERE, '..'))
CACHE = os.path.join(ROOT, 'out', '.video_find_cache')

def log(*a): print(*a, flush=True)

def files(ident):
    it = {'id': ident, 'kind': 'film', 'sources': ['Internet Archive'], 'source': 'Internet Archive', 'extra': {}, 'master': {}}
    measure.ia_film(it); return it

def deriv_of(it, name=None):
    rows = [r for r in it['extra']['files'] if r['w'] and r['source'] != 'original']
    if name: return next(r for r in it['extra']['files'] if r['name'] == name)
    rows = sorted(rows, key=lambda r: (not r['name'].endswith('.mp4'), r['bytes']))
    if not rows: rows = [r for r in it['extra']['files'] if r['w']]
    return rows[0]

def download(url, max_mb=250):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest()[:10] + '_' + os.path.basename(urllib.parse.urlparse(url).path))
    if os.path.exists(p): return p
    for k in range(5):
        try:
            with net.S.get(url, stream=True, timeout=60) as r:
                r.raise_for_status(); n = int(r.headers.get('Content-Length') or 0)
                if n > max_mb * 1e6: raise SystemExit('%.0f MB > cap %d MB: choose a smaller derivative with --file' % (n / 1e6, max_mb))
                with open(p + '.part', 'wb') as f:
                    for b in r.iter_content(1 << 20): f.write(b)
            os.replace(p + '.part', p); return p
        except SystemExit: raise
        except Exception as e:
            log('download retry', k, type(e).__name__); time.sleep(2 * (k + 1))
    raise SystemExit('download failed')

def frames(path, fps=1.0, w=224):
    """Stream frames at fps as (t, PIL image): ffmpeg to raw rgb in chunks."""
    from PIL import Image
    i = rangecut.info(path); H = int(round(i['h'] * w / i['w'] / 2) * 2) if i.get('w') else 168
    p = subprocess.Popen([rangecut.ffmpeg(), '-v', 'error', '-i', path, '-vf', 'fps=%g,scale=%d:%d' % (fps, w, H), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    n = w * H * 3; k = 0
    while True:
        b = p.stdout.read(n)
        if len(b) < n: break
        yield k / fps, Image.frombytes('RGB', (w, H), b); k += 1
    p.wait()

def embed(path, fps=1.0):
    """CLIP embedding of every frame at fps (cached as npz beside the derivative)."""
    cp = path + '.clip_%g.npz' % fps
    if os.path.exists(cp):
        d = np.load(cp); return d['t'], d['e'], d['thumbs'] if 'thumbs' in d else None
    from archive.clipx import Vision
    vis = Vision(threads=4); ts, es, th = [], [], []; buf, bt = [], []
    def flush():
        if buf: es.append(vis(buf)); ts.extend(bt); buf.clear(); bt.clear()
    for t, im in frames(path, fps):
        buf.append(im); bt.append(t); small = im.copy(); small.thumbnail((160, 120)); th.append(np.asarray(small))
        if len(buf) >= 16: flush()
        if int(t) % 120 == 0 and t: log('  embedded to %d s' % t)
    flush()
    H = min(a.shape[0] for a in th); Wd = min(a.shape[1] for a in th)
    T, E = np.array(ts), np.concatenate(es)
    np.savez_compressed(cp, t=T, e=E, thumbs=np.stack([a[:H, :Wd] for a in th])); d = np.load(cp)
    return d['t'], d['e'], d['thumbs']

def shots(t, e, thr=0.86):
    """Shot starts where consecutive frame embeddings drop below thr (cosine). Returns [(t0, t1)]."""
    sim = (e[1:] * e[:-1]).sum(1); cuts = [0] + [i + 1 for i in np.where(sim < thr)[0]] + [len(t)]
    return [(float(t[a]), float(t[b - 1] + 1)) for a, b in zip(cuts[:-1], cuts[1:])]

def make_sheet(path, picks, thumbs, t, out, title):
    from PIL import Image, ImageDraw
    cols = 6; tw, th_ = thumbs.shape[2], thumbs.shape[1]; rows = (len(picks) + cols - 1) // cols
    sh = Image.new('RGB', (cols * (tw + 4), 22 + rows * (th_ + 18)), (18, 18, 18)); d = ImageDraw.Draw(sh); d.text((6, 5), title, fill=(255, 255, 255), font=fsheet.font(12, True))
    for k, (ti, label) in enumerate(picks):
        x = (k % cols) * (tw + 4); y = 22 + (k // cols) * (th_ + 18)
        sh.paste(Image.fromarray(thumbs[ti]), (x, y + 16)); d.text((x + 2, y + 1), label, fill=(255, 220, 120), font=fsheet.font(10))
    sh.save(out, quality=86); return sh.size

def cmd_locate(a):
    it = files(a.id); dv = deriv_of(it, a.file); log('quick-look copy: %s %s %sx%s %.0f MB' % (dv['name'], dv['format'], dv['w'], dv['h'], dv['bytes'] / 1e6))
    path = download(dv['url']); t, e, th = embed(path, a.fps)
    from archive.clipx import Text
    q = Text(threads=4)(['a photograph of ' + a.query])[0]; sc = e @ q
    base = np.median(sc); order = np.argsort(-sc); picks = []; used = []
    for i in order:
        if any(abs(t[i] - u) < a.sep for u in used): continue
        used.append(float(t[i])); picks.append(i)
        if len(picks) >= a.top: break
    res = []
    for i in picks:
        lo = i
        while lo > 0 and sc[lo - 1] > base + 0.6 * (sc[i] - base): lo -= 1
        hi = i
        while hi < len(sc) - 1 and sc[hi + 1] > base + 0.6 * (sc[i] - base): hi += 1
        res.append({'t': float(t[i]), 'window_derivative_s': [float(t[lo]), float(t[hi] + 1 / a.fps)], 'clip_score': round(float(sc[i]), 4), 'over_median': round(float(sc[i] - base), 4)})
    for r in res: log('%7.1f s  window %7.1f-%7.1f  score %.3f (+%.3f over the item median)' % (r['t'], *r['window_derivative_s'], r['clip_score'], r['over_median']))
    if a.sheet:
        pk = []
        for r in res:
            ti = int(np.argmin(np.abs(t - r['t']))); pk.append((ti, '%d:%04.1f  +%.3f' % (r['t'] // 60, r['t'] % 60, r['over_median'])))
        log('sheet', make_sheet(path, pk, th, t, a.sheet, '%s  |  "%s"  |  best CLIP matches on the quick-look copy (derivative clock)' % (a.id, a.query)))
    if a.json: json.dump({'item': a.id, 'query': a.query, 'derivative': dv['name'], 'matches': res}, open(a.json, 'w'), indent=1)

def cmd_shots(a):
    it = files(a.id); dv = deriv_of(it, a.file); path = download(dv['url']); t, e, th = embed(path, a.fps)
    sl = shots(t, e, a.thr); log('%d shots at CLIP-similarity < %.2f' % (len(sl), a.thr))
    for k, (s0, s1) in enumerate(sl[:400]): print('%3d  %7.1f - %7.1f  (%.1f s)' % (k, s0, s1, s1 - s0))
    if a.sheet:
        pk = [(int(np.argmin(np.abs(t - (s0 + s1) / 2))), '%d:%04.1f' % (s0 // 60, s0 % 60)) for s0, s1 in sl[:240]]
        log('sheet', make_sheet(path, pk, th, t, a.sheet, '%s shot list (%d shots, keyframe = middle)' % (a.id, len(sl))))

def ia_provenance(ident):
    meta = net.jget('https://archive.org/metadata/' + urllib.parse.quote(ident))
    m = meta.get('metadata', {}); g = lambda k: ' '.join(m[k]) if isinstance(m.get(k), list) else (m.get(k) or '')
    sts = []
    for k in ('licenseurl', 'rights', 'possible-copyright-status'):
        if g(k): sts.append(R.st(g(k), 'mirror:Internet Archive', url='https://archive.org/details/' + ident))
    return m, sts

def cmd_cut(a):
    it = files(a.id); dv = deriv_of(it, a.file); ex = it['extra']['files']
    org = [r for r in ex if r['source'] == 'original' and r['w']] or [r for r in ex if r['source'] == 'original']
    org = sorted(org, key=lambda r: -r['bytes'])
    if not org: raise SystemExit('no original file in the item: only derivatives exist (%s)' % ', '.join(r['name'] for r in ex[:4]))
    o = org[0]; kind = rangecut.kind_of(o['name'], o['format']); log('original: %s %s %.0f MB %s s, container class: %s' % (o['name'], o['format'], o['bytes'] / 1e6, o['length'], kind))
    t0, t1 = a.t0, a.t1; shift = 0.0; ratio = None; how = 'times given on the original\'s own clock (--no-align)'
    if not a.no_align:
        dpath = download(dv['url']); tmp = tempfile.mkdtemp(); A = os.path.join(tmp, 'o.wav'); B = os.path.join(tmp, 'd.wav')
        w0 = max(0.0, a.t0 - 4.0); w1 = a.t1 + 4.0
        try:
            rangecut.cut(o['url'], o['bytes'], o['length'], w0, w1, A, kind=kind, video=False, log=log, max_whole_mb=a.max_whole_mb)
            subprocess.run([rangecut.ffmpeg(), '-v', 'error', '-y', '-ss', '%.3f' % w0, '-t', '%.3f' % (w1 - w0), '-i', dpath, '-vn', '-ac', '1', '-ar', '48000', B], check=True)
            shift, ratio = rangecut.align(A, B, maxlag=4.0)
            how = 'audio cross-correlation of the original and the quick-look copy over %.0f-%.0f s (peak %.1fx the median)' % (w0, w1, ratio)
            if ratio < 6: how += ' - WEAK, offset not trusted; check by eye'
            if ratio >= 6 or a.force_shift: t0, t1 = a.t0 + shift, a.t1 + shift
            log('offset original - derivative = %+.3f s (%s)' % (shift, how))
        except SystemExit: raise
        except Exception as e: how = 'alignment failed (%s): times used as given' % type(e).__name__; log(how)
    prov = rangecut.cut(o['url'], o['bytes'], o['length'], t0, t1, a.o, kind=kind, pad=a.pad, video=not a.audio_only, audio=True, log=log, max_whole_mb=a.max_whole_mb, proxy=not a.no_proxy)
    m, sts = ia_provenance(a.id)
    naid = re.search(r'gov\.archives\.arc\.(\d+)', a.id)
    origin = None
    if naid:
        fake = {'naid': naid.group(1), 'statements': [], 'flags': [], 'extra': {}, 'title': '', 'date': ''}
        nara.enrich(fake); origin = fake['statements'][:1] and fake['statements'][0]['text']; nrec = fake['extra'].get('nara')
        sts = fake['statements'] + sts
    else: nrec = None
    rj = R.judge(sts)
    cr = ', '.join(m['creator']) if isinstance(m.get('creator'), list) else (m.get('creator') or '')
    prov.update({'item': a.id, 'page': 'https://archive.org/details/' + a.id, 'title': m.get('title'), 'creator': cr, 'date': m.get('date'), 'description': (m.get('description') or '')[:400] if isinstance(m.get('description'), str) else '',
                 'origin_record': nrec, 'rights_statements_verbatim': sts, 'rights_class': rj['class'], 'rights_class_why': rj['why'], 'rights_flags': rj['flags'],
                 'original_file': {k: o[k] for k in ('name', 'format', 'bytes', 'w', 'h', 'length')}, 'quicklook_file': {k: dv[k] for k in ('name', 'format', 'bytes', 'w', 'h')},
                 'window_quicklook_clock_s': [a.t0, a.t1], 'clock_offset_original_minus_quicklook_s': shift, 'clock_offset_method': how,
                 'source_frame_rate': (prov.get('source_format') or {}).get('fps'), 'cadence_note': 'source rate is a video-transfer rate; silent-era film shot at 16-18 fps needs a speed correction downstream (Jackson), not done here',
                 'output': os.path.abspath(a.o),
                 'credit': '"%s", %s%s (%s). %s' % (m.get('title') or a.id, cr or 'creator not stated', ', ' + str(m.get('date')) if m.get('date') else '', 'Internet Archive %s' % a.id,
                          'Rights read from: ' + '; '.join('%s: %s' % (s['from'], s['text']) for s in sts if s['text'])[:300]),
                 'note': 'The rights class is a reading of the words, not legal advice.'})
    json.dump(prov, open(a.o + '.json', 'w'), indent=1, default=str); log('wrote', a.o, 'and', a.o + '.json'); log('bytes read %.1f MB of %.0f MB (%.3f%%)' % (prov['bytes_read'] / 1e6, o['bytes'] / 1e6, 100 * prov['fraction_of_file']))

def cmd_cutfile(a):
    """Cut a window from ANY http(s) video URL (mp4/mov/mkv/ps/ts) by range reads, times on that file's own clock. Writes OUT.json with the URL and bytes read; rights are NOT judged here."""
    import requests
    from rangeproxy import RangeProxy
    kind = rangecut.kind_of(urllib.parse.urlparse(a.url).path)
    with RangeProxy(a.url) as px: size = px.size
    length = (a.t1 + 600)
    prov = rangecut.cut(a.url, size, length, a.t0, a.t1, a.o, kind=kind, pad=a.pad, video=not a.audio_only, audio=True, log=log)
    prov.update({'url': a.url, 'output': os.path.abspath(a.o), 'note': 'cutfile: provenance is the URL only; read the source\'s rights yourself before use.'})
    json.dump(prov, open(a.o + '.json', 'w'), indent=1, default=str); log('wrote', a.o, '; bytes read %.1f MB of %.0f MB' % (prov['bytes_read'] / 1e6, size / 1e6))

def cmd_search(a):
    from archive.fed import model
    years = model.parse_years(a.years) if a.years else None
    res = fed.search(a.q, kinds=['film'], n=a.n, top=a.top, progress=log, sources=a.sources.split(',') if a.sources else None, do_used=False, years=years, budget=a.budget)
    if not res['items']: log('no film items (%s); per source: %s' % (res.get('filtered'), {k: v.get('state') or v.get('n') for k, v in res['per_source'].items() if v.get('state') != 'not asked'}))
    for i, it in enumerate(res['items'][:a.top]):
        m = it['master']; print('%2d %5.1f %-30s %-10s %-12s %s  [%s]' % (i + 1, it['score'], ' + '.join(it['sources'])[:30], it['rights']['class'], ('%sx%s' % (m['w'], m['h'])) if m.get('w') else '?', it['title'][:60], it['id']))
    if a.sheet: log('sheet', fsheet.make(res, a.sheet, top=a.top))

def selftest():
    import numpy as np, struct
    t = np.arange(0, 30, 1.0); e = np.zeros((30, 4), np.float32); e[:15, 0] = 1; e[15:, 1] = 1
    assert shots(t, e) == [(0.0, 15.0), (15.0, 30.0)], shots(t, e)
    assert rangecut.kind_of('x.mpeg', 'MPEG2') == 'ps' and rangecut.kind_of('x.mp4') == 'indexed' and rangecut.kind_of('x.wav') == 'pcm'
    with tempfile.TemporaryDirectory() as td:
        import soundfile as sf
        x = np.random.RandomState(1).randn(48000 * 10) * .1; a_ = os.path.join(td, 'a.wav'); b_ = os.path.join(td, 'b.wav')
        sf.write(a_, x[24000:24000 + 48000 * 6], 48000); sf.write(b_, x[0:48000 * 6], 48000)
        off, r = rangecut.align(a_, b_, maxlag=3.0); assert abs(off + 0.5) < 0.01 and r > 6, (off, r)
    print('selftest ok')

def main():
    if '--selftest' in sys.argv: return selftest()
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); sp = ap.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('search'); s.add_argument('q'); s.add_argument('--n', type=int, default=8); s.add_argument('--top', type=int, default=12); s.add_argument('--sources'); s.add_argument('--sheet')
    s.add_argument('--years', nargs='+', help='1930 1945 | 1930-1945 | 1930s: a filter'); s.add_argument('--budget', type=float, default=150, help='seconds per source, back-off included')
    f = sp.add_parser('files'); f.add_argument('id')
    h = sp.add_parser('shots'); h.add_argument('id'); h.add_argument('--file'); h.add_argument('--sheet'); h.add_argument('--fps', type=float, default=1.0); h.add_argument('--thr', type=float, default=0.86)
    l = sp.add_parser('locate'); l.add_argument('id'); l.add_argument('query'); l.add_argument('--file'); l.add_argument('--top', type=int, default=6); l.add_argument('--sep', type=float, default=20.0); l.add_argument('--fps', type=float, default=1.0); l.add_argument('--sheet'); l.add_argument('--json')
    c = sp.add_parser('cut'); c.add_argument('id'); c.add_argument('--file'); c.add_argument('--from', dest='t0', type=float, required=True); c.add_argument('--to', dest='t1', type=float, required=True); c.add_argument('-o', required=True)
    c.add_argument('--pad', type=float, default=0.0); c.add_argument('--no-align', action='store_true'); c.add_argument('--force-shift', action='store_true'); c.add_argument('--audio-only', action='store_true'); c.add_argument('--max-whole-mb', type=int, default=120); c.add_argument('--no-proxy', action='store_true', help='indexed containers (mp4/mov/mkv): download the whole file instead of seeking through the local range window')
    u = sp.add_parser('cutfile'); u.add_argument('url'); u.add_argument('--from', dest='t0', type=float, required=True); u.add_argument('--to', dest='t1', type=float, required=True); u.add_argument('-o', required=True); u.add_argument('--pad', type=float, default=0.0); u.add_argument('--audio-only', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'search': cmd_search(a)
    elif a.cmd == 'files':
        it = files(a.id)
        for r in it['extra']['files']: print('%-9s %-22s %9.1f MB %5sx%-5s len=%s  %s' % (r['source'], r['format'], r['bytes'] / 1e6, r['w'] or '-', r['h'] or '-', r['length'], r['name']))
    elif a.cmd == 'shots': cmd_shots(a)
    elif a.cmd == 'locate': cmd_locate(a)
    elif a.cmd == 'cutfile': cmd_cutfile(a)
    else: cmd_cut(a)

if __name__ == '__main__':
    main()
