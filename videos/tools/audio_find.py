#!/usr/bin/env python3
"""audio_find.py: find real recorded voices and sound in the public domain, locate a phrase in them, and cut a clip with its provenance
(TOOLING c12, 2026-10-01). Backend: the Internet Archive (which also mirrors NASA, Library of Congress and U.S. government audio and film).

Asked for by ACCELERATE c10 ("no usable public-domain recording of Kennedy or the Apollo launch count") and relevant to any piece that wants a
real speaker, crowd, launch count or broadcast under its picture. It reports; it never decides what is usable.

    python3 videos/tools/audio_find.py search "kennedy rice stadium moon" [--media audio|movies] [--rows 15] [--pd]
    python3 videos/tools/audio_find.py files ID                       # the audio/video files in an item, size and length
    python3 videos/tools/audio_find.py locate ID --file NAME --phrase "we choose to go to the moon" [--from S --to S]
    python3 videos/tools/audio_find.py clip ID --file NAME --from 12.3 --to 19.8 -o /tmp/x/clip.wav [--pad 0.15]
    python3 videos/tools/audio_find.py clip ID --file DERIV --from S --to S --original -o OUT.wav   # c2: the same phrase cut from the ORIGINAL stream (AC-3 / PCM / MP3) by byte range
    python3 videos/tools/audio_find.py --selftest                     # offline: fuzzy matcher, rights reading, ffmpeg cut, sidecar

What each does
- search: one row per item: id, date, creator, title, downloads, RIGHTS (the item's licenseurl and rights field verbatim) and a class:
  PD (public-domain mark / CC0 / "United States Government work" wording), CC (a Creative Commons licence, attribution to carry),
  UNKNOWN (no statement: archive.org's own mirrors of old broadcasts are often this; a person checks the original source before use).
  --pd keeps PD and CC rows. Classification reads the statement only; it is not legal advice and a PD mark on an upload can be wrong.
- files: names, formats, sizes, durations of an item's audio and video files (originals first), with the direct URL.
- locate: transcribes the file (faster-whisper tiny.en by default, word timestamps; only the --from/--to window if given, after
  downloading a derivative; --from/--to limit the transcription, not the download) and lists the best fuzzy matches of the phrase with start/end seconds and the
  matched words. Whisper mishears: the matches are leads, listen before cutting. Transcripts are cached under videos/out/.audio_find_cache/.
- clip: ffmpeg seeks over HTTPS and cuts [from-pad, to+pad] to a 48 kHz mono wav (24-bit; mp3 if -o ends .mp3), a 20 ms fade at both
  ends, and writes OUT.json beside it: item id, url, title, creator, date, rights verbatim, class, window, loudness (integrated LUFS,
  true peak), the bandwidth (99% rolloff, Hz), the noise floor in dBFS, and a CREDIT line to
  paste in the post copy. Never overwrites without --force.
- clip --original (c2): `locate` still transcribes the quick-look copy, but the cut is taken from the item's ORIGINAL file by HTTP Range (only the needed bytes; MPEG-PS/TS, MP3, PCM),
  the clock offset between the two is measured by cross-correlating their audio (0.6-0.7 s on The Story of Hoover Dam) and recorded, and the sidecar sets the two cuts'
  noise floor and bandwidth side by side as facts; which one to use is decided by listening to both. Times given are on the quick-look copy's clock. Needs engine/archive/fed (same repo).
Network etiquette: one request every 1 s at most, metadata cached. The files themselves are downloaded whole (the bundled ffmpeg cannot read https
through the proxy) into out/.audio_find_cache/dl/ and refused above 300 MB: take a derivative (mp3, ogg, 512kb mp4) from `files`, and delete the cache after.
Python API: search(q, media, rows) -> [row]; files(id) -> ([file], metadata); locate(id, name, phrase, t0, t1) -> ([match], words); clip(id, name, t0, t1, out) -> sidecar dict;
rights_class(licenseurl, rights, extra) -> 'PD'|'CC'|'UNKNOWN'; fuzzy_find(words, phrase) -> [match].
Exit: 0 ok, 1 failure, 2 usage. Never writes tracked files.
"""
import argparse, difflib, hashlib, json, os, re, subprocess, sys, tempfile, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CACHE = os.path.join(ROOT, 'out', '.audio_find_cache')
UA = {'User-Agent': 'acp-agitprop-audio-find/1 (research)'}
_last = [0.0]


def ffmpeg():
    import shutil
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg') or 'ffmpeg'


def _get(url, tries=3):
    for k in range(tries):
        dt = time.time() - _last[0]
        if dt < 1.0:
            time.sleep(1.0 - dt)
        _last[0] = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read()
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(2 * (k + 1))


def _cached_json(url):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest() + '.json')
    if os.path.exists(p):
        return json.load(open(p))
    d = json.loads(_get(url))
    json.dump(d, open(p, 'w'))
    return d


def rights_class(licenseurl='', rights='', extra=''):
    s = ' '.join(str(x or '') for x in (licenseurl, rights, extra)).lower()
    if not s.strip():
        return 'UNKNOWN'
    if 'publicdomain' in s or 'public domain' in s or 'cc0' in s or 'government work' in s or 'no known copyright' in s:
        return 'PD'
    if 'creativecommons.org/licenses' in s:
        return 'CC'
    return 'UNKNOWN'


def search(q, media='audio', rows=15, collection=None, sort='downloads desc'):
    """c4: `collection` scopes the query (Lucene `collection:X AND (...)`; plain text sorts by downloads and buries period material); `sort` any
    archive.org field ('date asc', 'downloads desc'). Period sound sits inside films: a collection of newsreels needs media='movies'."""
    if collection:
        q = 'collection:%s AND (%s)' % (collection, q)
    f = ['identifier', 'title', 'creator', 'date', 'downloads', 'licenseurl', 'rights', 'collection']
    url = ('https://archive.org/advancedsearch.php?q=' + urllib.parse.quote('(%s) AND mediatype:%s' % (q, media)) +
           ''.join('&fl%5B%5D=' + x for x in f) + '&rows=%d&sort%%5B%%5D=%s&output=json' % (rows, urllib.parse.quote_plus(sort)))
    out = []
    for d in _cached_json(url)['response']['docs']:
        col = d.get('collection') or []
        col = ','.join(col) if isinstance(col, list) else str(col)
        gov = col if ('nasa' in col.lower() or 'gov' in col.lower()) else ''
        d['rights_class'] = rights_class(d.get('licenseurl'), d.get('rights'), gov)
        d['collection'] = col
        out.append(d)
    return out


def files(item):
    m = _cached_json('https://archive.org/metadata/' + urllib.parse.quote(item))
    res = []
    for f in m.get('files', []):
        n = f['name']
        if not re.search(r'\.(wav|flac|mp3|ogg|oga|m4a|aif|aiff|mp4|ogv|mpeg|mpg|mov|avi|webm|mkv)$', n, re.I) or '_spectrogram' in n:
            continue
        res.append({'name': n, 'format': f.get('format'), 'source': f.get('source'), 'size': int(f.get('size') or 0),
                    'length': f.get('length'), 'url': 'https://archive.org/download/%s/%s' % (item, urllib.parse.quote(n))})
    res.sort(key=lambda r: (r['source'] != 'original', -r['size']))
    return res, m.get('metadata', {})


def _norm(w):
    return re.sub(r"[^a-z0-9']", '', w.lower())


def fuzzy_find(words, phrase, top=5, min_ratio=0.6):
    """words: [{'w','s','e'}]; sliding window of len(phrase)+-1 words, ratio on the normalised text."""
    ph = [_norm(x) for x in phrase.split() if _norm(x)]
    pt = ' '.join(ph)
    ws = [(_norm(w['w']), w) for w in words]
    ws = [(a, w) for a, w in ws if a]
    res = []
    n = len(ph)
    for L in (n - 1, n, n + 1):
        if L < 1:
            continue
        for i in range(0, len(ws) - L + 1):
            t = ' '.join(a for a, _ in ws[i:i + L])
            r = difflib.SequenceMatcher(None, t, pt).ratio()
            if r >= min_ratio:
                res.append({'ratio': round(r, 3), 'start': ws[i][1]['s'], 'end': ws[i + L - 1][1]['e'], 'text': t, 'i': i})
    res.sort(key=lambda m: -m['ratio'])
    keep = []
    for m in res:                                   # drop overlapping windows, keep the best of each
        if all(m['start'] >= k['end'] or m['end'] <= k['start'] for k in keep):
            keep.append(m)
        if len(keep) >= top:
            break
    return keep


def fetch(url, max_mb=300):
    """Local path for url. The bundled ffmpeg segfaults on https through the agent proxy, so the file is downloaded with urllib
    (proxy-aware, resumable cache under out/.audio_find_cache/dl/) and ffmpeg reads the local copy. Refuses above max_mb: pick a
    smaller derivative (mp3/ogg/512kb) from `files`. Delete the cache when done (the clip tool's sidecar keeps the provenance)."""
    if os.path.exists(url):
        return url
    d = os.path.join(CACHE, 'dl')
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, hashlib.md5(url.encode()).hexdigest()[:10] + '_' + os.path.basename(urllib.parse.urlparse(url).path))
    if os.path.exists(p):
        return p
    # c4: archive.org's data nodes reset the first connection through the agent proxy; retry with back-off (the downloads went through on 3-4 tries)
    last = None
    for k in range(5):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                n = int(r.headers.get('Content-Length') or 0)
                if n > max_mb * 1e6:
                    raise SystemExit('%s is %.0f MB (> --max-mb %d): choose a smaller derivative from `files`' % (os.path.basename(p), n / 1e6, max_mb))
                with open(p + '.part', 'wb') as f:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        f.write(b)
            os.replace(p + '.part', p)
            return p
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (k + 1))
    raise SystemExit('download failed after 5 tries: %s' % last)


def _stream_wav(url, t0, t1, out, rate=16000):
    url = fetch(url)
    cmd = [ffmpeg(), '-v', 'error', '-y']
    if t0:
        cmd += ['-ss', '%.3f' % t0]
    cmd += ['-i', url]
    if t1:
        cmd += ['-t', '%.3f' % (t1 - (t0 or 0))]
    cmd += ['-vn', '-ac', '1', '-ar', str(rate), out]
    subprocess.run(cmd, check=True)


def locate(item, name, phrase, t0=0.0, t1=None, model='tiny.en'):
    url = 'https://archive.org/download/%s/%s' % (item, urllib.parse.quote(name))
    key = hashlib.md5(('%s|%s|%s|%s|%s' % (item, name, t0, t1, model)).encode()).hexdigest()
    os.makedirs(CACHE, exist_ok=True)
    cp = os.path.join(CACHE, 'tr_' + key + '.json')
    if os.path.exists(cp):
        words = json.load(open(cp))
    else:
        from faster_whisper import WhisperModel
        with tempfile.TemporaryDirectory() as td:
            wav = os.path.join(td, 'a.wav')
            _stream_wav(url, t0, t1, wav)
            segs, _ = WhisperModel(model, device='cpu', compute_type='int8', cpu_threads=3).transcribe(wav, word_timestamps=True, language='en')
            words = [{'w': w.word.strip(), 's': round(w.start + (t0 or 0), 2), 'e': round(w.end + (t0 or 0), 2)} for sg in segs for w in sg.words]
        json.dump(words, open(cp, 'w'))
    return fuzzy_find(words, phrase), words


def _measure(path):
    """integrated LUFS, true peak, bandwidth (99% rolloff), noise floor (10th percentile of 50 ms frame rms, dBFS): facts about the source."""
    import numpy as np, soundfile as sf
    x, sr = sf.read(path, always_2d=True)
    x = x.mean(1)
    r = subprocess.run([ffmpeg(), '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True)
    lufs = re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr)
    tp = re.findall(r'Peak:\s+(-?[\d.]+) dBFS', r.stderr)
    X = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    fr = np.fft.rfftfreq(len(x), 1 / sr)
    cum = np.cumsum(X); roll = float(fr[int(np.searchsorted(cum, 0.99 * cum[-1]))]) if cum[-1] > 0 else 0.0
    n = int(sr * .05)
    rms = np.sqrt(np.maximum([np.mean(x[i:i + n] ** 2) for i in range(0, max(len(x) - n, 1), n)], 1e-12))
    return {'lufs': float(lufs[-1]) if lufs else None, 'true_peak_db': float(tp[-1]) if tp else None,
            'rolloff99_hz': round(roll), 'noise_floor_db': round(float(20 * np.log10(np.percentile(rms, 10))), 1)}


def clip(item, name, t0, t1, out, pad=0.0, force=False, meta=None, source_url=None):
    if os.path.exists(out) and not force:
        raise SystemExit('refusing to overwrite ' + out + ' (use --force)')
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    url = source_url or 'https://archive.org/download/%s/%s' % (item, urllib.parse.quote(name))
    a, b = max(0.0, t0 - pad), t1 + pad
    url_local = fetch(url)
    fade = 0.02
    codec = ['-c:a', 'libmp3lame', '-q:a', '2'] if out.endswith('.mp3') else ['-c:a', 'pcm_s24le']
    subprocess.run([ffmpeg(), '-v', 'error', '-y', '-ss', '%.3f' % a, '-i', url_local, '-t', '%.3f' % (b - a), '-vn', '-ac', '1', '-ar', '48000',
                    '-af', 'afade=t=in:d=%g,afade=t=out:st=%.3f:d=%g' % (fade, max(0, b - a - fade), fade)] + codec + [out], check=True)
    if meta is None:
        try:
            meta = _cached_json('https://archive.org/metadata/' + urllib.parse.quote(item)).get('metadata', {})
        except Exception:
            meta = {}
    cr = meta.get('creator') or ''
    cr = ', '.join(cr) if isinstance(cr, list) else cr
    rc = rights_class(meta.get('licenseurl'), meta.get('rights'), meta.get('possible-copyright-status'))
    tail = {'PD': 'Public domain as marked.', 'CC': 'Creative Commons: %s.' % meta.get('licenseurl'),
            'UNKNOWN': 'RIGHTS NOT STATED: check the original source before publishing.'}[rc]
    side = {'item': item, 'file': name, 'url': url, 'page': 'https://archive.org/details/' + item, 'title': meta.get('title'), 'creator': cr,
            'date': meta.get('date'), 'licenseurl': meta.get('licenseurl'), 'rights': meta.get('rights'),
            'possible_copyright_status': meta.get('possible-copyright-status'), 'rights_class': rc, 'window': [round(a, 3), round(b, 3)],
            'measure': _measure(out),
            'credit': '"%s", %s (Internet Archive, %s). %s' % (meta.get('title') or item, cr or 'creator not stated', item, tail),
            'note': 'The rights class reads the statement on the item; it is not legal advice and an upload mark can be wrong.'}
    json.dump(side, open(out + '.json', 'w'), indent=1)
    return side


def clip_original(item, name, t0, t1, out, pad=0.0, force=False, align=True, max_whole_mb=120):
    """Cut [t0-pad, t1+pad] (seconds on the clock of the quick-look file `name`) from the item's ORIGINAL by byte range. Returns the sidecar dict (also written to OUT.json)."""
    sys.path.insert(0, os.path.join(ROOT, 'engine'))
    from archive.fed import measure, rangecut
    if os.path.exists(out) and not force:
        raise SystemExit('refusing to overwrite ' + out + ' (use --force)')
    it = {'id': item, 'kind': 'audio', 'sources': ['Internet Archive'], 'source': 'Internet Archive', 'extra': {}, 'master': {}}
    measure.ia_film(it); fl = it['extra']['files']
    orig = sorted([r for r in fl if r['source'] == 'original'], key=lambda r: -r['bytes'])
    if not orig:
        raise SystemExit('item has no original file, only derivatives: ' + ', '.join(r['name'] for r in fl[:4]))
    o = orig[0]; kind = rangecut.kind_of(o['name'], o['format']); length = o['length']
    if not length:
        raise SystemExit('original has no length in the item metadata; cannot place bytes')
    deriv = next(r for r in fl if r['name'] == name)
    shift, ratio, how = 0.0, None, 'not aligned (align=False): times used as given on the original'
    a0, b0 = max(0, t0 - pad), t1 + pad
    dwav = None
    with tempfile.TemporaryDirectory() as td:
        dpath = fetch(deriv['url'])
        w0, w1 = max(0.0, a0 - 4.0), b0 + 4.0
        if align:
            A, B = os.path.join(td, 'o.wav'), os.path.join(td, 'd.wav')
            rangecut.cut(o['url'], o['bytes'], length, w0, w1, A, kind=kind, video=False, max_whole_mb=max_whole_mb)
            subprocess.run([ffmpeg(), '-v', 'error', '-y', '-ss', '%.3f' % w0, '-t', '%.3f' % (w1 - w0), '-i', dpath, '-vn', '-ac', '1', '-ar', '48000', B], check=True)
            shift, ratio = rangecut.align(A, B, maxlag=4.0)
            how = 'audio cross-correlation over %.0f-%.0f s (peak %.1fx the median)%s' % (w0, w1, ratio, '' if ratio >= 6 else ' - WEAK: offset not applied')
            if ratio < 6:
                shift = 0.0
        prov = rangecut.cut(o['url'], o['bytes'], length, a0 + shift, b0 + shift, out, kind=kind, video=False, max_whole_mb=max_whole_mb)
        dwav = os.path.join(td, 'deriv_same_window.wav')
        subprocess.run([ffmpeg(), '-v', 'error', '-y', '-ss', '%.3f' % a0, '-i', dpath, '-t', '%.3f' % (b0 - a0), '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s24le', dwav], check=True)
        dm = _measure(dwav)
    meta = _cached_json('https://archive.org/metadata/' + urllib.parse.quote(item)).get('metadata', {})
    cr = meta.get('creator') or ''
    cr = ', '.join(cr) if isinstance(cr, list) else cr
    rc = rights_class(meta.get('licenseurl'), meta.get('rights'), meta.get('possible-copyright-status'))
    tail = {'PD': 'Public domain as marked.', 'CC': 'Creative Commons: %s.' % meta.get('licenseurl'), 'UNKNOWN': 'RIGHTS NOT STATED: check the original source before publishing.'}[rc]
    om = _measure(out)
    side = {'item': item, 'cut_from': 'ORIGINAL', 'original_file': {k: o[k] for k in ('name', 'format', 'bytes', 'length')}, 'quicklook_file': {k: deriv[k] for k in ('name', 'format', 'bytes')}, 'url': o['url'],
            'page': 'https://archive.org/details/' + item, 'title': meta.get('title'), 'creator': cr, 'date': meta.get('date'), 'licenseurl': meta.get('licenseurl'), 'rights': meta.get('rights'),
            'possible_copyright_status': meta.get('possible-copyright-status'), 'rights_class': rc, 'window_quicklook_clock_s': [round(a0, 3), round(b0, 3)], 'window_original_s': prov['window_original_s'],
            'clock_offset_original_minus_quicklook_s': shift, 'clock_offset_method': how, 'range': prov['range'], 'bytes_read': prov['bytes_read'], 'fraction_of_file': prov['fraction_of_file'],
            'seek_method': prov['seek_method'], 'source_format': prov.get('source_format'), 'measure': om, 'measure_quicklook_same_window': dm,
            'side_by_side': {'noise_floor_db': [dm['noise_floor_db'], om['noise_floor_db']], 'rolloff99_hz': [dm.get('rolloff99_hz'), om.get('rolloff99_hz')],
                     'meaning': '[quick-look, original]'},
            'credit': '"%s", %s (Internet Archive, %s). %s' % (meta.get('title') or item, cr or 'creator not stated', item, tail),
            'note': 'The rights class reads the statement on the item; it is not legal advice and an upload mark can be wrong. Measured, not listened to.'}
    json.dump(side, open(out + '.json', 'w'), indent=1, default=str)
    return side


def selftest():
    import numpy as np, soundfile as sf
    assert rights_class('http://creativecommons.org/licenses/publicdomain/') == 'PD'
    assert rights_class('https://creativecommons.org/licenses/by/4.0/') == 'CC'
    assert rights_class('', '', '') == 'UNKNOWN'
    assert rights_class('', 'United States Government work') == 'PD'
    words = [{'w': w, 's': i * .4, 'e': i * .4 + .35} for i, w in enumerate(
        "and so my fellow Americans ask not what your country can do for you ask what you can do for your country".split())]
    m = fuzzy_find(words, 'Ask not what your country can do for you')
    assert m and m[0]['ratio'] > .95 and abs(m[0]['start'] - 5 * .4) < 1e-6, m
    m2 = fuzzy_find(words, 'ask not what yer countree kin do for ya')
    assert m2 and m2[0]['ratio'] > .7
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, 'src.wav')
        t = np.arange(48000 * 4) / 48000
        sf.write(src, 0.3 * np.sin(2 * np.pi * 800 * t) * (1 + np.sin(2 * np.pi * 3 * t)) / 2, 48000)
        out = os.path.join(td, 'c.wav')
        s = clip('local', 'src.wav', 1.0, 2.5, out, pad=.1, meta={'title': 'T', 'creator': 'C', 'licenseurl': 'http://creativecommons.org/publicdomain/zero/1.0/'},
                 source_url=src)
        x, sr = sf.read(out)
        assert sr == 48000 and abs(len(x) / sr - 1.7) < .03, len(x) / sr
        assert s['rights_class'] == 'PD' and s['measure']['lufs'] is not None and os.path.exists(out + '.json')
        try:
            clip('local', 'src.wav', 1.0, 2.0, out, source_url=src)
            raise AssertionError('overwrote')
        except SystemExit:
            pass
    print('selftest ok')


def main():
    if '--selftest' in sys.argv:
        return selftest()
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sp = ap.add_subparsers(dest='cmd', required=True)
    a = sp.add_parser('search'); a.add_argument('q'); a.add_argument('--media', default='audio'); a.add_argument('--rows', type=int, default=15); a.add_argument('--pd', action='store_true'); a.add_argument('--collection'); a.add_argument('--sort', default='downloads desc')
    b = sp.add_parser('files'); b.add_argument('id')
    c = sp.add_parser('locate'); c.add_argument('id'); c.add_argument('--file', required=True); c.add_argument('--phrase', required=True)
    c.add_argument('--from', dest='t0', type=float, default=0.0); c.add_argument('--to', dest='t1', type=float); c.add_argument('--model', default='tiny.en')
    d = sp.add_parser('clip'); d.add_argument('id'); d.add_argument('--file', required=True); d.add_argument('--from', dest='t0', type=float, required=True)
    d.add_argument('--to', dest='t1', type=float, required=True); d.add_argument('-o', required=True); d.add_argument('--pad', type=float, default=0.0); d.add_argument('--force', action='store_true'); d.add_argument('--original', action='store_true'); d.add_argument('--no-align', action='store_true')
    n = ap.parse_args()
    if n.cmd == 'search':
        for r in search(n.q, ('movies' if n.collection and n.media == 'audio' and 'newsreel' in n.collection else n.media), n.rows, n.collection, n.sort):
            if n.pd and r['rights_class'] == 'UNKNOWN':
                continue
            print('%-8s %-10s %-26s %-60s dl=%s\n    rights: %s | %s\n    id: %s' % (r['rights_class'], str(r.get('date', ''))[:10], str(r.get('creator', ''))[:26],
                  str(r.get('title', ''))[:60], r.get('downloads'), r.get('licenseurl') or '-', r.get('rights') or '-', r['identifier']))
    elif n.cmd == 'files':
        fs, meta = files(n.id)
        print('%s | %s | %s | rights: %s %s' % (meta.get('title'), meta.get('creator'), meta.get('date'), meta.get('licenseurl'), meta.get('rights') or ''))
        for f in fs:
            print('%-9s %-22s %9.1f MB len=%s  %s' % (f['source'], f['format'], f['size'] / 1e6, f['length'], f['name']))
    elif n.cmd == 'locate':
        m, words = locate(n.id, n.file, n.phrase, n.t0, n.t1, n.model)
        print('%d words transcribed' % len(words))
        for k in m:
            print('%.2f  %7.2f - %7.2f  "%s"' % (k['ratio'], k['start'], k['end'], k['text']))
        if not m:
            print('no match above 0.6')
    else:
        print(json.dumps(clip_original(n.id, n.file, n.t0, n.t1, n.o, n.pad, n.force, align=not n.no_align) if n.original else clip(n.id, n.file, n.t0, n.t1, n.o, n.pad, n.force), indent=1))


if __name__ == '__main__':
    main()
