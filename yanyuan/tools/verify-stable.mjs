// 镜头像素对齐验收：静止时同一世界坐标的屏幕位置必须逐帧完全一致
import { Browser, sleep } from './cdp.mjs';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8787/yanyuan/';
const results = [];
const check = (n, ok, d = '') => { results.push({ ok }); console.log(`${ok ? '  ✔' : '  ✘'} ${n}${d ? ' — ' + d : ''}`); };

const b = await new Browser({ port: 9406 }).launch({ headless: true });
const p = await b.newPage('about:blank', { width: 1100, height: 700 });
await p.b.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false }, p.sessionId);
await p.goto(URL);
await sleep(1300);
await p.eval("document.getElementById('btnCreate').click()");
await sleep(200);
await p.eval(`(() => { const el=document.getElementById('inName'); el.value='稳'+Math.floor(Math.random()*90000+10000); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(650);
await p.eval("document.getElementById('btnEnter').click()");
await sleep(1800);
await p.eval("document.getElementById('codeOk').click()");
await sleep(1500);
await p.eval("window.__yanyuan.offerQuests = () => {}; document.getElementById('inviteCard').classList.add('hidden'); window.__yanyuan.hourOverride = 11");
await sleep(2200);   // 让镜头收敛

const probe = `(() => {
  const g = window.__yanyuan, c = g.cam;
  return {
    x: +c.x.toFixed(4),
    sx: +c.sx(-77).toFixed(4),
    sy: +c.sy(88).toFixed(4),
    px: +(c.x * c.scale).toFixed(4),
  };
})()`;

const idle = [];
for (let i = 0; i < 8; i++) { idle.push(await p.eval(probe)); await sleep(140); }
const same = idle.every(v => v.x === idle[0].x && v.sx === idle[0].sx && v.sy === idle[0].sy);
check('静止时镜头不再漂移', same, same ? `${idle[0].x}` : idle.map(v => v.x).join(','));
const aligned = idle.every(v => Number.isInteger(Math.round(v.px * 1000) / 1000));
check('镜头落在整数像素上', aligned, `cam.x*scale = ${idle[0].px}`);

// 走路：镜头必须单调前进，且每帧都是整数像素
await p.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 }, p.sessionId);
const move = [];
for (let i = 0; i < 8; i++) { const v = await p.eval(probe); move.push(v.px); await sleep(110); }
await p.b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 }, p.sessionId);
const mono = move.every((v, i) => i === 0 || v >= move[i - 1] - 0.001);
const ints = move.every(v => Number.isInteger(Math.round(v)));
check('行走时镜头单调前进', mono, move.map(v => v.toFixed(2)).join(' '));
check('行走时仍是整数像素', ints);

await b.close();
const ok = results.filter(r => r.ok).length;
console.log(`\n通过 ${ok}/${results.length}`);
if (ok !== results.length) process.exitCode = 1;
