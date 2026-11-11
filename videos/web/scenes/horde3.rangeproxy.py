#!/usr/bin/env python3
"""rangeproxy.py: a local plain-http window onto one big remote file, so the static ffmpeg (which segfaults on https) can seek in it.
   python3 rangeproxy.py URL [port]   ->  ffmpeg -ss T -i http://127.0.0.1:PORT/f -t D ...   (only the bytes it seeks to are fetched)"""
import sys, requests, http.server, socketserver
URL = sys.argv[1]; PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
S = requests.Session()
SIZE = None
def size():
    global SIZE
    if SIZE is None:
        r = S.get(URL, headers={'Range': 'bytes=0-0'}, stream=True, timeout=60); SIZE = int(r.headers['Content-Range'].split('/')[1]); r.close()
    return SIZE
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def do_HEAD(self):
        self.send_response(200); self.send_header('Content-Length', str(size())); self.send_header('Accept-Ranges', 'bytes'); self.send_header('Content-Type', 'application/octet-stream'); self.end_headers()
    def do_GET(self):
        n = size(); rg = self.headers.get('Range'); a, b = 0, n - 1
        if rg:
            s, e = rg.replace('bytes=', '').split('-'); a = int(s) if s else n - int(e); b = int(e) if (e and s) else n - 1
        b = min(b, n - 1)
        try:
            r = S.get(URL, headers={'Range': 'bytes=%d-%d' % (a, b)}, stream=True, timeout=120)
            self.send_response(206 if rg else 200); self.send_header('Content-Length', str(b - a + 1)); self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, b, n)); self.end_headers()
            for c in r.iter_content(1 << 16): self.wfile.write(c)
        except (BrokenPipeError, ConnectionResetError): pass
class T(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True; allow_reuse_address = True
T(('127.0.0.1', PORT), H).serve_forever()
