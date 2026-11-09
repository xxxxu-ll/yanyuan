import { Browser, sleep } from './cdp.mjs';
const b = await new Browser({ port: 9491 }).launch({ headless: true });
const p = await b.newPage('about:blank', { width: 1200, height: 760 });
await p.b.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 760, deviceScaleFactor: 2, mobile: false }, p.sessionId);
await p.goto('http://127.0.0.1:8787/yanyuan/?tile=1');
await sleep(1600);
const t0 = Date.now();
await p.eval("document.getElementById('btnCreate').click()");
await sleep(250);
await p.eval(`(() => { const el=document.getElementById('inName'); el.value='全图'+Math.floor(Math.random()*900+100); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(700);
await p.eval("document.getElementById('btnEnter').click()");
await sleep(2600);
await p.eval("(() => { const el=document.getElementById('codeOk'); if (el && el.offsetParent) el.click(); })()");
await sleep(2200);
await p.eval("window.__yanyuan.offerQuests = () => {}; const c=document.getElementById('inviteCard'); if (c) c.classList.add('hidden'); window.__yanyuan.hourOverride = 12");
// 未名湖 + 五四操场两处全图取景
for (const [name, x, y, z] of [['tile_map_lake', -80, -120, 0.35], ['tile_map_west', -380, 120, 0.4]]) {
  await p.eval(`(() => { const g=window.__yanyuan; g.cam.zoom=${z}; g.me.x=${x}; g.me.y=${y}; g.cam.x=${x}; g.cam.y=${y}; })()`);
  await sleep(1200);
  await p.screenshot(`C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/shots/${name}.png`);
  console.log('shot', name);
}
const fps = await p.eval("(() => { const g=window.__yanyuan; return Math.round(g.__fps || 0); })()");
console.log('elapsed load ms:', Date.now() - t0, 'fps:', fps);
await b.close();
