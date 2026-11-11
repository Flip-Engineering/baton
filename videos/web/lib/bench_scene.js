// FARM BENCH (TOOLING, 3 Oct): a normal 1080x1920 scene whose frames are lab views, so the homelab farm (which renders
// exactly one recipe: local_render.sh --seg SCENE:CLOSER) can shoot lab stills on its V100s. research/capabilities/farm_bench.md.
//
// A bench is two files: web/scenes/bench_<name>.html (the generic stub below calls bench(name)) and its plate list
// web/assets/bench/<name>.json, both written and committed by scripts/farm_bench.py:
//   { "name": "cloth_c1", "repeat": 3, "plates": [ { "tag": "row_hard", "lab": "labs/clothing1/lab_cloth.html",
//       "query": "light=hard&mode=row&cloth=1&drape=0&w=2160&h=1200", "w": 2160, "h": 1200, "warm": 0, "t": 0,
//       "caption": "...", "ready_s": 300, "transfer": "readpixels" }, ... ] }
// Each plate's lab loads in a same-origin iframe (one at a time; the previous one is dropped so WebGL contexts never pile
// up), waits for window.sceneReady (or sceneError), runs `warm` frames renderFrame(t - i/30, true), then renderFrame(t), and
// its #out canvas is copied into a plate image. A plate larger than the frame's picture area (1080 x 1888) is split into
// TILES shown on consecutive frames (2160x1200 -> two 1080x1200 tiles), never scaled. Every tile is shown `repeat` frames.
// Frame layout (stateless: frame i always shows the same thing, whichever worker renders it and whatever came before):
//   y 0..15      ID strip: 37 blocks of 24 px, black/white: sync 101101 | plate 8 | tile 6 | tiles 6 | status 3 | check 8
//   y 16..       the tile, 1:1 at x = 0 (tile = plate pixels [x0,x1) x [y0,y1), see tiles() below)
//   below it     a human caption (not extracted)
//   y 1904..1919 TIMING strip: sync 101101 | ready 0.1 s 14 | render 0.01 s 12 | check 8  (this worker's own load/render)
// After the last plate, tail frames (plate 255, status 7) run to the end; the closer beat lands after the last plate.
// status: 0 ok, 1 sceneError, 2 ready timeout, 3 renderFrame threw, 4 #out size differs from w x h (drawn 1:1, cropped/padded),
//         5 no readable #out, 7 tail. scripts/farm_bench.py decodes the strips and reassembles the tiles.
// WebGL -> Canvas2D: by default ("transfer": "readpixels") the lab's 2D drawImage of a WebGL canvas is replaced, inside the
// iframe only, by an explicit gl.readPixels copy (the farm worker found GPU Chromium can drop draws on that path; its MAJORITY
// fix was the same explicit pixel transfer). "transfer": "drawimage" leaves the lab's code path untouched.
// Beat maps (GRAPHICS 4.0, 8 Oct): a scene plate whose code loads its beats by literal name (loadBeats('everydollar') ->
// out/.everydollar.hits.json) would 404 on the farm, which has no out/.*.hits.json but the bench's own. farm_bench.py copies
// each such file to web/assets/bench/<name>/<scene>.hits.json and lists it in "hits": { "<scene>": "assets/bench/..." }; the
// iframe's fetch of /out/.<scene>.hits.json (or of a variant's /out/.<scene>__ab_<tag>.hits.json) is sent there. No "hits":
// fetch is left alone, as before.
export const W = 1080, H = 1920, FPS = 30, STRIP = 16, AW = 1080, AH = H - 2 * STRIP, BLOCK = 24;
export const SYNC = [1, 0, 1, 1, 0, 1];

// the tile grid of a w x h plate: nx x ny even tiles of at most AW x AH (scripts/farm_bench.py tiles() is the same rule)
export function tiles(w, h) {
  const nx = Math.ceil(w / AW), ny = Math.ceil(h / AH), tw = Math.ceil(w / nx), th = Math.ceil(h / ny), out = [];
  for (let ky = 0; ky < ny; ky++) for (let kx = 0; kx < nx; kx++) {
    const x0 = kx * tw, y0 = ky * th; out.push({ x0, y0, x1: Math.min(w, x0 + tw), y1: Math.min(h, y0 + th) });
  }
  return out;
}

// frame index -> { p, k } (plate, tile) or null (tail); the same table farm_bench.py builds
export function frameTable(list) {
  const R = Math.max(1, list.repeat || 3), rows = [];
  list.plates.forEach((pl, p) => tiles(pl.w, pl.h).forEach((_, k) => { for (let r = 0; r < R; r++) rows.push({ p, k }); }));
  return rows;
}

const bits = (v, n) => Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1);
export const idCheck = (p, k, n, s) => (p * 7 + k * 13 + n * 29 + s * 53 + 101) & 255;
export const timeCheck = (r, m) => (r * 3 + m * 11 + 57) & 255;
function strip(g, y, vals) {
  g.fillStyle = '#808080'; g.fillRect(0, y, W, STRIP);
  vals.forEach((b, i) => { g.fillStyle = b ? '#ffffff' : '#000000'; g.fillRect(i * BLOCK, y, BLOCK, STRIP); });
}

// WebGL contexts the lab creates are recorded on their canvas (getContext patched in the iframe as soon as its document exists)
function hookRealm(win) {
  try {
    const C = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
    if (!C || C.__benchHooked) return !!C;
    const gc = C.getContext;
    C.getContext = function (type, ...a) { const c = gc.call(this, type, ...a); if (c && /webgl/.test(type)) this.__benchGL = c; return c; };
    C.__benchHooked = true;
    return true;
  } catch (e) { return false; }
}
// the plate's fetch of a beat map the bench carries (list.hits) goes to the bench's copy; true once hooked (or nothing to hook)
function hookFetch(win, hits) {
  try {
    if (!hits || !Object.keys(hits).length) return true;
    if (!win.fetch) return false;
    if (win.fetch.__benchHits) return true;
    const f0 = win.fetch.bind(win);
    const fx = (u, ...a) => {
      if (typeof u === 'string' || u instanceof win.URL || u instanceof URL) {
        const m = String(u).match(/\/out\/\.([a-z0-9_]+)\.hits\.json(?=$|[?#])/);
        const to = m && (hits[m[1]] || hits[m[1].replace(/__ab_[a-z0-9_]+$/, '')]);
        if (to) u = '/web/' + to;
      }
      return f0(u, ...a);
    };
    fx.__benchHits = true;
    win.fetch = fx;
    return true;
  } catch (e) { return false; }
}
// an explicit copy of a WebGL canvas's drawing buffer into a fresh 2D canvas of `doc` (null when it can't)
function glToCanvas(gl, doc, win) {
  try {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, gl2 = gl.READ_FRAMEBUFFER !== undefined;
    if (!w || !h || (gl.isContextLost && gl.isContextLost())) return null;
    const RB = gl2 ? gl.READ_FRAMEBUFFER : gl.FRAMEBUFFER, prevFB = gl.getParameter(gl2 ? gl.READ_FRAMEBUFFER_BINDING : gl.FRAMEBUFFER_BINDING);
    const prevPB = gl2 ? gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) : null;
    const pk = gl2 ? [gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS].map(e => [e, gl.getParameter(e)]) : [];
    const al = gl.getParameter(gl.PACK_ALIGNMENT);
    gl.bindFramebuffer(RB, null); if (prevPB) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    for (const [e] of pk) gl.pixelStorei(e, 0); gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(RB, prevFB); if (prevPB) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPB);
    for (const [e, v] of pk) gl.pixelStorei(e, v); gl.pixelStorei(gl.PACK_ALIGNMENT, al);
    const attr = gl.getContextAttributes() || {}, pre = attr.premultipliedAlpha !== false, opaque = attr.alpha === false;
    const id = new win.ImageData(w, h), d = id.data, row = w * 4;
    for (let y = 0; y < h; y++) {                               // readPixels is bottom-up
      const s = (h - 1 - y) * row, o = y * row;
      for (let i = 0; i < row; i += 4) {
        const a = opaque ? 255 : px[s + i + 3];
        if (pre && a && a < 255) { d[o + i] = Math.min(255, Math.round(px[s + i] * 255 / a)); d[o + i + 1] = Math.min(255, Math.round(px[s + i + 1] * 255 / a)); d[o + i + 2] = Math.min(255, Math.round(px[s + i + 2] * 255 / a)); }
        else { d[o + i] = px[s + i]; d[o + i + 1] = px[s + i + 1]; d[o + i + 2] = px[s + i + 2]; }
        d[o + i + 3] = a;
      }
    }
    const c = doc.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(id, 0, 0);
    return c;
  } catch (e) { console.warn('[bench] readPixels transfer failed, using drawImage:', e.message); return null; }
}
function patchTransfer(win) {
  const P = win.CanvasRenderingContext2D && win.CanvasRenderingContext2D.prototype;
  if (!P || P.__benchTransfer) return;
  const di = P.drawImage;
  P.drawImage = function (src, ...a) {
    const gl = src && src.__benchGL;
    if (gl && gl.drawingBufferWidth === src.width && gl.drawingBufferHeight === src.height) {
      const c = glToCanvas(gl, win.document, win);
      if (c) return di.call(this, c, ...a);
    }
    return di.call(this, src, ...a);
  };
  P.__benchTransfer = true;
}

export async function bench(name) {
  const out = document.getElementById('out'), g = out.getContext('2d');
  const list = await (await fetch(`/web/assets/bench/${name}.json`)).json();
  const R = Math.max(1, list.repeat || 3), rows = frameTable(list), P = list.plates.length;
  window.DURATION = rows.length / FPS + 2;                                 // the farm draws to the song's span; tail frames after
  window.sceneInfo = { DUR: window.DURATION, bench: name, plates: P, frames: rows.length, repeat: R };
  const stats = list.plates.map(() => null);
  let cur = null;                                                         // { p, img (w x h 2D canvas), status, msg, readyMs, renderMs }
  let frame = null;                                                       // the live iframe (one at a time)

  const drop = () => { if (frame) { try { frame.src = 'about:blank'; } catch (e) { /* gone */ } frame.remove(); frame = null; } };
  async function load(p) {
    drop();
    const pl = list.plates[p], t0 = performance.now(), img = document.createElement('canvas');
    img.width = pl.w; img.height = pl.h;
    const ig = img.getContext('2d'); ig.fillStyle = '#202020'; ig.fillRect(0, 0, pl.w, pl.h);
    const res = { p, img, status: 0, msg: '', readyMs: 0, renderMs: 0, size: null };
    const f = document.createElement('iframe');
    f.className = 'bench'; f.width = pl.w; f.height = pl.h;
    f.style.cssText = `position:absolute;left:0;top:0;width:${pl.w}px;height:${pl.h}px;border:0;z-index:0`;
    f.src = `/web/${pl.lab}${pl.query ? '?' + pl.query : ''}`;
    document.body.appendChild(f); frame = f;
    // record WebGL contexts from the lab's first line: hook the iframe's realm now (Chromium keeps the initial about:blank
    // window for a same-origin load) and again as soon as the lab's document replaces about:blank (if it brought a new realm)
    try { hookRealm(f.contentWindow); hookFetch(f.contentWindow, list.hits); } catch (e) { /* polled below */ }
    let hooked = false;
    const hook = setInterval(() => { try { const w = f.contentWindow; if (w && w.location.href !== 'about:blank' && hookRealm(w) && hookFetch(w, list.hits)) { hooked = true; clearInterval(hook); } } catch (e) { /* not yet */ } }, 2);
    const limit = (pl.ready_s || 300) * 1000;
    const why = await new Promise(ok => {
      const iv = setInterval(() => {
        let w = null; try { w = f.contentWindow; } catch (e) { /* detached */ }
        if (w && w.sceneError) { clearInterval(iv); ok({ status: 1, msg: String(w.sceneError) }); }
        else if (w && w.location.href !== 'about:blank' && w.sceneReady === true) { clearInterval(iv); ok(null); }
        else if (performance.now() - t0 > limit) { clearInterval(iv); ok({ status: 2, msg: `no sceneReady after ${limit / 1000} s` }); }
      }, 50);
    });
    clearInterval(hook);
    res.readyMs = performance.now() - t0;
    if (why) Object.assign(res, why);
    else {
      const w = f.contentWindow, t1 = performance.now();
      try {
        if (pl.transfer !== 'drawimage') { if (!hooked) hookRealm(w); patchTransfer(w); }
        const t = +pl.t || 0;
        for (let i = +pl.warm || 0; i > 0; i--) await w.renderFrame(Math.max(0, t - i / FPS), true);
        await w.renderFrame(t);
        const src = w.document.getElementById('out');
        const c2 = src && src.getContext('2d');                         // null when #out holds a WebGL context
        let pic = null;
        if (c2) { const id = c2.getImageData(0, 0, src.width, src.height); pic = document.createElement('canvas'); pic.width = src.width; pic.height = src.height; pic.getContext('2d').putImageData(id, 0, 0); }
        else if (src) { const gl = src.__benchGL || src.getContext('webgl2') || src.getContext('webgl'); pic = gl ? glToCanvas(gl, document, window) : null; }
        if (!pic) Object.assign(res, { status: 5, msg: 'no readable #out canvas' });
        else {
          res.size = [pic.width, pic.height];
          if (pic.width !== pl.w || pic.height !== pl.h) Object.assign(res, { status: 4, msg: `#out is ${pic.width}x${pic.height}, the plate says ${pl.w}x${pl.h}` });
          ig.drawImage(pic, 0, 0);
        }
      } catch (e) { Object.assign(res, { status: 3, msg: String(e && e.stack || e).slice(0, 400) }); }
      res.renderMs = performance.now() - t1;
    }
    drop();
    if (res.status && res.status !== 4) {                                 // the reason, readable in the plate itself
      ig.fillStyle = '#5a1010'; ig.fillRect(0, 0, pl.w, pl.h); ig.fillStyle = '#fff'; ig.font = '28px monospace';
      const words = `BENCH PLATE ${p} ${pl.tag}: status ${res.status}: ${res.msg}`.split(/\s+/); let line = '', y = 60;
      for (const wd of words) { if ((line + ' ' + wd).length > Math.floor(pl.w / 17)) { ig.fillText(line, 30, y); y += 36; line = wd; } else line = line ? line + ' ' + wd : wd; }
      ig.fillText(line, 30, y);
    }
    stats[p] = { tag: pl.tag, status: res.status, msg: res.msg, readyMs: Math.round(res.readyMs), renderMs: Math.round(res.renderMs), size: res.size, hooked };
    console.log(`[bench] plate ${p} ${pl.tag}: status ${res.status}${res.msg ? ' (' + res.msg.split('\n')[0] + ')' : ''}, ready ${(res.readyMs / 1000).toFixed(1)} s, render ${(res.renderMs / 1000).toFixed(2)} s`);
    return res;
  }

  window.renderFrame = async t => {
    const i = Math.round(t * FPS), row = rows[i];
    g.fillStyle = '#101010'; g.fillRect(0, 0, W, H);
    g.font = '26px monospace';
    if (!row) {
      strip(g, 0, [...SYNC, ...bits(255, 8), ...bits(0, 6), ...bits(0, 6), ...bits(7, 3), ...bits(idCheck(255, 0, 0, 7), 8)]);
      strip(g, H - STRIP, [...SYNC, ...bits(0, 14), ...bits(0, 12), ...bits(timeCheck(0, 0), 8)]);
      g.fillStyle = '#888'; g.fillText(`bench ${name}: ${P} plate(s) done; the closer frames are not plates`, 30, 200);
      return;
    }
    if (!cur || cur.p !== row.p) cur = await load(row.p);
    const pl = list.plates[row.p], T = tiles(pl.w, pl.h), tl = T[row.k], tw = tl.x1 - tl.x0, th = tl.y1 - tl.y0;
    g.drawImage(cur.img, tl.x0, tl.y0, tw, th, 0, STRIP, tw, th);
    const rd = Math.min(16383, Math.round(cur.readyMs / 100)), rm = Math.min(4095, Math.round(cur.renderMs / 10));
    strip(g, 0, [...SYNC, ...bits(row.p, 8), ...bits(row.k, 6), ...bits(T.length, 6), ...bits(cur.status, 3), ...bits(idCheck(row.p, row.k, T.length, cur.status), 8)]);
    strip(g, H - STRIP, [...SYNC, ...bits(rd, 14), ...bits(rm, 12), ...bits(timeCheck(rd, rm), 8)]);
    const free = H - STRIP - (STRIP + th);
    if (free > 90) {                                                      // a caption for people watching the share copy
      g.fillStyle = '#ddd'; let y = STRIP + th + 44;
      const lines = [`${row.p + 1}/${P} ${pl.tag}  tile ${row.k + 1}/${T.length}  ${pl.w}x${pl.h}  status ${cur.status}`,
        `ready ${(cur.readyMs / 1000).toFixed(1)} s  render ${(cur.renderMs / 1000).toFixed(2)} s  ${pl.lab}`, ...String(pl.caption || '').match(/.{1,64}(\s|$)/g) || []];
      for (const s of lines) { if (y > H - STRIP - 20) break; g.fillText(s.trim(), 30, y); y += 34; }
    }
  };
  window.benchReport = () => ({ name, repeat: R, frames: rows.length, plates: stats });
  window.sceneReady = true;
}
