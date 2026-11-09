// 场景截图工具：node tools/scene.mjs <名字> <x> <y> [hour] [zoom]
import { Browser, sleep } from './cdp.mjs';

const [name = 'scene', x = '0', y = '0', hour = '11', dpr = '1'] = process.argv.slice(2);
const OUT = 'C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/shots';
const URL = process.env.GAME_URL || 'http://127.0.0.1:8787/yanyuan/';

const b = await new Browser({ port: 9390 + Math.floor(Math.random() * 40) }).launch({ headless: true });
const p = await b.newPage('about:blank', { width: 1100, height: 700 });
await p.b.send('Emulation.setDeviceMetricsOverride',
  { width: 1100, height: 700, deviceScaleFactor: Number(dpr), mobile: false }, p.sessionId);
await p.goto(URL);
await sleep(1300);
await p.eval("document.getElementById('btnCreate').click()");
await sleep(200);
await p.eval(`(() => { const el=document.getElementById('inName'); el.value='看'+Math.floor(Math.random()*90000+10000); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(650);
await p.eval("document.getElementById('btnEnter').click()");
await sleep(1800);
await p.eval("document.getElementById('codeOk').click()");
await sleep(1500);
await p.eval("window.__yanyuan.offerQuests = () => {}; document.getElementById('inviteCard').classList.add('hidden')");
await p.eval(`window.__yanyuan.hourOverride = ${Number(hour)}`);
await p.eval(`(() => { const g=window.__yanyuan; g.me.x=${Number(x)}; g.me.y=${Number(y)}; g.cam.x=${Number(x)}; g.cam.y=${Number(y)}; })()`);
await sleep(900);
await p.screenshot(`${OUT}/${name}.png`);
console.log('shot', `${OUT}/${name}.png`);
await b.close();
