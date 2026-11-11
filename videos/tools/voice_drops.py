#!/usr/bin/env python3
"""voice_drops.py (VOICE c5): the route from the Party's own media to a voice drop a piece can place.

A drop is a real person (the Chairman, a chapter member, a speaker on an Infrared stream) saying one sentence that a piece needs said
in a voice rather than set in type. This tool fetches the source by link, indexes it, cuts the sentence on its own breaths, checks the
words against what we mean to quote, grabs a frame of the speaker, and writes the clip with a sidecar that engine/voice/found.py reads
(found.load) and that hits.json carries (voices.found_items). The media is deleted after; the index and the clip stay.

    python3 videos/tools/voice_drops.py fetch URL --src wx                 # audio only (yt-dlp: Bilibili, archive.org, TikTok...) -> cache/wx.m4a + wx.info.json
    python3 videos/tools/voice_drops.py index wx [--model tiny.en]         # whole-source timestamped transcript -> sources/voice_drops/index/wx.txt (VAD, rough)
    python3 videos/tools/voice_drops.py find wx "the experts gave us"      # fuzzy search the index (leads: listen before cutting)
    python3 videos/tools/voice_drops.py cut wx --from 21:08 --to 21:26 --key wx6_wedge_experts \\
            --expect "The experts gave us NAFTA ... they gave us deindustrialization" --speaker "Haz Al-Din" --ls "LINE_SOURCES 10.6.10 #6" \\
            [--start-at "the experts"] [--end-at "deindustrialization"] [--pre 0.18] [--post 0.35]
    python3 videos/tools/voice_drops.py frame wx --at 21:15 --key wx6_wedge_experts   # one frame of the speaker (frame check), into the sidecar
    python3 videos/tools/voice_drops.py list                               # the catalogue: key, words, length, verbatim, frame check, rights
    python3 videos/tools/voice_drops.py clean wx                           # delete the cached media (the index and the clips stay)
    python3 videos/tools/voice_drops.py --selftest                         # offline: breath-cut and sidecar on a synthetic signal

Where things go: clips and sidecars in videos/sources/voice_drops/<key>.wav(.json), indexes in .../index/<src>.txt, media in
videos/out/.voice_drops_cache/ (deleted by `clean`). Frames in .../frames/<key>.jpg (small, kept: they are the speaker check).

What it decides and what it doesn't. It cuts on the speaker's breaths (the quietest 20 ms point within `--pre`/`--post` of the first and
last word), never mid-word and never time-warped. It reports how close the cut's transcript (faster-whisper base.en) is to `--expect`
(`verbatim`: ratio, missing and extra words): a drop is a quote, and the gate's correctness check applies to quotes. It records the
rights class PARTY for the Party's own media (the client approved mining it, 28 Sep) but not which lines may leave an interview: that,
and the optics of a line, stay the client's call (`clearance` in the sidecar, 'ASK' until someone writes otherwise).
Network: yt-dlp is in the project's python (pip install yt-dlp). YouTube asks for a bot check and Rumble returns 403 from here;
Bilibili, archive.org and TikTok work (VOICE c5 critic, 1 Oct).
"""
import argparse, difflib, json, os, re, subprocess, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
LIB = os.path.join(ROOT, 'sources', 'voice_drops')
IDX = os.path.join(LIB, 'index')
FRAMES = os.path.join(LIB, 'frames')
CACHE = os.path.join(ROOT, 'out', '.voice_drops_cache')
SR = 48000
sys.path.insert(0, os.path.dirname(__file__))


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def sec(s):
    s = str(s)
    if ':' not in s:
        return float(s)
    p = [float(x) for x in s.split(':')]
    return p[0] * 60 + p[1] if len(p) == 2 else p[0] * 3600 + p[1] * 60 + p[2]


def mmss(t):
    return '%02d:%05.2f' % (int(t // 60), t % 60)


def _norm(w):
    return re.sub(r"[^a-z0-9']", '', w.lower().replace('’', "'"))


def info(src):
    p = os.path.join(CACHE, src + '.info.json')
    if os.path.exists(p):
        return json.load(open(p))
    p = os.path.join(IDX, src + '.info.json')            # kept beside the index after `clean`
    return json.load(open(p)) if os.path.exists(p) else {}


def media(src):
    for ext in ('m4a', 'mp4', 'webm', 'mp3', 'wav', 'opus', 'ogg'):
        p = os.path.join(CACHE, f'{src}.{ext}')
        if os.path.exists(p):
            return p
    raise SystemExit(f'voice_drops: no cached media for {src!r}: run `fetch URL --src {src}` first')


# ------------------------------------------------------------------ fetch
def fetch(url, src, fmt='bestaudio[abr>=120]/bestaudio'):
    os.makedirs(CACHE, exist_ok=True); os.makedirs(IDX, exist_ok=True)
    out = os.path.join(CACHE, src + '.%(ext)s')
    cmd = [sys.executable, '-m', 'yt_dlp', '-f', fmt, '--no-playlist', '-o', out, '--write-info-json', '--no-progress', url]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode and 'format is not available' in r.stderr:
        # no audio-only stream (archive.org mirrors): the smallest whole file; ffmpeg reads its audio
        cmd[cmd.index(fmt)] = 'b'
        cmd += ['-S', '+size']
        r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit('voice_drops: fetch failed:\n' + r.stderr[-1500:])
    ij = [f for f in os.listdir(CACHE) if f.startswith(src + '.') and f.endswith('.info.json')]
    meta = {}
    if ij:
        d = json.load(open(os.path.join(CACHE, ij[0])))
        meta = dict(url=d.get('webpage_url') or url, id=d.get('id'), title=d.get('title'), uploader=d.get('uploader'),
                    upload_date=d.get('upload_date'), duration=d.get('duration'), extractor=d.get('extractor'),
                    format=d.get('format'), abr=d.get('abr'))
        os.remove(os.path.join(CACHE, ij[0]))
    meta.setdefault('url', url)
    json.dump(meta, open(os.path.join(CACHE, src + '.info.json'), 'w'), indent=1)
    json.dump(meta, open(os.path.join(IDX, src + '.info.json'), 'w'), indent=1)
    print(json.dumps(meta, indent=1))
    return meta


# ------------------------------------------------------------------ audio io
def load(path, t0=0.0, dur=None, sr=SR):
    import numpy as np
    cmd = [ffmpeg(), '-v', 'error', '-ss', str(max(0.0, t0))]
    if dur:
        cmd += ['-t', str(dur)]
    cmd += ['-i', path, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']
    r = subprocess.run(cmd, capture_output=True)
    return np.frombuffer(r.stdout, np.float32).astype(np.float64)


def _model(name):
    from faster_whisper import WhisperModel
    return WhisperModel(name, device='cpu', compute_type='int8', cpu_threads=3)


def transcribe(x, sr, model='base.en', vad=False):
    """-> [{'w','s','e'}] word stamps (s) and the joined text."""
    import numpy as np
    from scipy.signal import resample_poly
    y = resample_poly(x, 1, sr // 16000).astype(np.float32) if sr != 16000 else x.astype(np.float32)
    segs, _ = _model(model).transcribe(y, word_timestamps=True, vad_filter=vad, language='en', beam_size=5)
    words = [dict(w=w.word.strip(), s=round(w.start, 3), e=round(w.end, 3)) for s in segs for w in (s.words or [])]
    return words, ' '.join(w['w'] for w in words)


# ------------------------------------------------------------------ index / find
def index(src, model='tiny.en'):
    p = media(src)
    os.makedirs(IDX, exist_ok=True)
    m = _model(model)
    segs, _ = m.transcribe(p, vad_filter=True, language='en')
    meta = info(src)
    out = os.path.join(IDX, src + '.txt')
    with open(out, 'w') as f:
        f.write(f"# {src}: {meta.get('title')} ({meta.get('url')}, {meta.get('upload_date')}), faster-whisper {model} + VAD, rough: "
                "no speaker labels; check words with `cut` (base.en) and a frame before quoting\n")
        for s in segs:
            f.write(f'{mmss(s.start)}-{mmss(s.end)} {s.text.strip()}\n')
    print(out)


def find(src, phrase, top=8):
    p = os.path.join(IDX, src + '.txt')
    lines = [l.rstrip('\n') for l in open(p) if l[:1].isdigit()]
    ph = ' '.join(_norm(w) for w in phrase.split())
    res = []
    for i in range(len(lines)):
        for span in (1, 2):
            chunk = lines[i:i + span]
            text = ' '.join(l.split(' ', 1)[1] for l in chunk)
            words = [_norm(w) for w in text.split()]
            n = len(ph.split())
            best = 0.0
            for j in range(0, max(1, len(words) - n + 1)):
                best = max(best, difflib.SequenceMatcher(None, ' '.join(words[j:j + n]), ph).ratio())
            res.append((best, chunk[0].split(' ')[0].split('-')[0], text))
    res.sort(key=lambda r: -r[0])
    seen = set()
    for r, t, text in res:
        if t in seen:
            continue
        seen.add(t)
        print(f'{r:.2f}  {t}  {text[:140]}')
        if len(seen) >= top:
            break


# ------------------------------------------------------------------ cut
def quiet_point(x, sr, t_lo, t_hi, win=0.02):
    """The quietest 20 ms point in [t_lo, t_hi] s (a breath or the gap between words): where a drop is cut."""
    import numpy as np
    i0, i1 = max(0, int(t_lo * sr)), min(len(x), int(t_hi * sr))
    if i1 - i0 < int(win * sr) * 2:
        return (t_lo + t_hi) / 2
    n = int(win * sr)
    e = np.convolve(x[i0:i1] ** 2, np.ones(n) / n, 'same')
    return (i0 + int(np.argmin(e[n:-n])) + n) / sr


def verbatim(heard, expect):
    """How close the cut's words are to the quote we mean (ratio on normalised words; '...' in expect is an elision)."""
    heard = re.sub(r'\s*-\s*', '', heard)                   # whisper splits compounds: "de -industrialization"
    a = [_norm(w) for w in heard.split() if _norm(w)]
    b = [_norm(w) for w in expect.replace('...', ' ').replace('…', ' ').split() if _norm(w)]
    sm = difflib.SequenceMatcher(None, a, b)
    missing, extra = [], []
    for op, i0, i1, j0, j1 in sm.get_opcodes():
        if op in ('delete', 'replace'):
            extra += a[i0:i1]
        if op in ('insert', 'replace'):
            missing += b[j0:j1]
    return dict(ratio=round(sm.ratio(), 3), missing=missing, extra=extra)


def floor_db(x, sr):
    import numpy as np
    n = int(0.02 * sr)
    k = len(x) // n
    e = 10 * np.log10((x[:k * n].reshape(k, n) ** 2).mean(1) + 1e-12)
    return round(float(np.percentile(e, 10) - np.percentile(e, 95)), 1)


def cut(src, t_from, t_to, key, expect='', speaker='', ls='', start_at=None, end_at=None, pre=0.18, post=0.35, model='base.en',
        rights='PARTY', credit=None, note='', force=False):
    import numpy as np
    import soundfile as sf
    os.makedirs(LIB, exist_ok=True)
    out = os.path.join(LIB, key + '.wav')
    if os.path.exists(out) and not force:
        raise SystemExit(f'voice_drops: {out} exists (--force to overwrite)')
    a, b = sec(t_from), sec(t_to)
    x = load(media(src), a, b - a)
    words, text = transcribe(x, SR, model)
    if not words:
        raise SystemExit('voice_drops: no words heard in the window')
    from audio_find import fuzzy_find
    fw = [dict(w=w['w'], s=w['s'], e=w['e']) for w in words]
    i_first, i_last = 0, len(words) - 1
    if start_at:
        m = fuzzy_find(fw, start_at, top=3, min_ratio=0.5)
        if not m:
            raise SystemExit(f'voice_drops: --start-at {start_at!r} not heard in: {text}')
        m.sort(key=lambda r: (-r['ratio'], r['start']))
        i_first = m[0]['i']
    if end_at:
        m = fuzzy_find(fw, end_at, top=5, min_ratio=0.5)
        m = [r for r in m if r['start'] >= words[i_first]['s']]
        if not m:
            raise SystemExit(f'voice_drops: --end-at {end_at!r} not heard after the start in: {text}')
        m.sort(key=lambda r: (-r['ratio'], r['start']))
        r0 = m[0]
        n = len([w for w in end_at.split() if _norm(w)])
        i_last = min(len(words) - 1, r0['i'] + n - 1)
        while i_last + 1 < len(words) and words[i_last]['e'] < r0['end'] - 1e-3:
            i_last += 1
    s0 = words[i_first]['s']
    e0 = words[i_last]['e']
    prev_e = words[i_first - 1]['e'] if i_first > 0 else s0 - pre
    next_s = words[i_last + 1]['s'] if i_last + 1 < len(words) else e0 + post
    c0 = quiet_point(x, SR, max(prev_e, s0 - pre), s0 - 0.02)
    c1 = quiet_point(x, SR, e0 + 0.03, min(next_s, e0 + post))
    y = x[int(c0 * SR): int(c1 * SR)].copy()
    f = int(0.012 * SR)
    y[:f] *= np.linspace(0, 1, f); y[-f:] *= np.linspace(1, 0, f)
    sf.write(out, y, SR, subtype='PCM_24')
    # the cut's own words, re-heard on the cut (what a viewer hears), and the stamps relative to the clip
    cw = [dict(w=w['w'], s=round(w['s'] - c0, 3), e=round(w['e'] - c0, 3)) for w in words[i_first:i_last + 1]]
    heard = ' '.join(w['w'] for w in cw)
    meta = info(src)
    vb = verbatim(heard, expect) if expect else None
    side = dict(
        item=f"{src}:{key}", key=key, kind='voice_drop', speaker=speaker, line_sources=ls,
        url=meta.get('url'), source_id=meta.get('id'), title=meta.get('title'), creator=meta.get('uploader'), date=meta.get('upload_date'),
        src_window=[round(a + c0, 3), round(a + c1, 3)], src_window_mmss=[mmss(a + c0), mmss(a + c1)], dur=round(len(y) / SR, 3),
        words=cw, transcript=heard, transcript_model=model, expect=expect, verbatim=vb,
        rights_class=rights,
        rights=("The Party's own published media; the client approved mining ACP audio and material (28 Sep 2026). "
                "Which lines may leave the interview is the client's call." if rights == 'PARTY' else ''),
        clearance='ASK', credit=credit or (f'{speaker}' if speaker else None),
        floor_db=floor_db(y, SR), frame_check=dict(status='NOT DONE'), note=note,
        made=time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime()), tool='videos/tools/voice_drops.py')
    old = out + '.json'
    if os.path.exists(old):                                 # keep a frame check / clearance already recorded
        o = json.load(open(old))
        for k in ('frame_check', 'clearance', 'note'):
            if o.get(k) and (k != 'note' or not note):
                side[k] = o[k]
    json.dump(side, open(out + '.json', 'w'), indent=1)
    print(json.dumps({k: side[k] for k in ('key', 'src_window_mmss', 'dur', 'transcript', 'verbatim', 'floor_db')}, indent=1))
    return side


# ------------------------------------------------------------------ frame check
def frame(src, at, key):
    """One frame of the speaker at `at` (the frame check LINE_SOURCES asks for). The bundled ffmpeg cannot read https through the
    agent proxy (it segfaults on yt-dlp's --download-sections), so the smallest h264 video stream is downloaded whole once per source
    into the cache (Bilibili 360p: ~80 MB), frames are cut locally, and `clean` deletes it."""
    os.makedirs(FRAMES, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
    meta = info(src)
    t = sec(at)
    vp = os.path.join(CACHE, f'{src}.video.mp4')
    if not os.path.exists(vp):
        cmd = [sys.executable, '-m', 'yt_dlp', '-f', 'worstvideo[vcodec^=avc1]/worstvideo/worst', '--no-playlist', '-o', vp,
               '--no-progress', meta.get('url')]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode or not os.path.exists(vp):
            raise SystemExit('voice_drops: video fetch failed:\n' + r.stderr[-1200:])
    jpg = os.path.join(FRAMES, key + '.jpg')
    subprocess.run([ffmpeg(), '-v', 'error', '-y', '-ss', str(t), '-i', vp, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', jpg])
    sp = os.path.join(LIB, key + '.wav.json')
    if os.path.exists(sp):
        side = json.load(open(sp))
        side['frame_check'] = dict(status='FRAME GRABBED: a person must look', at=mmss(t), frame=os.path.relpath(jpg, ROOT))
        json.dump(side, open(sp, 'w'), indent=1)
    print(jpg)
    return jpg


def mark(key, **kw):
    """Record a decision in a sidecar (frame check seen, clearance)."""
    sp = os.path.join(LIB, key + '.wav.json')
    side = json.load(open(sp))
    for k, v in kw.items():
        if v is None:
            continue
        if k == 'frame':
            side['frame_check']['status'] = v
        else:
            side[k] = v
    json.dump(side, open(sp, 'w'), indent=1)


def catalogue():
    rows = []
    for f in sorted(os.listdir(LIB)) if os.path.isdir(LIB) else []:
        if f.endswith('.wav.json'):
            s = json.load(open(os.path.join(LIB, f)))
            rows.append(s)
            vb = s.get('verbatim') or {}
            print(f"{s['key']:28s} {s['dur']:5.1f}s  verbatim {vb.get('ratio', '-')}  frame: {s['frame_check'].get('status')}  "
                  f"clearance: {s.get('clearance')}  {s.get('rights_class')}\n    \"{s['transcript']}\"")
    return rows


def clean(src):
    n = 0
    for f in os.listdir(CACHE) if os.path.isdir(CACHE) else []:
        if f.startswith(src + '.') or f.startswith(src + '_'):
            os.remove(os.path.join(CACHE, f)); n += 1
    print(f'removed {n} cached file(s) for {src}')


def selftest():
    import numpy as np
    sr = SR
    t = np.arange(int(2.0 * sr)) / sr
    x = 1e-3 * np.random.default_rng(0).standard_normal(len(t))
    for a, b in ((0.3, 0.8), (1.0, 1.6)):
        m = (t >= a) & (t < b)
        x[m] += 0.3 * np.sin(2 * np.pi * 140 * t[m]) * np.sin(np.pi * (t[m] - a) / (b - a))
    q = quiet_point(x, sr, 0.8, 1.0)
    assert 0.8 <= q <= 1.0, q
    v = verbatim('The experts gave us NAFTA, the experts gave us', 'The experts gave us NAFTA ... the experts gave us')
    assert v['ratio'] == 1.0, v
    v2 = verbatim('the experts gave us nafta', 'the experts gave us neoliberalism')
    assert v2['missing'] == ['neoliberalism'] and v2['extra'] == ['nafta'], v2
    assert -60 < floor_db(x, sr) < -20
    assert sec('21:12') == 1272 and sec('1:00:00') == 3600
    print('voice_drops selftest ok (breath cut, verbatim, floor, time parse)')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', nargs='?', choices=['fetch', 'index', 'find', 'cut', 'frame', 'mark', 'list', 'clean'])
    ap.add_argument('arg', nargs='*')
    ap.add_argument('--src'); ap.add_argument('--from', dest='t_from'); ap.add_argument('--to', dest='t_to')
    ap.add_argument('--key'); ap.add_argument('--expect', default=''); ap.add_argument('--speaker', default='')
    ap.add_argument('--ls', default=''); ap.add_argument('--start-at'); ap.add_argument('--end-at')
    ap.add_argument('--pre', type=float, default=0.18); ap.add_argument('--post', type=float, default=0.35)
    ap.add_argument('--model', default=None); ap.add_argument('--at'); ap.add_argument('--credit'); ap.add_argument('--note', default='')
    ap.add_argument('--frame-status'); ap.add_argument('--clearance'); ap.add_argument('--force', action='store_true')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.cmd == 'fetch':
        return fetch(a.arg[0], a.src or 'src')
    if a.cmd == 'index':
        return index(a.arg[0], a.model or 'tiny.en')
    if a.cmd == 'find':
        return find(a.arg[0], ' '.join(a.arg[1:]))
    if a.cmd == 'cut':
        return cut(a.arg[0], a.t_from, a.t_to, a.key, a.expect, a.speaker, a.ls, a.start_at, a.end_at, a.pre, a.post,
                   a.model or 'base.en', credit=a.credit, note=a.note, force=a.force)
    if a.cmd == 'frame':
        return frame(a.arg[0], a.at, a.key)
    if a.cmd == 'mark':
        return mark(a.key, frame=a.frame_status, clearance=a.clearance)
    if a.cmd == 'list':
        return catalogue()
    if a.cmd == 'clean':
        return clean(a.arg[0])
    ap.print_help()


if __name__ == '__main__':
    main()
