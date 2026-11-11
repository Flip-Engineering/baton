"""Remove elapsed-time render failure gates without editing pinned source files."""
import json

WEBGL_FAILURE_GUARD = """const farmWebGLFailure = detail => {
  const error = new Error('WebGL context lost: ' + JSON.stringify(detail));
  error.name = 'FarmWebGLContextLost';
  farmPageError(error);
};
page.on('console', message => {
  if (/GL_CONTEXT_LOST_KHR|Unexpected driver error/.test(message.text()))
    farmWebGLFailure({source:'browser-console', message:message.text()});
});
await page.exposeBinding('__farmWebGLContextFailure', ({frame}, detail) =>
  farmWebGLFailure({...detail, frame:frame.url()}));
await page.addInitScript(() => {
  const observed = new WeakSet(), intentional = new WeakSet();
  const hook = prototype => {
    if (!prototype) return;
    const getContext = prototype.getContext;
    prototype.getContext = function(type, ...args) {
      const gl = getContext.call(this, type, ...args);
      if (!gl || !/^(webgl2?|experimental-webgl)$/.test(type) || observed.has(gl)) return gl;
      observed.add(gl);
      const canvas = this;
      canvas.addEventListener('webglcontextlost', event => {
        if (intentional.has(gl)) return;
        void window.__farmWebGLContextFailure({source:'canvas-event', type,
          width:canvas.width, height:canvas.height, status:event.statusMessage || ''}).catch(() => {});
      });
      // Three.js releases temporary renderer contexts explicitly.
      const getExtension = gl.getExtension;
      gl.getExtension = function(name) {
        const extension = getExtension.call(this, name);
        if (extension && name === 'WEBGL_lose_context' && !extension.__farmObserved) {
          const lose = extension.loseContext.bind(extension);
          extension.loseContext = () => { intentional.add(gl); return lose(); };
          extension.__farmObserved = true;
        }
        return extension;
      };
      canvas.addEventListener('webglcontextrestored', () => intentional.delete(gl));
      return gl;
    };
  };
  hook(window.HTMLCanvasElement?.prototype);
  hook(window.OffscreenCanvas?.prototype);
});
"""

def add_webgl_guard(source):
    source = replace_once(source, "page.on('pageerror', farmPageError);\n",
                          "page.on('pageerror', farmPageError);\n" + WEBGL_FAILURE_GUARD)
    return replace_once(source, "} catch (error) {\n  if (!farmSceneError) {",
                        "if (farmSceneError) throw farmSceneError;\n} catch (error) {\n  if (!farmSceneError) {")

SCRIPT_FAILURE_GUARD = "await page.exposeBinding('__farmScriptLoadFailure', ({frame}, detail) => {\n  if (frame !== page.mainFrame()) return;\n  const missing = farmHttpFailures.filter(item => item.resource_type === 'script' && item.status >= 400);\n  farmPageError(new Error('Scene script failed to load: ' + detail.source +\n    (missing.length ? '; HTTP failures: ' + missing.map(item => item.status + ' ' + item.url).join(', ') : '')));\n});\nawait page.addInitScript(() => {\n  window.addEventListener('error', event => {\n    const target = event.target;\n    if (!target || target.tagName !== 'SCRIPT') return;\n    const source = target.src || location.href + '#inline-module';\n    window.sceneError = new Error('Scene script failed to load: ' + source);\n    void window.__farmScriptLoadFailure({source}).catch(() => {});\n  }, true);\n});\n"

def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError('Timing-policy source anchor changed; review required: ' + old[:90])
    return source.replace(old, new, 1)

def apply(source, bench=None):
    profile_wrapper = "await runWithCleanup(async () => {" in source
    if profile_wrapper and source.count("}, async () => {\n  if (cpuProfile) {") != 1:
        raise RuntimeError('Profiler cleanup source anchor changed; review required')
    start = source.index('// 2. a render slot')
    end = source.index('// 3. browser', start)
    source = source[:start] + ("// Farm rendering has no elapsed-time failure gate or slot expiry.\n"
        "const R = { browser: null, enc: null, slot: null };\n"
        "const progress = what => { R.what = what; };\n\n") + source[end:]
    source = replace_once(source, "  channel: 'chromium',", "  channel: 'chromium',\n  timeout: 0,")
    source = replace_once(source, "const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });",
        "const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });\n"
        "page.setDefaultTimeout(0);\npage.setDefaultNavigationTimeout(0);")
    source = replace_once(source, "{ timeout: Number(process.env.ACP_READY_MS) || 120000 }", "{ timeout: 0 }")
    source = replace_once(source, "quality: 93, timeout: 600000", "quality: 93, timeout: 0")
    # A fatal browser exception is semantic failure, independent of elapsed time.
    # Closing its page interrupts readiness, navigation, and capture promises.
    fatal = """let farmSceneError = null;
let farmStage = 'loading';
const farmBrowserExceptions = [];
const farmHttpFailures = [];
page.on('response', response => {
  if (response.status() >= 400) farmHttpFailures.push({status:response.status(),url:response.url(),resource_type:response.request().resourceType()});
});
const farmRuntime = await page.context().newCDPSession(page);
const farmFailureFile = path.join(OUT, `homelab-${process.env.ACP_GPU_LABEL || 'cpu'}-scene-failure.json`);
const farmSaveError = () => {
  if (!farmSceneError) return;
  try { fs.writeFileSync(farmFailureFile, JSON.stringify({schema:1,scene,commit:fs.readFileSync(path.join(ROOT,'..','.git','HEAD'),'utf8').trim(),phase:farmStage,
    worker:{label:process.env.ACP_GPU_LABEL,uuid:process.env.ACP_EXPECTED_GPU_UUID},
    error:{name:farmSceneError.name,message:farmSceneError.message,stack:farmSceneError.stack},
    browser_exceptions:farmBrowserExceptions,http_failures:farmHttpFailures}, null, 2)); } catch (error) { console.error('[FARM_DIAGNOSTICS_ERROR]', error.message); }
};
farmRuntime.on('Runtime.exceptionThrown', ({exceptionDetails}) => {farmBrowserExceptions.push(exceptionDetails);farmSaveError();});
await farmRuntime.send('Runtime.enable');
const farmPageError = error => {
  if (farmSceneError) return;
  farmSceneError = error;
  console.error('[FARM_FATAL_PAGEERROR]', JSON.stringify({name:error.name, message:error.message, stack:error.stack}));
  farmSaveError();
  void page.close().catch(() => {});
};
page.on('pageerror', farmPageError);
try {
"""
    fatal = fatal.replace("page.on('pageerror', farmPageError);\ntry {", "page.on('pageerror', farmPageError);\n" + SCRIPT_FAILURE_GUARD + ("" if profile_wrapper else "try {"))
    source = replace_once(source, "page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exitCode = 1; });", fatal)
    if profile_wrapper:
        source = replace_once(source, "await runWithCleanup(async () => {\n", "await runWithCleanup(async () => {\ntry {\n")
        cleanup_anchor = "}, async () => {\n  if (cpuProfile) {"
        source = replace_once(source, cleanup_anchor, """} catch (error) {
  if (!farmSceneError) {
    farmSceneError = error;
    console.error('[FARM_RENDER_FAILURE]', JSON.stringify({name:error.name,message:error.message,stack:error.stack}));
  }
  throw farmSceneError;
} finally {
  farmSaveError();
  page.off('pageerror', farmPageError);
  if (R.enc && R.enc.exitCode === null && R.enc.signalCode === null) {
    R.enc.stdin.on('error', () => {});
    R.enc.stdin.end();
    await new Promise(resolve => R.enc.once('close', resolve));
  }
}
}, async () => {
  if (cpuProfile) {""")
    else:
        source = replace_once(source, "await browser.close();\nserver.close();", """} catch (error) {
  if (!farmSceneError) {
    farmSceneError = error;
    console.error('[FARM_RENDER_FAILURE]', JSON.stringify({name:error.name,message:error.message,stack:error.stack}));
  }
  throw farmSceneError;
} finally {
  farmSaveError();
  page.off('pageerror', farmPageError);
  if (R.enc && R.enc.exitCode === null && R.enc.signalCode === null) {
    R.enc.stdin.on('error', () => {});
    R.enc.stdin.end();
    await new Promise(resolve => R.enc.once('close', resolve));
  }
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}""")
    source = replace_once(source, "await page.waitForFunction(() => window.sceneReady === true", "farmStage = 'readiness';\nawait page.waitForFunction(() => window.sceneReady === true")
    source = replace_once(source, "const canvas = await page.$('#out');", "farmStage = 'frames';\nconst canvas = await page.$('#out');")
    if bench is not None:
        bench = replace_once(bench, "    const limit = (pl.ready_s || 300) * 1000;", "    // Wait for readiness or an explicit scene error; elapsed time is not failure.")
        bench = replace_once(bench, "        else if (performance.now() - t0 > limit) { clearInterval(iv); ok({ status: 2, msg: `no sceneReady after ${limit / 1000} s` }); }", "")
        anchor = "await page.goto(`"
        route = "await page.route('**/web/lib/bench_scene.js', route => route.fulfill({contentType: 'text/javascript', body: " + json.dumps(bench) + "}));\n"
        source = replace_once(source, anchor, route + anchor)
    # Remove obsolete documentation and the unused watchdog exit code.
    source = source.replace("const EXIT_STALL = 75;                           // watchdog exit code (EX_TEMPFAIL): retryable, nothing is wrong with the piece\n", "")
    lines = source.splitlines(keepends=True)
    source = ''.join(line for line in lines if not ('--stall-min M' in line or 'for M minutes the render closes' in line))
    return add_webgl_guard(source)
