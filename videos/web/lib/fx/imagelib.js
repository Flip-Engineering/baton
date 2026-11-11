// IMAGELIB: the licensed image library, seen from a scene.
//
//   import { lib } from '../lib/fx/imagelib.js';
//   const L = await lib();                          // reads videos/sources/library/manifest.json once
//   const img  = await L.image('client_own_future');           // the photo (HTMLImageElement)
//   const cut  = await L.plate('client_own_future');           // { img, cut, nrm, depth, clean, box, size, row }
//   L.credit('client_own_future')                              // 'ACP · Client-supplied (...)' for the credits card
//   L.find('human')                                            // ids tagged 'human' that may be composited
//
// Rows whose licence says 'reference only' / 'inspiration only' (the Turrell photo, the thermal upload) are refused:
// they can inform a look but never enter a frame. Everything is fetched by URL relative to videos/, so the render
// server serves it without changes. Derived plates come from videos/tools/imagelib/prep.py and quilt.py.
const ROOT = new URL('../../../sources/library/', import.meta.url);
const imgCache = new Map();
const load = src => {
  if (!imgCache.has(src)) imgCache.set(src, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagelib: cannot load ' + src)); i.src = src; }));
  return imgCache.get(src);
};

let _lib = null;
export async function lib() {
  if (_lib) return _lib;
  const man = await (await fetch(new URL('manifest.json', ROOT))).json();
  const row = id => {
    const r = man[id]; if (!r) throw new Error(`imagelib: '${id}' is not in the manifest (fetch.py / import it first)`);
    if (r.composite === false) throw new Error(`imagelib: '${id}' is reference-only (${r.licence})`);
    return r;
  };
  _lib = {
    manifest: man,
    row,
    url: (id, kind) => new URL(kind ? row(id).derived[kind] : row(id).file, ROOT).href,
    image: id => load(new URL(row(id).file, ROOT).href),
    async plate(id) {
      const r = row(id), d = r.derived || {};
      const get = k => d[k] ? load(new URL(d[k], ROOT).href) : null;
      const [img, cut, nrm, depth, clean, plate] = await Promise.all([load(new URL(r.file, ROOT).href), get('cut'), get('nrm'), get('depth'), get('clean'), get('plate')]);
      return { img: plate || img, cut, nrm, depth, clean, box: d.box, size: d.size, row: r };
    },
    texture: (id, kind) => load(new URL(row(id).derived[kind], ROOT).href),
    find: tag => Object.keys(man).filter(k => man[k].composite !== false && (man[k].tags || []).includes(tag)),
    credit: id => { const r = row(id); return `${r.credit} · ${r.licence}`; },
  };
  return _lib;
}
