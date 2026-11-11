#!/usr/bin/env node
// SCENE LINT (8 Oct 2026): catch, before a farm post, the load-time errors a scene can only show on the farm (scenes cannot be loaded here:
// nothing renders locally). It parses the scene module and every relative module it imports, with no browser:
//   1. TDZ: a top-level const/let/class used while the module evaluates, before its declaration (a guard that read SOLID above
//      `const SOLID = ...` threw at load in NEVER VANQUISHED v2). Uses inside function bodies only count when the function is called at
//      top level before the declaration (immediately-invoked arrows/functions, and calls to top-level functions are followed).
//   2. IMPORTS: every `import { a } from './x.js'` names something x.js exports (export const/let/function/class/{ a as b }/export *).
//   2b. dynamic import('./x.js') of a literal path is followed like a static import (take wrappers: core_a.js only does `await import('./core.js')`).
//   2c. GLSL3: a file using GLSL3 / #version 300 es that writes gl_FragColor without declaring an output (compiles in a browser, not on the farm).
//   3. ASSETS: every string literal '../assets/...' (or `../assets/${...}` up to the first ${) points at an existing file or directory.
//   node videos/tools/scene_lint.mjs <scene> [<scene> ...]      (scene = name under videos/web/scenes, e.g. vanquished)   exit 1 on errors
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const espree = require('/opt/node22/lib/node_modules/eslint/node_modules/espree/dist/espree.cjs');

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web');
const SCENES = path.join(WEB, 'scenes');
const parse = src => espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', loc: true, range: true });
const lineOf = n => n.loc ? n.loc.start.line : 0;

function walk(node, fn, parent = null, inFn = 0) {      // fn(node, parent, depthInsideFunctions); skips nothing
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent, inFn);
  const fnNode = /Function/.test(node.type);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'parent') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && walk(c, fn, node, inFn + (fnNode ? 1 : 0)));
    else if (v && typeof v.type === 'string') walk(v, fn, node, inFn + (fnNode ? 1 : 0));
  }
}
// identifiers READ by an expression, evaluated now (not inside nested function bodies), plus functions it calls immediately.
// Scope-aware: names declared in a nested block, loop head, catch clause or an immediately-invoked function's params shadow top-level ones.
function patNames(p, out = []) { if (!p) return out; if (p.type === 'Identifier') out.push(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach(q => patNames(q.value || q.argument, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(e => patNames(e, out)); else if (p.type === 'RestElement') patNames(p.argument, out); else if (p.type === 'AssignmentPattern') patNames(p.left, out); return out; }
function blockDecls(stmts) { const out = []; for (const st of stmts || []) { if (st.type === 'VariableDeclaration') st.declarations.forEach(d => patNames(d.id, out));
  else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) out.push(st.id.name); } return out; }
function readsNow(node, topFns, seen = new Set(), init = []) {
  const out = [];
  const visit = (n, parent, local) => {
    if (!n || typeof n.type !== 'string') return;
    if (/Function/.test(n.type)) {
      const iife = parent && parent.type === 'CallExpression' && parent.callee === n;
      if (!iife) return;                                          // a function value: its body runs later
      const L = new Set(local); n.params.forEach(p => patNames(p, []).forEach(x => L.add(x)));
      visit(n.body, n, L); return;
    }
    if (n.type === 'BlockStatement' || n.type === 'StaticBlock') { const L = new Set(local); blockDecls(n.body).forEach(x => L.add(x)); n.body.forEach(c => visit(c, n, L)); return; }
    if (/^For(Of|In)?Statement$/.test(n.type)) { const L = new Set(local); const h = n.init || n.left; if (h && h.type === 'VariableDeclaration') h.declarations.forEach(d => patNames(d.id, []).forEach(x => L.add(x)));
      for (const k of ['init', 'test', 'update', 'left', 'right', 'body']) if (n[k]) visit(n[k], n, L); return; }
    if (n.type === 'CatchClause') { const L = new Set(local); patNames(n.param, []).forEach(x => L.add(x)); visit(n.body, n, L); return; }
    if (n.type === 'VariableDeclarator') { visit(n.init, n, local); return; }          // the binding pattern is not a read
    if (n.type === 'Identifier') {
      if (local.has(n.name)) return;
      if (parent && parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
      if (parent && (parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.key === n && !parent.computed && parent.value !== n) return;
      if (parent && (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement')) return;
      out.push(n);
      return;
    }
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && !local.has(n.callee.name) && topFns.has(n.callee.name) && !seen.has(n.callee.name)) {
      seen.add(n.callee.name); const f = topFns.get(n.callee.name);                     // the called function's params are its own names
      out.push(...readsNow(f.body, topFns, seen, f.params.flatMap(q => patNames(q, []))).map(i => Object.assign(i, { via: n.callee.name })));
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => visit(c, n, local)); else if (v && typeof v.type === 'string') visit(v, n, local);
    }
  };
  visit(node, null, new Set(init));
  return out;
}
function declaredNames(stmt) {
  const names = [];
  const pat = p => { if (!p) return; if (p.type === 'Identifier') names.push(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach(q => pat(q.value || q.argument)); else if (p.type === 'ArrayPattern') p.elements.forEach(pat); else if (p.type === 'RestElement') pat(p.argument); else if (p.type === 'AssignmentPattern') pat(p.left); };
  const s = stmt.type === 'ExportNamedDeclaration' && stmt.declaration ? stmt.declaration : stmt;
  if (s.type === 'VariableDeclaration' && s.kind !== 'var') s.declarations.forEach(d => pat(d.id));
  if (s.type === 'ClassDeclaration' && s.id) names.push(s.id.name);
  return names;
}
function exportsOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set(); seen.add(file);
  const ast = parse(fs.readFileSync(file, 'utf8')), out = new Set();
  for (const s of ast.body) {
    if (s.type === 'ExportNamedDeclaration') {
      if (s.declaration) { const d = s.declaration; if (d.id) out.add(d.id.name); if (d.declarations) d.declarations.forEach(x => x.id.type === 'Identifier' && out.add(x.id.name)); }
      for (const sp of s.specifiers || []) out.add(sp.exported.name || sp.exported.value);
    } else if (s.type === 'ExportDefaultDeclaration') out.add('default');
    else if (s.type === 'ExportAllDeclaration') {
      if (s.exported) out.add(s.exported.name);
      else if (s.source.value.startsWith('.')) { const f = path.resolve(path.dirname(file), s.source.value); if (fs.existsSync(f)) exportsOf(f, seen).forEach(x => out.add(x)); }
    }
  }
  return out;
}

function lintFile(file, errs, warns, done = new Set()) {
  if (done.has(file)) return; done.add(file);
  const src = fs.readFileSync(file, 'utf8'); let ast;
  try { ast = parse(src); } catch (e) { errs.push(`${file}:${e.lineNumber || '?'}: parse error: ${e.message}`); return; }
  const rel = path.relative(WEB, file);
  // top-level functions (hoisted) and lexical declarations with their order
  const topFns = new Map(), declAt = new Map();
  ast.body.forEach((s, i) => {
    const d = s.type === 'ExportNamedDeclaration' && s.declaration ? s.declaration : s;
    if (d.type === 'FunctionDeclaration' && d.id) topFns.set(d.id.name, d);
    for (const n of declaredNames(s)) declAt.set(n, i);
  });
  // 1. TDZ
  ast.body.forEach((s, i) => {
    const d = s.type === 'ExportNamedDeclaration' && s.declaration ? s.declaration : s;
    if (d.type === 'FunctionDeclaration' || d.type === 'ImportDeclaration') return;
    let target = d;
    if (d.type === 'ClassDeclaration') target = d.superClass || null;     // a class body's methods run later
    if (!target) return;
    for (const id of readsNow(target, topFns)) {
      const at = declAt.get(id.name);
      if (at !== undefined && at >= i && !(at === i && d.type !== 'VariableDeclaration')) {
        if (at === i) { // same statement: only an error if read inside its own initializer before the binding completes
          const decl = (d.declarations || []).find(x => declaredNames({ type: 'VariableDeclaration', kind: 'const', declarations: [x] }).includes(id.name));
          if (!decl || !decl.init || !(decl.init.range[0] <= id.range[0] && id.range[1] <= decl.init.range[1])) continue;
        }
        errs.push(`${rel}:${lineOf(id)}: '${id.name}' is read while the module loads (statement at line ${lineOf(s)}${id.via ? `, via ${id.via}()` : ''}) before its declaration at line ${lineOf(ast.body[at])} (TDZ: throws at load)`);
      }
    }
  });
  // 2. IMPORTS
  for (const s of ast.body) {
    if (s.type !== 'ImportDeclaration' || !s.source.value.startsWith('.') && !s.source.value.startsWith('/')) continue;
    const f = s.source.value.startsWith('/') ? s.source.value : path.resolve(path.dirname(file), s.source.value);
    if (!fs.existsSync(f)) { errs.push(`${rel}:${lineOf(s)}: import '${s.source.value}': no such file`); continue; }
    if (!/\.m?js$/.test(f)) continue;
    let ex; try { ex = exportsOf(f); } catch (e) { warns.push(`${rel}:${lineOf(s)}: could not parse ${path.relative(WEB, f)} for its exports (${e.message})`); continue; }
    for (const sp of s.specifiers) {
      if (sp.type === 'ImportNamespaceSpecifier') continue;
      const name = sp.type === 'ImportDefaultSpecifier' ? 'default' : (sp.imported.name || sp.imported.value);
      if (!ex.has(name)) errs.push(`${rel}:${lineOf(sp)}: '${name}' is not exported by ${path.relative(WEB, f)}`);
    }
    if (f.startsWith(WEB) && !f.includes('node_modules')) lintFile(f, errs, warns, done);
  }
  // 2b. DYNAMIC IMPORTS: `await import('./core.js')` (a take wrapper such as core_a.js) loads that module too: it must exist and be linted.
  walk(ast, n => {
    if (n.type !== 'ImportExpression' || !n.source || n.source.type !== 'Literal' || typeof n.source.value !== 'string') return;
    if (!n.source.value.startsWith('.') && !n.source.value.startsWith('/')) return;
    const f = n.source.value.startsWith('/') ? n.source.value : path.resolve(path.dirname(file), n.source.value);
    if (!fs.existsSync(f)) { errs.push(`${rel}:${lineOf(n)}: import('${n.source.value}'): no such file`); return; }
    if (/\.m?js$/.test(f) && f.startsWith(WEB) && !f.includes('node_modules')) lintFile(f, errs, warns, done);
  });
  // 2c. GLSL3 OUTPUT (15 Oct): three leaves the fragment output undeclared when glslVersion is GLSL3 (and for raw `#version 300 es`),
  // so gl_FragColor is an undeclared identifier on strict drivers (the farm's ANGLE/NVIDIA; every devplate program failed). Browsers
  // and software GL forgive it. Per file: GLSL3/#version 300 es present, gl_FragColor written, no `out vec4` or `#define gl_FragColor`.
  {
    const src = fs.readFileSync(file, 'utf8');
    if (/GLSL3|#version\s+300\s+es/.test(src) && /\bgl_FragColor\b/.test(src) && !/#define\s+gl_FragColor\b|\bout\s+(?:(?:highp|mediump|lowp)\s+)?vec4\b/.test(src)) {
      const ln = src.slice(0, src.search(/\bgl_FragColor\b/)).split('\n').length;
      errs.push(`${rel}:${ln}: GLSL3 / #version 300 es shader writes gl_FragColor but the file never declares a fragment output (add 'layout(location = 0) out highp vec4 pc_fragColor; #define gl_FragColor pc_fragColor'): fails to compile on the farm`);
    }
  }
  // 3. ASSETS (literal paths under ../assets/ resolved from the scene directory, the way the page fetches them)
  walk(ast, (n, parent) => {
    let v = null;
    if (n.type === 'Literal' && typeof n.value === 'string') v = n.value;
    else if (n.type === 'TemplateLiteral' && n.quasis.length) v = n.quasis[0].value.cooked;
    if (!v || !/^\.\.\/(\.\.\/)?assets\//.test(v)) return;
    const metaUrl = parent && parent.type === 'NewExpression' && parent.callee.name === 'URL' && parent.arguments[0] === n && parent.arguments[1] && parent.arguments[1].type === 'MemberExpression' && parent.arguments[1].object.type === 'MetaProperty';
    const face = parent && parent.type === 'CallExpression' && parent.callee.name === 'loadFace' && parent.arguments[0] === n;   // type.js resolves from @fontsource/
    const base = face ? path.join(WEB, 'node_modules', '@fontsource') : metaUrl ? path.dirname(file) : SCENES;                                        // fetch() resolves against the page, new URL(x, import.meta.url) against the module
    let p = path.resolve(base, v);
    if (n.type === 'TemplateLiteral' && n.quasis.length > 1) p = path.dirname(p + 'x');            // up to the first ${...}: its directory must exist
    if (!fs.existsSync(p)) errs.push(`${rel}:${lineOf(n)}: asset path '${v}' does not exist (${path.relative(WEB, p)})`);
  });
}

const scenes = process.argv.slice(2);
if (!scenes.length) { console.error('usage: scene_lint.mjs <scene> [...]'); process.exit(2); }
let bad = 0;
for (const sc of scenes) {
  const name = sc.replace(/\.(js|html)$/, ''), html = path.join(SCENES, name + '.html'), errs = [], warns = [];
  // the page decides what runs: lint every module script it loads (mecha_up.html loads mecha.js); without a page, <name>.js
  let mods = [];
  if (fs.existsSync(html)) {
    const h = fs.readFileSync(html, 'utf8');
    mods = [...h.matchAll(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/g)].map(m => path.resolve(SCENES, m[1]));
    if (!mods.length && /<script[^>]*type=["']module["'][^>]*>[^<]*import/.test(h)) warns.push(`scenes/${name}.html: inline module script not linted`);
  } else errs.push(`scenes/${name}.html: missing (render.mjs loads the scene through its HTML)`);
  if (!mods.length && fs.existsSync(path.join(SCENES, name + '.js'))) mods = [path.join(SCENES, name + '.js')];
  if (!mods.length) { console.log(`${sc}: no module to lint`); if (!fs.existsSync(html)) bad++; continue; }
  for (const f of mods) { if (!fs.existsSync(f)) errs.push(`scenes/${name}.html: module ${path.relative(WEB, f)} does not exist`); else lintFile(f, errs, warns); }
  console.log(`${sc}: ${errs.length ? errs.length + ' error(s)' : 'ok'}${warns.length ? `, ${warns.length} warning(s)` : ''}`);
  for (const e of errs) console.log('  ERROR ' + e);
  for (const w of warns) console.log('  warn  ' + w);
  if (errs.length) bad++;
}
process.exit(bad ? 1 : 0);
