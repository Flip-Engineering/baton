#!/usr/bin/env python3
"""ref_mine: mine an account's (or a page's) pictures into a classified, de-duplicated reference set.

A reusable reference miner for any studio. It pages through a source, records every post, downloads
small copies of the pictures (video only as a few keyframes, never whole files), drops near-duplicates
by perceptual hash, scores each picture against text prompts with a small local CLIP, scores
similarity to one or more reference images, and writes a JSONL index plus a contact sheet per category.
The scores are a sorting aid for an agent's eye, not a verdict: look at the sheets before keeping.

Sources
  --x HANDLE ...        X via api.fxtwitter.com (/2/profile/<h>/media, and /statuses with --statuses),
                        following cursor.bottom. Quote-posts and reposts are recorded under the original
                        author (`account`), with the miner's handle in `via`; handles credited in
                        the text ("art by @x", "🎨 @x", "credit @x") go to `artist_credit`.
  --tiktok HANDLE ...   TikTok via www.tikwm.com/api/user/posts (cover + keyframes). Stops if refused.
  --url URL ...         any web page: <img>, og:image and twitter:image pictures on it.
  --status URL|ID ...   single X posts (e.g. originals found through credits).

Subcommands
  fetch     page sources, record posts (posts.jsonl), download scan copies into <work>/cache, pHash dedupe
  classify  CLIP zero-shot categories + similarity to --ref images -> index.jsonl
  sheets    one contact sheet per category (+ 'similar' sheet sorted by reference similarity)
  keep      re-fetch chosen items at --long px into --dest as <post id>[_n].jpg, write dest index.jsonl
            and a contact sheet; choose by --cats / --min-sim, or by an explicit --ids file (one id per line)
  all       fetch + classify + sheets
  handles   list accounts seen in quotes, reposts, credits and mentions (leads to follow)
  query     rank all embedded images by free-text --prompts (best cosine, no softmax) -> sheets + jsonl

Etiquette and limits
  About one API request per 2 s (--rate). A 404 is retried once; a 403 or 429 stops that source and is
  reported (never routed around). Bytes are counted against --budget-mb; the run stops before free disk
  falls under --min-free-gb. Scan copies are small (X 'small' variant, <=680 px) and can be dropped
  with `keep ... --drop-cache`.

CLIP: Xenova clip-vit-base-patch32 int8 ONNX, the archive kit's model (videos/engine/archive/clipx.py).
  Fetch with: (cd videos/engine && python3 -c "from archive import vision; vision.fetch_models()")
  Remove after with: (cd videos/engine && python3 -m archive.vision drop-models)

Example
  python3 videos/tools/ref_mine.py all --work /tmp/mine --x ACPMain InfraHaz --pages 40 \\
      --ref videos/sources/acp_fortress.jpg
  python3 videos/tools/ref_mine.py keep --work /tmp/mine --cats machines exosuits --dest out/refs
Categories are a JSON file {name: [prompt, ...]} via --categories; the built-in set is DEFAULT_CATEGORIES.
"""
import argparse, html, io, json, os, re, shutil, subprocess, sys, time, urllib.parse, urllib.request, urllib.error
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(os.path.dirname(HERE), 'engine')
UA = 'Mozilla/5.0 (X11; Linux x86_64) ref_mine/1.0 (reference research)'
CA = '/root/.ccr/ca-bundle.crt'

DEFAULT_CATEGORIES = {
    'mech_walker': ['a giant walking mech with mechanical legs', 'a bipedal combat mech walker', 'a four-legged walking tank machine',
                    'a mecha robot with a pilot cockpit', 'a sci-fi walker vehicle illustration'],
    'giant_robot': ['a giant humanoid robot towering over a city', 'workers building a giant robot with scaffolding and cranes',
                    'a colossal robot statue', 'a huge robot standing in a hangar', 'a retro poster of a giant robot'],
    'exosuit': ['workers wearing powered exoskeleton suits', 'a soldier in heavy armored power armor',
                'a person in a bulky yellow hazmat space suit', 'an illustration of armored astronauts'],
    'war_machine': ['a tank or armored military vehicle', 'a warship, fighter jet or bomber', 'a military parade with missiles'],
    'construction_machine': ['an excavator, crane, bulldozer or forklift', 'a factory floor with heavy industrial machines',
                             'a steel mill or shipyard with workers'],
    'industrial_scifi': ['a sci-fi industrial fortress base illustration', 'a futuristic factory and refinery painting',
                         'a megastructure or space colony illustration', 'a futuristic city skyline concept art'],
    'party_mark': ['a hammer and sickle with a gear logo', 'a red and white communist party logo emblem',
                   'a flag with a hammer and sickle and stripes'],
    'people_rallies': ['a photo of people at a rally or protest with flags', 'a group photo of people at a meeting',
                       'a person speaking at a podium', 'a photo of a man talking to the camera', 'a photo of people in a room'],
    'memes': ['an internet meme with a caption', 'a screenshot of a tweet or social media post', 'a reaction meme with a cartoon face'],
    'text_cards': ['a graphic with large bold text on a plain background', 'a poster with a quote in text',
                   'an infographic with numbers', 'a document or newspaper page'],
    'archival': ['an old black and white historical photograph', 'a vintage painting of historical figures',
                 'a soviet propaganda poster'],
}
# categories summed into the 'machine' score used to order review sheets (override with --machine-cats)
MACHINE_CATS = ['mech_walker', 'giant_robot', 'exosuit', 'war_machine', 'construction_machine', 'industrial_scifi']

# ------------------------------------------------------------------ io helpers
def jl_read(p):
    if not os.path.exists(p): return []
    with open(p) as f: return [json.loads(l) for l in f if l.strip()]

def jl_write(p, rows):
    tmp = p + '.tmp'
    with open(tmp, 'w') as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + '\n')
    os.replace(tmp, p)

def free_gb(path):
    s = os.statvfs(path); return s.f_bavail * s.f_frsize / 1e9

class Stop(Exception):
    pass

class Net:
    """Paced fetcher with a byte budget and a disk floor."""
    def __init__(self, work, rate=2.0, budget_mb=300, min_free_gb=2.0):
        self.work, self.rate, self.min_free = work, rate, min_free_gb
        self.state_p = os.path.join(work, 'state.json')
        st = json.load(open(self.state_p)) if os.path.exists(self.state_p) else {}
        self.bytes = st.get('bytes', 0); self.budget = budget_mb * 1e6
        self.last = {}; self.log = []

    def save(self):
        json.dump({'bytes': self.bytes}, open(self.state_p, 'w'))

    def guard(self, need=0):
        if self.bytes + need > self.budget: raise Stop(f'download budget reached ({self.bytes/1e6:.1f} MB)')
        if free_gb(self.work) < self.min_free: raise Stop(f'free disk under {self.min_free} GB')

    def _pace(self, host, gap):
        t = self.last.get(host, 0); d = gap - (time.time() - t)
        if d > 0: time.sleep(d)
        self.last[host] = time.time()

    def get(self, url, gap=None, accept_json=False):
        """Return bytes. 404 retried once; 403/429 raise Blocked; other errors return None."""
        self.guard()
        host = urllib.parse.urlparse(url).netloc
        gap = self.rate if gap is None else gap
        for attempt in (0, 1):
            self._pace(host, gap)
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json' if accept_json else '*/*'})
            try:
                with urllib.request.urlopen(req, timeout=40) as r:
                    b = r.read()
                self.bytes += len(b); self.save(); return b
            except urllib.error.HTTPError as e:
                if e.code in (403, 429):
                    body = e.read()[:300].decode('utf8', 'replace')
                    why = 'Cloudflare challenge' if 'Just a moment' in body or e.headers.get('cf-mitigated') else body[:120]
                    raise Blocked(f'{e.code} from {host}: {why}')
                if e.code == 404 and attempt == 0:
                    time.sleep(gap); continue
                self.log.append(f'{e.code} {url}'); return None
            except Exception as e:
                msg = str(e)
                if 'Tunnel connection failed' in msg or '403' in msg or '502' in msg:
                    raise Blocked(f'proxy refused {host}: {msg[:120]}')
                if attempt == 0: time.sleep(gap); continue
                self.log.append(f'ERR {url} {msg[:100]}'); return None
        return None

class Blocked(Exception):
    pass

# ------------------------------------------------------------------ images
def downsize(b, long=1600, quality=88):
    im = Image.open(io.BytesIO(b)); im.load()
    if im.mode not in ('RGB', 'L'):
        bg = Image.new('RGB', im.size, (255, 255, 255))
        if im.mode in ('RGBA', 'LA', 'P'):
            im = im.convert('RGBA'); bg.paste(im, mask=im.split()[-1]); im = bg
        else: im = im.convert('RGB')
    im = im.convert('RGB')
    w, h = im.size; s = long / max(w, h)
    if s < 1: im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    out = io.BytesIO(); im.save(out, 'JPEG', quality=quality, optimize=True)
    return out.getvalue(), im.size

def phash(path):
    """64-bit DCT perceptual hash as a hex string."""
    import cv2
    im = Image.open(path).convert('L').resize((32, 32), Image.LANCZOS)
    d = cv2.dct(np.asarray(im, np.float32))[:8, :8].flatten()
    bits = d > np.median(d[1:])
    return '%016x' % int(''.join('1' if x else '0' for x in bits), 2)

def hamming(a, b):
    return bin(int(a, 16) ^ int(b, 16)).count('1')

def twimg_variant(url, name):
    """pbs.twimg.com/media/X.jpg[?...] -> ?format=jpg&name=<name>; other urls unchanged."""
    if 'pbs.twimg.com/media/' not in url: return url
    base = url.split('?')[0]; m = re.match(r'(.*/media/[^.]+)\.(\w+)$', base)
    if m: return f'{m.group(1)}?format={m.group(2) if m.group(2) in ("jpg", "png", "webp") else "jpg"}&name={name}'
    return base + f'?format=jpg&name={name}'

FFMPEG = None
def ffmpeg():
    global FFMPEG
    if FFMPEG: return FFMPEG
    FFMPEG = shutil.which('ffmpeg')
    if not FFMPEG:
        try:
            import imageio_ffmpeg; FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception: FFMPEG = None
    return FFMPEG

def keyframes(url, duration, n, outdir, stem):
    """Seek-and-grab n frames from a remote video (HTTP range reads; never the whole file)."""
    ff = ffmpeg(); outs = []
    if not ff or not duration: return outs
    env = dict(os.environ); px = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    if px: env['http_proxy'] = px
    for i in range(n):
        t = duration * (i + 1) / (n + 1)
        p = os.path.join(outdir, f'{stem}_k{i}.jpg')
        cmd = [ff, '-hide_banner', '-loglevel', 'debug', '-ss', f'{t:.2f}']
        if url.startswith('https') and os.path.exists(CA): cmd += ['-tls_verify', '1', '-ca_file', CA]
        cmd += ['-i', url, '-frames:v', '1', '-vf', "scale='min(680,iw)':-2", '-q:v', '4', '-y', p]
        try:
            r = subprocess.run(cmd, env=env, timeout=60, capture_output=True, text=True, errors='replace')
            m = re.findall(r'Statistics: (\d+) bytes read', r.stderr)
            nb = sum(map(int, m)) if m else 250_000   # ffmpeg's own count of bytes read; fallback estimate
            if r.returncode == 0 and os.path.exists(p) and os.path.getsize(p) > 1000: outs.append((p, t, nb))
            else: outs.append((None, t, nb))
        except Exception:
            pass
    return outs

# ------------------------------------------------------------------ X via fxtwitter
CREDIT_RE = re.compile(r'(?:art(?:work)?\s*(?:by|:)|artist\s*[:\-]?|illustrat\w*\s*(?:by|:)|credit\s*(?:to|:)?|by|🎨|h/t|via)\s*@(\w{2,15})', re.I)
MENTION_RE = re.compile(r'@(\w{2,15})')

def x_post_records(s, via):
    """Flatten an fxtwitter status (and its quote) into post records."""
    out = []
    def one(st, role):
        a = (st.get('author') or {}).get('screen_name', '')
        text = st.get('text') or ''
        media = []
        for m in ((st.get('media') or {}).get('all') or []):
            item = {'type': m.get('type'), 'url': m.get('url'), 'w': m.get('width'), 'h': m.get('height'),
                    'thumb': m.get('thumbnail_url'), 'duration': m.get('duration')}
            if m.get('type') in ('video', 'gif'):
                mp4 = [f for f in (m.get('formats') or []) if f.get('container') == 'mp4']
                if mp4: item['low_mp4'] = min(mp4, key=lambda f: f.get('bitrate') or 1e12)['url']
            media.append(item)
        rb = st.get('reposted_by'); rb = (rb or {}).get('screen_name') if isinstance(rb, dict) else rb
        return {'platform': 'x', 'id': st.get('id'), 'url': st.get('url'), 'account': a, 'via': via, 'role': role,
                'reposted_by': rb, 'date': st.get('created_at'), 'ts': st.get('created_timestamp'), 'text': text,
                'views': st.get('views'), 'likes': st.get('likes'), 'reposts': st.get('reposts'), 'bookmarks': st.get('bookmarks'),
                'credits': sorted(set(CREDIT_RE.findall(text))), 'mentions': sorted(set(MENTION_RE.findall(text))),
                'quote_of': (st.get('quote') or {}).get('id'), 'media': media}
    out.append(one(s, 'post'))
    if s.get('quote'): out.append(one(s['quote'], 'quoted'))
    return out

def mine_x(net, handle, pages, kinds, posts, log):
    seen = {p['id'] for p in posts}; n_new = 0
    for kind in kinds:
        cursor = None; empty = 0
        for page in range(pages):
            url = f'https://api.fxtwitter.com/2/profile/{handle}/{kind}' + (f'?cursor={urllib.parse.quote(cursor)}' if cursor else '')
            b = net.get(url, accept_json=True)
            d = json.loads(b) if b else {}
            res = d.get('results') or []
            if not res:
                empty += 1
                if empty >= 3: log.append(f'@{handle}/{kind}: empty page {page} x3, stopping'); break
                time.sleep(net.rate); continue
            empty = 0
            for s in res:
                for r in x_post_records(s, handle):
                    if r['id'] and r['id'] not in seen:
                        seen.add(r['id']); posts.append(r); n_new += 1
            nxt = (d.get('cursor') or {}).get('bottom')
            if not nxt or nxt == cursor: log.append(f'@{handle}/{kind}: end after {page+1} pages'); break
            cursor = nxt
            print(f'  @{handle}/{kind} page {page+1}: {len(res)} posts (total new {n_new})', flush=True)
    return n_new

def mine_status(net, ref, posts):
    m = re.search(r'(?:x|twitter)\.com/(\w+)/status/(\d+)', ref)
    h, i = (m.group(1), m.group(2)) if m else ('i', ref)
    b = net.get(f'https://api.fxtwitter.com/{h}/status/{i}', accept_json=True)
    if not b: return 0
    s = json.loads(b).get('tweet') or {}
    seen = {p['id'] for p in posts}; n = 0
    for r in x_post_records(s, 'status'):
        if r['id'] not in seen: posts.append(r); n += 1
    return n

# ------------------------------------------------------------------ TikTok via tikwm
def mine_tiktok(net, handle, pages, posts):
    seen = {p['id'] for p in posts}; cursor = 0; n = 0
    for _ in range(pages):
        b = net.get(f'https://www.tikwm.com/api/user/posts?unique_id={handle}&count=35&cursor={cursor}', gap=max(net.rate, 2.5), accept_json=True)
        d = (json.loads(b) if b else {}).get('data') or {}
        for v in d.get('videos') or []:
            vid = str(v.get('video_id'))
            if vid in seen: continue
            seen.add(vid); n += 1
            posts.append({'platform': 'tiktok', 'id': vid, 'url': f'https://www.tiktok.com/@{handle}/video/{vid}', 'account': handle,
                          'via': handle, 'role': 'post', 'date': time.strftime('%a %b %d %H:%M:%S +0000 %Y', time.gmtime(v.get('create_time') or 0)),
                          'ts': v.get('create_time'), 'text': v.get('title') or '', 'views': v.get('play_count'), 'likes': v.get('digg_count'),
                          'credits': [], 'mentions': [], 'media': [{'type': 'video', 'url': v.get('play'), 'thumb': v.get('cover') or v.get('origin_cover'),
                                                                    'duration': v.get('duration'), 'low_mp4': v.get('play')}]
                                                         + [{'type': 'photo', 'url': u} for u in (v.get('images') or [])]})
        if not d.get('hasMore'): break
        cursor = d.get('cursor')
    return n

# ------------------------------------------------------------------ web pages
def mine_page(net, url, posts, min_px=400):
    b = net.get(url, gap=net.rate)
    if not b: return 0
    page = b.decode('utf8', 'replace')
    title = re.search(r'<title[^>]*>(.*?)</title>', page, re.S | re.I)
    srcs = re.findall(r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\'][^>]+content=["\']([^"\']+)', page, re.I)
    srcs += re.findall(r'<img[^>]+(?:data-src|src)=["\']([^"\']+)', page, re.I)
    srcs += [s.split()[0] for ss in re.findall(r'srcset=["\']([^"\']+)', page, re.I) for s in ss.split(',')[-1:]]
    media, seen = [], set()
    for s in srcs:
        s = urllib.parse.urljoin(url, html.unescape(s.strip()))
        if s in seen or s.startswith('data:') or re.search(r'\.(svg|gif)(\?|$)|sprite|icon|logo|avatar|pixel', s, re.I): continue
        seen.add(s); media.append({'type': 'photo', 'url': s, 'min_px': min_px})
    pid = 'web_' + re.sub(r'\W+', '_', urllib.parse.urlparse(url).netloc + urllib.parse.urlparse(url).path)[:80]
    posts.append({'platform': 'web', 'id': pid, 'url': url, 'account': urllib.parse.urlparse(url).netloc, 'via': 'url', 'role': 'page',
                  'date': None, 'text': html.unescape(title.group(1).strip()) if title else '', 'credits': [], 'mentions': [], 'media': media[:60]})
    return 1

# ------------------------------------------------------------------ download scan copies
def download(net, work, posts, frames, scan_long=680, variant='small', photos_only=False):
    cache = os.path.join(work, 'cache'); os.makedirs(cache, exist_ok=True)
    items = {r['key']: r for r in jl_read(os.path.join(work, 'items.jsonl'))}
    hashes = [(r['phash'], r['key']) for r in items.values() if r.get('phash') and not r.get('dup_of')]
    added = 0
    try:
        for p in posts:
            for mi, m in enumerate(p.get('media') or []):
                base = f"{p['id']}_{mi}"
                jobs = []
                if m['type'] == 'photo': jobs.append((base, 'photo', None))
                elif photos_only: continue
                else:
                    jobs.append((base + '_t', 'thumb', None))
                    if frames: jobs.append((base, 'keyframes', None))
                for key, kind, _ in jobs:
                    if kind == 'keyframes':
                        if any(k.startswith(base + '_k') for k in items): continue
                        src = m.get('low_mp4') or m.get('url')
                        if not src or not m.get('duration'): continue
                        net.guard(1e6)
                        for path, t, nb in keyframes(src, m['duration'], frames, cache, base):
                            net.bytes += nb   # bytes ffmpeg read for this seek-and-grab
                            if not path: continue
                            k = os.path.basename(path)[:-4]
                            items[k] = {'key': k, 'post': p['id'], 'media_i': mi, 'kind': 'keyframe', 't': round(t, 2), 'src': src, 'file': path}
                            added += 1
                        net.save(); continue
                    if key in items: continue
                    src = m['url'] if kind == 'photo' else m.get('thumb')
                    if not src: continue
                    b = net.get(twimg_variant(src, variant), gap=0.6)
                    if not b: continue
                    try:
                        jb, size = downsize(b, scan_long, 85)
                    except Exception:
                        continue
                    if m.get('min_px') and max(size) < m['min_px'] and max(Image.open(io.BytesIO(b)).size) < m['min_px']: continue
                    path = os.path.join(cache, key + '.jpg'); open(path, 'wb').write(jb)
                    items[key] = {'key': key, 'post': p['id'], 'media_i': mi, 'kind': kind, 'src': src, 'variant': variant if 'pbs.twimg.com/media/' in src else None,
                                  'orig_w': m.get('w'), 'orig_h': m.get('h'), 'file': path}
                    added += 1
                    if added % 20 == 0:
                        print(f'  downloaded {added} ({net.bytes/1e6:.1f} MB used, {free_gb(work):.2f} GB free)', flush=True)
                        jl_write(os.path.join(work, 'items.jsonl'), items.values())
    finally:
        # pHash dedupe over everything new
        for r in items.values():
            if r.get('phash') or not os.path.exists(r.get('file', '')): continue
            r['phash'] = phash(r['file'])
            hit = next((k for h, k in hashes if hamming(h, r['phash']) <= 6), None)
            if hit:
                r['dup_of'] = hit; os.remove(r['file']); r['file'] = None
            else: hashes.append((r['phash'], r['key']))
        jl_write(os.path.join(work, 'items.jsonl'), items.values())
    return added

def refetch(net, work, keys, variant='small', scan_long=680):
    """Upgrade probe copies (e.g. 240x240) of chosen items to a larger variant; drops their cached embedding."""
    ip = os.path.join(work, 'items.jsonl'); items = jl_read(ip); n = 0
    emb_p = os.path.join(work, 'emb.npz'); emb = dict(np.load(emb_p)) if os.path.exists(emb_p) else {}
    for r in items:
        if r['key'] in keys and r.get('kind') == 'photo' and r.get('file'):
            b = net.get(twimg_variant(r['src'], variant), gap=0.6)
            if not b: continue
            jb, _ = downsize(b, scan_long, 85); open(r['file'], 'wb').write(jb); r['variant'] = variant; emb.pop(r['key'], None); n += 1
    jl_write(ip, items)
    if emb: np.savez(emb_p, **emb)
    return n

# ------------------------------------------------------------------ classify
def load_clip():
    sys.path.insert(0, ENGINE)
    from archive import clipx
    if not clipx.models_present() or not os.path.exists(os.path.join(clipx.MODELS, 'text_model_quantized.onnx')):
        sys.exit('CLIP weights missing: (cd videos/engine && python3 -c "from archive import vision; vision.fetch_models()")')
    return clipx

def classify(work, cats, refs, threads=2, machine_cats=None):
    clipx = load_clip()
    V, T = clipx.Vision(threads), clipx.Text(threads)
    names = list(cats)
    temb = np.stack([T(cats[n]).mean(0) for n in names]); temb /= np.linalg.norm(temb, axis=1, keepdims=True)
    remb = V([Image.open(r) for r in refs]) if refs else None
    items = jl_read(os.path.join(work, 'items.jsonl'))
    emb_p = os.path.join(work, 'emb.npz')
    cache = dict(np.load(emb_p)) if os.path.exists(emb_p) else {}
    live = [r for r in items if r.get('file') and os.path.exists(r['file'])]
    todo = [r for r in live if r['key'] not in cache]
    for i in range(0, len(todo), 16):
        batch = todo[i:i + 16]
        e = V([Image.open(r['file']) for r in batch])
        for r, v in zip(batch, e): cache[r['key']] = v
        print(f'  embedded {min(i+16, len(todo))}/{len(todo)}', flush=True)
    np.savez(emb_p, **cache)
    for r in live:
        v = cache[r['key']]
        logits = 100 * temb @ v; pr = np.exp(logits - logits.max()); pr /= pr.sum()
        o = np.argsort(-pr)
        r['category'] = names[o[0]]; r['p'] = round(float(pr[o[0]]), 3)
        r['second'] = names[o[1]]; r['scores'] = {n: round(float(x), 3) for n, x in zip(names, pr)}
        mc = [n for n in (machine_cats or MACHINE_CATS) if n in names]
        if mc: r['machine'] = round(float(sum(pr[names.index(n)] for n in mc)), 3)
        if remb is not None: r['sim'] = round(float((remb @ v).max()), 4)
    jl_write(os.path.join(work, 'items.jsonl'), items)
    write_index(work)

def write_index(work):
    posts = {p['id']: p for p in jl_read(os.path.join(work, 'posts.jsonl'))}
    rows = []
    for r in jl_read(os.path.join(work, 'items.jsonl')):
        p = posts.get(r['post'], {})
        m = (p.get('media') or [{}])[r['media_i']] if p.get('media') and r['media_i'] < len(p['media']) else {}
        rows.append({'key': r['key'], 'post_id': r['post'], 'post_url': p.get('url'), 'platform': p.get('platform'),
                     'account': p.get('account'), 'via': p.get('via'), 'role': p.get('role'), 'reposted_by': p.get('reposted_by'),
                     'artist_credit': p.get('credits') or None, 'date': p.get('date'), 'text': p.get('text'),
                     'views': p.get('views'), 'likes': p.get('likes'), 'media_type': m.get('type'), 'media_url': r.get('src'),
                     'media_w': m.get('w'), 'media_h': m.get('h'), 'kind': r.get('kind'), 't': r.get('t'),
                     'phash': r.get('phash'), 'dup_of': r.get('dup_of'), 'category': r.get('category'), 'p': r.get('p'),
                     'second': r.get('second'), 'sim': r.get('sim'), 'machine': r.get('machine'), 'scores': r.get('scores'), 'file': r.get('file')})
    jl_write(os.path.join(work, 'index.jsonl'), rows)
    return rows

# ------------------------------------------------------------------ contact sheets
def _font(sz):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()

def contact_sheet(rows, out, title, cell=300, cols=6, label=None):
    if not rows: return None
    f, ft = _font(13), _font(20)
    rws = (len(rows) + cols - 1) // cols
    W, H = cols * cell, 40 + rws * (cell + 34)
    sheet = Image.new('RGB', (W, H), (244, 242, 236)); d = ImageDraw.Draw(sheet)
    d.text((10, 10), title, fill=(20, 20, 20), font=ft)
    for i, r in enumerate(rows):
        x, y = (i % cols) * cell, 40 + (i // cols) * (cell + 34)
        try:
            im = Image.open(r['file']).convert('RGB'); im.thumbnail((cell - 8, cell - 8))
            sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
        except Exception: pass
        lab = label(r) if label else f"{r['key']}"
        for j, line in enumerate(lab.split('\n')[:2]):
            d.text((x + 4, y + cell + 2 + j * 15), line[:44], fill=(30, 30, 30), font=f)
    sheet.save(out, 'JPEG', quality=82)
    return out

def default_label(r):
    return f"{r.get('account','')} {r['post_id'][-8:] if r.get('post_id') else r['key']}\n{r.get('category','')} p{r.get('p') or 0:.2f}" + (f" m{r['machine']:.2f}" if r.get('machine') is not None else '') + (f" sim{r['sim']:.2f}" if r.get('sim') is not None else '')

def sheets(work, outdir, per=60, sort='machine', top=180):
    """Per-category sheets ordered by `sort` ('machine', 'sim' or 'p'), plus a sheet of the top items by machine score."""
    key = lambda r: -(r.get(sort) or 0)
    os.makedirs(outdir, exist_ok=True)
    rows = [r for r in jl_read(os.path.join(work, 'index.jsonl')) if r.get('file') and os.path.exists(r['file']) and r.get('category')]
    made = []
    for cat in sorted({r['category'] for r in rows}):
        rs = sorted([r for r in rows if r['category'] == cat], key=key)
        for k in range(0, len(rs), per):
            p = os.path.join(outdir, f'contact_{cat}' + (f'_{k//per+1}' if len(rs) > per else '') + '.jpg')
            made.append(contact_sheet(rs[k:k + per], p, f'{cat}: {len(rs)} images (sorted by {sort}) {k+1}-{min(k+per,len(rs))}', label=default_label))
    for sk, nm in (('machine', 'machine_score'), ('sim', 'reference_similarity')):
        if not any(r.get(sk) is not None for r in rows): continue
        rs = sorted(rows, key=lambda r: -(r.get(sk) or 0))[:top]
        for k in range(0, len(rs), per):
            made.append(contact_sheet(rs[k:k + per], os.path.join(outdir, f'review_top_{nm}_{k//per+1}.jpg'),
                                      f'top {len(rs)} by {nm}: {k+1}-{min(k+per,len(rs))} (a review aid, not a verdict)', label=default_label))
    return made

# ------------------------------------------------------------------ keep
def keep(net, work, dest, cats, min_sim, ids_file, long, sheet_name, append=False, variant='large'):
    os.makedirs(dest, exist_ok=True)
    rows = [r for r in jl_read(os.path.join(work, 'index.jsonl')) if not r.get('dup_of')]
    if ids_file:
        want = [l.split('#')[0].strip() for l in open(ids_file) if l.split('#')[0].strip()]
        notes = {l.split('#')[0].strip(): l.split('#', 1)[1].strip() for l in open(ids_file) if '#' in l and l.split('#')[0].strip()}
        by = {r['key']: r for r in rows}
        sel = [by[k] for k in want if k in by]
        missing = [k for k in want if k not in by]
        if missing: print('not in index:', missing)
    else:
        notes = {}
        sel = [r for r in rows if r.get('category') in cats or (min_sim and (r.get('sim') or 0) >= min_sim)]
    out_rows = []
    for r in sel:
        # the post id for a post's first photo; the item key (post_mediaIndex[_kN|_t]) otherwise
        name = (r['post_id'] if r['key'] == f"{r['post_id']}_0" else r['key']) + '.jpg'
        p = os.path.join(dest, name)
        if not os.path.exists(p):
            b = None
            if r.get('kind') == 'photo' and r.get('media_url'):
                b = net.get(twimg_variant(r['media_url'], variant), gap=0.6)
            if b:
                jb, _ = downsize(b, long, 88); open(p, 'wb').write(jb)
            else:
                shutil.copy(r['file'], p)  # keyframes / thumbs: the scan copy is what we have
        row = {k: r.get(k) for k in ('post_id', 'post_url', 'platform', 'account', 'via', 'role', 'reposted_by', 'artist_credit',
                                     'date', 'text', 'views', 'likes', 'media_url', 'kind', 't', 'category', 'p', 'sim')}
        row['file'] = name; row['key'] = r['key']
        if r['key'] in notes: row['note'] = notes[r['key']]
        out_rows.append(row)
    if append:
        old = [r for r in jl_read(os.path.join(dest, 'index.jsonl')) if r.get('key') not in {o['key'] for o in out_rows}]
        out_rows = old + out_rows
    jl_write(os.path.join(dest, 'index.jsonl'), out_rows)
    shown = [dict(r, file=os.path.join(dest, r['file'])) for r in out_rows if os.path.exists(os.path.join(dest, r['file']))]
    contact_sheet(shown, os.path.join(dest, sheet_name), f'kept: {len(shown)} references', label=default_label)
    return out_rows

# ------------------------------------------------------------------ free-text retrieval
def query(work, prompts, out, top=160, per=80, threads=2):
    """Rank every embedded image by its best cosine to any prompt (no softmax: finds e.g. mecha inside memes)."""
    clipx = load_clip(); t = clipx.Text(threads)(prompts)
    E = np.load(os.path.join(work, 'emb.npz'))
    rows = {r['key']: r for r in jl_read(os.path.join(work, 'index.jsonl')) if r.get('file') and not r.get('dup_of')}
    sc = sorted(((float((t @ E[k]).max()), k) for k in E.files if k in rows), reverse=True)[:top]
    ranked = [dict(rows[k], q=round(s, 4)) for s, k in sc]
    lab = lambda r: f"{r['post_id']}\n{(r.get('account') or '')[:14]} q{r['q']:.3f}"
    os.makedirs(os.path.dirname(os.path.abspath(out)) or '.', exist_ok=True)
    stem = out[:-4] if out.endswith('.jpg') else out
    for k in range(0, len(ranked), per):
        contact_sheet(ranked[k:k + per], f'{stem}_{k//per+1}.jpg', f'query rank {k+1}-{min(k+per,len(ranked))}: ' + '; '.join(prompts)[:120], cell=200, cols=10, label=lab)
    jl_write(stem + '.jsonl', [{'key': r['key'], 'post_url': r.get('post_url'), 'account': r.get('account'), 'q': r['q']} for r in ranked])
    return ranked

# ------------------------------------------------------------------ leads
def handles(work, top=40):
    from collections import Counter
    c = Counter(); mined = set()
    for p in jl_read(os.path.join(work, 'posts.jsonl')):
        mined.add((p.get('via') or '').lower())
        if p.get('role') == 'quoted' or (p.get('account') and p['account'].lower() != (p.get('via') or '').lower()):
            c['author:' + p['account']] += 1
        for h in p.get('credits') or []: c['credit:' + h] += 1
        for h in p.get('mentions') or []: c['mention:' + h] += 1
    for k, v in c.most_common(top): print(f'{v:4d} {k}')

# ------------------------------------------------------------------ cli
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['fetch', 'classify', 'sheets', 'keep', 'all', 'handles', 'query'])
    ap.add_argument('--work', required=True, help='work dir: posts.jsonl, items.jsonl, index.jsonl, cache/, emb.npz')
    ap.add_argument('--x', nargs='*', default=[]); ap.add_argument('--tiktok', nargs='*', default=[])
    ap.add_argument('--url', nargs='*', default=[]); ap.add_argument('--status', nargs='*', default=[])
    ap.add_argument('--statuses', action='store_true', help='also page /statuses (text posts, quotes, reposts)')
    ap.add_argument('--pages', type=int, default=30); ap.add_argument('--frames', type=int, default=3, help='keyframes per video (0: cover only)')
    ap.add_argument('--rate', type=float, default=2.0, help='seconds between API requests')
    ap.add_argument('--budget-mb', type=float, default=300); ap.add_argument('--min-free-gb', type=float, default=2.0)
    ap.add_argument('--categories', help='JSON {name: [prompts]}'); ap.add_argument('--ref', nargs='*', default=[])
    ap.add_argument('--sheets-dir'); ap.add_argument('--dest'); ap.add_argument('--cats', nargs='*', default=[])
    ap.add_argument('--scan-variant', default='small', help="X image variant for scan copies: small (<=680 px, ~45 KB), 240x240 (~9 KB, a cheap probe CLIP can still read), thumb")
    ap.add_argument('--photos-only', action='store_true', help='skip video covers and keyframes (cheap probe)')
    ap.add_argument('--refetch', nargs='*', default=[], help='keys to re-download at --scan-variant small (e.g. probe hits)')
    ap.add_argument('--prompts', nargs='*', default=[], help='query: free-text prompts'); ap.add_argument('--out', help='query: sheet path stem'); ap.add_argument('--top', type=int, default=160)
    ap.add_argument('--append', action='store_true', help='keep: merge into an existing dest index (several work dirs -> one set)')
    ap.add_argument('--keep-variant', default='large', help='keep: X variant to re-fetch (large 2048, medium 1200)')
    ap.add_argument('--machine-cats', nargs='*', help='categories summed into the machine score')
    ap.add_argument('--sort', default='machine', choices=['machine', 'sim', 'p'])
    ap.add_argument('--min-sim', type=float, default=0); ap.add_argument('--ids'); ap.add_argument('--long', type=int, default=1600)
    ap.add_argument('--sheet-name', default='contact_kept.jpg'); ap.add_argument('--drop-cache', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    cats = json.load(open(a.categories)) if a.categories else DEFAULT_CATEGORIES
    net = Net(a.work, a.rate, a.budget_mb, a.min_free_gb)
    report = []
    if a.cmd in ('fetch', 'all'):
        pp = os.path.join(a.work, 'posts.jsonl'); posts = jl_read(pp)
        jobs = [('x', h) for h in a.x] + [('status', s) for s in a.status] + [('tiktok', h) for h in a.tiktok] + [('url', u) for u in a.url]
        for kind, s in jobs:
            print(f'[{kind}] {s}', flush=True)
            try:
                if kind == 'x': n = mine_x(net, s.lstrip('@'), a.pages, ['media'] + (['statuses'] if a.statuses else []), posts, report)
                elif kind == 'status': n = mine_status(net, s, posts)
                elif kind == 'tiktok': n = mine_tiktok(net, s.lstrip('@'), a.pages, posts)
                else: n = mine_page(net, s, posts)
                report.append(f'{kind} {s}: {n} new posts')
            except Blocked as e:
                report.append(f'{kind} {s}: BLOCKED ({e}); stopped this source'); print('  blocked:', e)
            except Stop as e:
                report.append(f'STOP: {e}'); break
            jl_write(pp, posts)
        try:
            n = download(net, a.work, posts, a.frames, variant=a.scan_variant, photos_only=a.photos_only); report.append(f'downloaded {n} new scan copies')
        except (Stop, Blocked) as e:
            report.append(f'download stopped: {e}')
        write_index(a.work)
    if a.refetch:
        report.append(f'refetched {refetch(net, a.work, set(a.refetch))} items at small')
        write_index(a.work)
    if a.cmd in ('classify', 'all'):
        classify(a.work, cats, a.ref, machine_cats=a.machine_cats)
    if a.cmd in ('sheets', 'all'):
        for p in sheets(a.work, a.sheets_dir or os.path.join(a.work, 'sheets'), sort=a.sort): print('sheet', p)
    if a.cmd == 'keep':
        if not a.dest: sys.exit('--dest required')
        rows = keep(net, a.work, a.dest, a.cats, a.min_sim, a.ids, a.long, a.sheet_name, a.append, a.keep_variant)
        report.append(f'kept {len(rows)} -> {a.dest}')
        if a.drop_cache:
            shutil.rmtree(os.path.join(a.work, 'cache'), ignore_errors=True); report.append('cache dropped')
    if a.cmd == 'query':
        r = query(a.work, a.prompts, a.out or os.path.join(a.work, 'query'), a.top); report.append(f'query: ranked {len(r)}')
    if a.cmd == 'handles':
        handles(a.work)
    report.append(f'bytes used {net.bytes/1e6:.1f} MB of {a.budget_mb:.0f}; free disk {free_gb(a.work):.2f} GB')
    report += net.log[-20:]
    print('\n'.join(report))
    with open(os.path.join(a.work, 'run_log.txt'), 'a') as f:
        f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + ' '.join(sys.argv[1:]) + '\n  ' + '\n  '.join(report) + '\n')

if __name__ == '__main__':
    main()
