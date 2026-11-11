import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const urls = process.argv.slice(2);
const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
const ctx = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 1200, height: 1600 } });
for (const [i, u] of urls.entries()) {
  const p = await ctx.newPage();
  const imgs = [];
  p.on('response', async r => { const ct = r.headers()['content-type'] || ''; if (ct.startsWith('image/') || ct.startsWith('video/')) imgs.push([r.url(), ct, r.status()]); });
  try { await p.goto(u, { waitUntil: 'networkidle', timeout: 60000 }); } catch (e) { console.log('ERR', e.message.slice(0, 200)); }
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `shot${i}.png` });
  console.log(u, 'title:', await p.title());
  console.log(imgs.slice(0, 20).map(x => x.join(' ')).join('\n'));
}
await browser.close();
