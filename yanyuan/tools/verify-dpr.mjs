// 高分屏验收：devicePixelRatio > 1 时画面必须铺满整块画布
import { Browser, sleep } from './cdp.mjs';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8787/yanyuan/';
const OUT = 'C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/shots';
const results = [];
const check = (n, ok, d = '') => { results.push({ ok }); console.log(`${ok ? '  ✔' : '  ✘'} ${n}${d ? ' — ' + d : ''}`); };

const b = await new Browser({ port: 9380 }).launch({ headless: true });

for (const dpr of [1, 1.25, 1.5, 2]) {
  const page = await b.newPage('about:blank', { width: 1280, height: 800 });
  await page.b.send('Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 800, deviceScaleFactor: dpr, mobile: dpr >= 2 }, page.sessionId);
  await page.goto(URL);
  await sleep(1300);
  await page.eval("document.getElementById('btnCreate').click()");
  await sleep(200);
  await page.eval(`(() => { const el = document.getElementById('inName'); el.value = 'dpr'+${dpr}+Math.floor(Math.random()*90+10); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(700);
  await page.eval("document.getElementById('btnEnter').click()");
  await sleep(1800);
  await page.eval("document.getElementById('codeOk').click()");
  await sleep(1500);
  await page.eval("window.__yanyuan.hourOverride = 12");
  await sleep(400);

  const probe = await page.eval(`(() => {
    const c = document.getElementById('game');
    const g = c.getContext('2d');
    const pts = [];
    for (const fx of [0.05, 0.5, 0.95]) {
      for (const fy of [0.1, 0.5, 0.9]) {
        const d = g.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
        pts.push([Math.round(d[0]), Math.round(d[1]), Math.round(d[2])]);
      }
    }
    return { w: c.width, h: c.height, dpr: window.devicePixelRatio, low: [window.__yanyuan.low.width, window.__yanyuan.low.height], pts };
  })()`);
  const black = probe.pts.filter(p => p[0] < 12 && p[1] < 12 && p[2] < 12);
  check(`dpr=${dpr} 画面铺满（无黑块）`, black.length === 0, `${probe.w}x${probe.h} low=${probe.low.join('x')} 黑点=${black.length}`);
  if (dpr === 1.5) await page.screenshot(`${OUT}/dpr15.png`);
  if (dpr === 2) await page.screenshot(`${OUT}/dpr2.png`);
  await page.close();
}

await b.close();
const ok = results.filter(r => r.ok).length;
console.log(`\n通过 ${ok}/${results.length}`);
if (ok !== results.length) process.exitCode = 1;
