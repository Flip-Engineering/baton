// LAUNCH (8 Oct 2026): a Chromium launcher that prefers the GPU, for LOCAL tools only. NOT used by render.mjs: the homelab farm
// worker renders on its V100s by patching render.mjs's own `chromium.launch({ args: ['--use-angle=swiftshader', ...] })` lines, and
// it refuses any job whose render.mjs differs ("Renderer changed: adapter needs review"; 113c138 tripped it and was reverted, as
// 57ce879 was before). Never change those lines in render.mjs; the farm already renders on the GPU. Farm jobs carry no ACP_GPU prefix:
// the worker's only recipe is `sh videos/scripts/local_render.sh --seg SCENE:CLOSER_BEAT[:BPM]`.
//
// LAUNCH (8 Oct 2026): one place that starts Chromium for rendering. Every launcher used to hard-code SwiftShader (ANGLE's CPU
// WebGL), so even the farm's V100 rendered every scene on its CPU. Now the page renders on the GPU wherever there is one.
//
//   import { launchRender } from './lib/launch.mjs';
//   const { browser, renderer, gpu } = await launchRender(chromium);      // chromium: the caller's Playwright import
//
//   ACP_GPU=1  a hardware renderer is required: if every GPU path falls back to software, exit 78 (the farm's jobs set it, so
//              nothing renders on a CPU there by accident)
//   ACP_GPU=0  SwiftShader (CPU), explicitly
//   unset      the GPU if the machine has one (/dev/nvidia0 or a DRI render node), else SwiftShader
//   ACP_GPU_ARGS="--flag --flag"  try these Chromium args first (a farm whose driver stack wants something else)
// The renderer actually obtained is read back from WebGL (UNMASKED_RENDERER_WEBGL) and logged, never assumed.
import fs from 'node:fs';

const SW = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];
const COMMON = ['--ignore-gpu-blocklist', '--enable-gpu', '--enable-webgl', '--enable-gpu-rasterization'];
const TRIES = [                                                     // ANGLE on GL-EGL first: what the homelab V100s run (ANGLE_OPENGL_EGL, NVIDIA 580)
  { name: 'angle-gl-egl', args: ['--use-gl=angle', '--use-angle=gl-egl', ...COMMON] },
  { name: 'angle-vulkan', args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', ...COMMON] },
  { name: 'egl', args: ['--use-gl=egl', ...COMMON] },
  { name: 'angle-gl', args: ['--use-gl=angle', '--use-angle=gl', ...COMMON] },
];
export const hasGPU = () => ['/dev/nvidia0', '/dev/dri/renderD128'].some(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
const isSoft = r => !r || /swiftshader|llvmpipe|softpipe|software|basic render|none/i.test(r);

async function rendererOf(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return 'none';
      const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
  } finally { await page.close().catch(() => {}); }
}

export async function launchRender(chromium, { log = m => console.error(m) } = {}) {
  const want = process.env.ACP_GPU;
  if (want === '0' || (want !== '1' && !hasGPU())) {
    log(`launch: SwiftShader (CPU WebGL)${want === '0' ? ', ACP_GPU=0' : ', no GPU device on this machine'}`);
    return { browser: await chromium.launch({ args: SW }), renderer: 'SwiftShader', gpu: false };
  }
  const tries = process.env.ACP_GPU_ARGS ? [{ name: 'ACP_GPU_ARGS', args: process.env.ACP_GPU_ARGS.split(/\s+/).filter(Boolean) }, ...TRIES] : TRIES;
  const seen = [];
  for (const T of tries) for (const channel of [undefined, 'chromium']) {       // 'chromium': Playwright's full build in new-headless mode
    const tag = T.name + (channel ? '/' + channel : ''); let b = null;
    try {
      b = await chromium.launch({ args: T.args, ...(channel ? { channel } : {}) });
      const r = await rendererOf(b); seen.push(`${tag}: ${r}`);
      if (!isSoft(r)) { log(`launch: GPU via ${tag}: ${r}`); return { browser: b, renderer: r, gpu: true }; }
    } catch (e) { seen.push(`${tag}: ${String(e.message || e).split('\n')[0]}`); }
    try { if (b) await b.close(); } catch (e) { /* gone */ }
  }
  const msg = `launch: no hardware WebGL renderer (${seen.join(' | ')})`;
  if (want === '1') { log(`${msg}. ACP_GPU=1 requires the GPU: exit 78`); process.exit(78); }
  log(`${msg}. Falling back to SwiftShader (CPU WebGL)`);
  return { browser: await chromium.launch({ args: SW }), renderer: 'SwiftShader', gpu: false };
}
