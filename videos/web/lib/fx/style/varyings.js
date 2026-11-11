// STYLE c4: how many varying vectors a material's program uses, read from the program the GL actually compiled (any lane's
// chained patches included). SwiftShader (and every WebGL2 minimum) allows 15; past it the program fails to link and three draws
// nothing for that mesh (the body silently stops drawing). A check for any new shader path:
//   import { programVaryings } from '/web/lib/fx/style/varyings.js';
//   renderer.render(scene, camera);                         // compile first (the pass the material is used in)
//   programVaryings(renderer, P.h.body.material)  // -> { linked, rows, max, list: [[type, name, count], ...] }
// rows follow GLSL ES 3.00's packing (vec4 a row; vec3 a row with one column left for a float; two vec2 a row; floats fill the
// spare columns); `flat` varyings counted like the others. A preprocessor resolves three's #ifdef / #if blocks first.

function preprocess(src) {
  const defs = new Map(), out = [], stack = [];
  const active = () => stack.every(s => s.on);
  const evalIf = e => {
    let x = e.replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, n) => (defs.has(n) ? '1' : '0')).replace(/defined\s+(\w+)/g, (_, n) => (defs.has(n) ? '1' : '0'));
    x = x.replace(/[A-Za-z_]\w*/g, n => { const v = defs.get(n); return v != null && v !== '' && /^[\d.\s()+\-*/]+$/.test(v) ? '(' + v + ')' : (defs.has(n) ? '1' : '0'); });
    try { return !!Function('return (' + x + ');')(); } catch { return false; }
  };
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*#\s*(\w+)\s*(.*)$/);
    if (!m) { if (active()) out.push(line); continue; }
    const [, d, rest] = m;
    if (d === 'ifdef' || d === 'ifndef') { const has = defs.has(rest.trim()); const on = d === 'ifdef' ? has : !has; stack.push({ on, taken: on }); }
    else if (d === 'if') { const on = active() && evalIf(rest); stack.push({ on, taken: on }); }
    else if (d === 'elif') { const s = stack[stack.length - 1]; if (s.taken) s.on = false; else { s.on = evalIf(rest); s.taken = s.on; } }
    else if (d === 'else') { const s = stack[stack.length - 1]; s.on = !s.taken; s.taken = true; }
    else if (d === 'endif') stack.pop();
    else if (!active()) continue;
    else if (d === 'define') { const mm = rest.match(/^(\w+)\s*(.*)$/); if (mm) defs.set(mm[1], mm[2].trim()); }
    else if (d === 'undef') defs.delete(rest.trim());
  }
  return { code: out.join('\n'), defs };
}
const SIZE = { float: 1, vec2: 2, vec3: 3, vec4: 4, int: 1, ivec2: 2, ivec3: 3, ivec4: 4, uint: 1, mat2: 4, mat3: 9, mat4: 16 };
export function countVaryings(vsrc) {
  const { code, defs } = preprocess(vsrc), list = [], attrs = [];
  let depth = 0;
  for (const st of code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split(/(?<=[;{}])/)) {
    const s = st.trim();
    if (depth === 0) { const m = s.match(/^(?:(?:flat|smooth|centroid|invariant)\s+)*(?:varying|out)\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;{}]+);$/);
      if (m && SIZE[m[1]]) for (let n of m[2].split(',')) { n = n.trim(); const a = n.match(/^(\w+)\s*\[\s*([^\]]+)\]$/); let cnt = 1, nm = n;
        if (a) { nm = a[1]; const v = defs.get(a[2].trim()); cnt = +(v ?? a[2]) || 1; } list.push([m[1], nm, cnt]); }
      const q = s.match(/^(?:attribute|in)\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;{}]+);$/);
      if (q && SIZE[q[1]]) for (const n of q[2].split(',')) attrs.push(q[1] + ' ' + n.trim()); }
    for (const ch of s) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  }
  // rows by the packing rules
  let rows = 0, spare1 = 0, n2 = 0, n1 = 0;
  for (const [t, , c] of list) { const z = SIZE[t];
    if (t === 'mat3') { rows += 3 * c; spare1 += 3 * c; } else if (t === 'mat4') rows += 4 * c; else if (t === 'mat2') rows += 2 * c;
    else if (z === 4) rows += c; else if (z === 3) { rows += c; spare1 += c; } else if (z === 2) n2 += c; else n1 += c; }
  rows += Math.ceil(n2 / 2); let spare2 = n2 % 2 ? 2 : 0;
  const f1 = Math.min(n1, spare1); n1 -= f1; const f2 = Math.min(n1, spare2); n1 -= f2; rows += Math.ceil(n1 / 4);
  return { rows, list, attrs };
}
// the program three compiled for a material (after a render that used it)
export function programVaryings(renderer, material) {
  const gl = renderer.getContext(), pr = renderer.properties.get(material)?.currentProgram;
  if (!pr) return null;
  const prog = pr.program, vs = gl.getAttachedShaders(prog).find(s => gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.VERTEX_SHADER);
  const { rows, list, attrs } = countVaryings(gl.getShaderSource(vs)), linked = !!gl.getProgramParameter(prog, gl.LINK_STATUS);
  return { linked, rows, max: gl.getParameter(gl.MAX_VARYING_VECTORS), list: list.map(([t, n, c]) => c > 1 ? `${t} ${n}[${c}]` : `${t} ${n}`),
    attributes: attrs.length, maxAttributes: gl.getParameter(gl.MAX_VERTEX_ATTRIBS), attrs, log: linked ? '' : (gl.getProgramInfoLog(prog) || '').slice(0, 300) };
}
