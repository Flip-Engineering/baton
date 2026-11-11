// Shared import map for scenes (classic script; include it in <head> BEFORE any module script):
//   <script src="../lib/importmap.js"></script>
// Adds three, d3-geo (+ d3-array, internmap) and topojson-client. Extend with window.EXTRA_IMPORTS = {...} set earlier.
(() => {
  const nm = '../node_modules/';
  const imports = {
    three: nm + 'three/build/three.module.js',
    'three/addons/': nm + 'three/examples/jsm/',
    'd3-geo': nm + 'd3-geo/src/index.js',
    'd3-array': nm + 'd3-array/src/index.js',
    internmap: nm + 'internmap/src/index.js',
    'topojson-client': nm + 'topojson-client/src/index.js',
    ...(window.EXTRA_IMPORTS || {}),
  };
  const s = document.createElement('script'); s.type = 'importmap'; s.textContent = JSON.stringify({ imports });
  document.currentScript.after(s);
})();
