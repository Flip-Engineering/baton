#!/usr/bin/env python3
"""rangeproxy.py: a local plain-http window onto ONE big remote file, so ffmpeg can seek in it reading only the bytes it needs (TOOLING c19, from HORDE v15).

    python3 videos/tools/rangeproxy.py URL [--port 8765]        # serves http://127.0.0.1:PORT/f until Ctrl-C; prints bytes fetched on exit
    from rangeproxy import RangeProxy
    with RangeProxy(url) as p:                                   # port 0 = any free port
        subprocess.run([ffmpeg, '-ss', '600', '-i', p.local_url, '-t', '5', ...]); print(p.bytes_fetched, p.size)

Why: the bundled static ffmpeg segfaults on https through the agent proxy, and an mp4/mov keeps its index (moov) at one end, so a plain byte-range cut cannot work.
Through this window ffmpeg's own demuxer reads the index, then seeks: a 5 s cut of a 2.5 GB original reads tens of MB. Fetches are in aligned 1 MiB blocks with a small
cache (ffmpeg re-reads the index area many times), retried on error, over `requests` (so HTTPS_PROXY and redirects work). One file per proxy; read-only; binds 127.0.0.1 only.
"""
import argparse, collections, http.server, socketserver, sys, threading, time
import requests

BLOCK = 1 << 20

class RangeProxy:
    def __init__(self, url, port=0, cache_blocks=96, timeout=90, tries=5, session=None):
        self.url, self.timeout, self.tries = url, timeout, tries
        self.S = session or requests.Session(); self.size = None; self.bytes_fetched = 0; self.requests = 0
        self._cache = collections.OrderedDict(); self._cap = cache_blocks; self._lock = threading.Lock()
        outer = self
        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *a): pass
            def _head(self, code, a, b, n):
                self.send_response(code); self.send_header('Content-Length', str(b - a + 1)); self.send_header('Accept-Ranges', 'bytes'); self.send_header('Content-Type', 'application/octet-stream')
                if code == 206: self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, b, n))
                self.end_headers()
            def do_HEAD(self): n = outer._size(); self._head(200, 0, n - 1, n)
            def do_GET(self):
                n = outer._size(); rg = self.headers.get('Range'); a, b = 0, n - 1
                if rg:
                    s, e = rg.replace('bytes=', '').split('-')[:2]; a = int(s) if s else max(0, n - int(e)); b = int(e) if (e and s) else n - 1
                b = min(b, n - 1)
                if a > b: self.send_response(416); self.send_header('Content-Range', 'bytes */%d' % n); self.send_header('Content-Length', '0'); self.end_headers(); return
                try:
                    self._head(206 if rg else 200, a, b, n); pos = a
                    while pos <= b:
                        blk = pos // BLOCK; d = outer._block(blk); lo = pos - blk * BLOCK; hi = min(len(d), b - blk * BLOCK + 1)
                        self.wfile.write(d[lo:hi]); pos = blk * BLOCK + hi
                except (BrokenPipeError, ConnectionResetError): pass
                except Exception as e: sys.stderr.write('rangeproxy: %s: %s\n' % (type(e).__name__, e)); self.close_connection = True
        class T(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True; allow_reuse_address = True
        self.srv = T(('127.0.0.1', port), H); self.port = self.srv.server_address[1]; self.thread = None

    @property
    def local_url(self): return 'http://127.0.0.1:%d/f' % self.port

    def _get(self, a, b):
        err = None
        for k in range(self.tries):
            try:
                r = self.S.get(self.url, headers={'Range': 'bytes=%d-%d' % (a, b)}, timeout=self.timeout)
                if r.status_code == 416: return b'', None
                if r.status_code != 206: raise IOError('server answered %d (no byte-range support?)' % r.status_code)
                self.requests += 1; self.bytes_fetched += len(r.content); return r.content, r.headers.get('Content-Range')
            except Exception as e: err = e; time.sleep(1.5 * (k + 1))
        raise IOError('fetch %d-%d failed: %s' % (a, b, err))

    def _size(self):
        if self.size is None:
            _, cr = self._get(0, 0)
            if not cr or '/' not in cr or cr.endswith('/*'): raise IOError('server did not give a total size')
            self.size = int(cr.split('/')[1])
        return self.size

    def _block(self, i):
        with self._lock:
            if i in self._cache: self._cache.move_to_end(i); return self._cache[i]
        a = i * BLOCK; d, _ = self._get(a, min(a + BLOCK, self._size()) - 1)
        with self._lock:
            self._cache[i] = d
            while len(self._cache) > self._cap: self._cache.popitem(last=False)
        return d

    def start(self):
        self._size(); self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True); self.thread.start(); return self
    def stop(self): self.srv.shutdown(); self.srv.server_close()
    def __enter__(self): return self.start()
    def __exit__(self, *a): self.stop()

def selftest():
    import os, random, threading
    data = random.Random(3).randbytes(5 * BLOCK + 12345)
    class U(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            a, b = self.headers['Range'].replace('bytes=', '').split('-'); a, b = int(a), min(int(b), len(data) - 1); d = data[a:b + 1]
            self.send_response(206); self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, b, len(data))); self.send_header('Content-Length', str(len(d))); self.end_headers(); self.wfile.write(d)
    up = http.server.ThreadingHTTPServer(('127.0.0.1', 0), U); threading.Thread(target=up.serve_forever, daemon=True).start()
    with RangeProxy('http://127.0.0.1:%d/x' % up.server_address[1]) as p:
        g = lambda rg: requests.get(p.local_url, headers={'Range': rg} if rg else {}).content
        assert g('bytes=100-199') == data[100:200] and g('bytes=%d-%d' % (BLOCK - 5, BLOCK + 5)) == data[BLOCK - 5:BLOCK + 6]
        assert g('bytes=-50') == data[-50:] and g(None) == data and p.size == len(data)
        n = p.requests; g('bytes=100-199'); assert p.requests == n, 'cache miss'
        assert requests.head(p.local_url).headers['Content-Length'] == str(len(data))
    up.shutdown(); print('selftest ok')

def main():
    if '--selftest' in sys.argv: return selftest()
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); ap.add_argument('url'); ap.add_argument('--port', type=int, default=8765); a = ap.parse_args()
    p = RangeProxy(a.url, a.port).start(); print('%s  (%.1f MB)  ffmpeg -ss T -i %s -t D ...' % (a.url, p.size / 1e6, p.local_url), flush=True)
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt: print('fetched %.1f MB in %d requests' % (p.bytes_fetched / 1e6, p.requests))

if __name__ == '__main__': main()
