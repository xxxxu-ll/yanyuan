import { Browser, sleep } from './cdp.mjs';
const b = await new Browser({ port: 9483 }).launch({ headless: true });
const p = await b.newPage('about:blank', { width: 1200, height: 760 });
await p.b.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 760, deviceScaleFactor: 2, mobile: false }, p.sessionId);
await p.goto('http://127.0.0.1:8787/yanyuan/?tile=1');
await sleep(1600);
await p.eval("document.getElementById('btnCreate').click()");
await sleep(200);
await p.eval(`(() => { const el=document.getElementById('inName'); el.value='砖'+Math.floor(Math.random()*9000+1000); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(650);
await p.eval("document.getElementById('btnEnter').click()");
await sleep(1900);
await p.eval("document.getElementById('codeOk').click()");
await sleep(1600);
await p.eval("window.__yanyuan.offerQuests = () => {}; document.getElementById('inviteCard').classList.add('hidden'); window.__yanyuan.hourOverride = 12");
const shots = [
  ['tile_wide', -20, 300, 0.55],
  ['tile_close', 60, 330, 1.0],
];
for (const [name, x, y, z] of shots) {
  await p.eval(`(() => { const g=window.__yanyuan; g.cam.zoom=${z}; g.me.x=${x}; g.me.y=${y}; g.cam.x=${x}; g.cam.y=${y}; })()`);
  await sleep(1000);
  await p.screenshot(`C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/shots/${name}.png`);
  console.log('shot', name);
}
await b.close();
