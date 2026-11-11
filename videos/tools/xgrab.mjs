import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
const p = await b.newPage();
try { await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 40000 }); await p.waitForTimeout(6000);
  console.log('TITLE', await p.title()); console.log((await p.innerText('body')).slice(0, 3000)); }
catch (e) { console.log('ERR', e.message.slice(0, 200)); }
await b.close();
