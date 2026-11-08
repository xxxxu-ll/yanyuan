// 生成用于验收的展示截图（白天/黄昏/夜晚、地图、手册、手机）
import { Browser, sleep } from './cdp.mjs';
import { mkdir } from 'node:fs/promises';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8787/yanyuan/';
const OUT = 'C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/shots';

const b = await new Browser({ port: 9340 }).launch({ headless: true });
const page = await b.newPage('about:blank');

async function tele(x, y) {
  await page.eval(`(() => { const g = window.__yanyuan; g.me.x=${x}; g.me.y=${y}; g.cam.x=${x}; g.cam.y=${y}; })()`);
  await sleep(400);
}
async function shot(name) {
  await sleep(500);
  await page.screenshot(`${OUT}/${name}.png`);
  console.log('shot', name);
}

try {
  await mkdir(OUT, { recursive: true });
  await page.goto(URL);
  await sleep(1200);
  await page.eval("document.getElementById('btnCreate').click()");
  await sleep(200);
  await page.eval(`(() => {
    const el = document.getElementById('inName');
    el.value = '林小满' + Math.floor(Math.random()*90+10);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const top = document.querySelectorAll('#styleRows .swatch-group')[3].querySelectorAll('.swatch');
    top[2].click();
    document.getElementById('btnEnter').click();
  })()`);
  await sleep(1600);
  await page.eval("document.getElementById('codeOk').click()");
  await sleep(1800);
  console.log('started:', await page.eval('!!window.__yanyuan'));
  console.log('lamps:', await page.eval('window.__yanyuan.world.lamps.length'));

  await page.eval("window.__yanyuan.hourOverride = 10.5");
  await tele(-140, 190);
  await shot('day_jingyuan');

  await tele(-150, -120);
  await shot('day_lake');

  await tele(20, 250);
  await shot('day_library');

  await tele(-460, -140);
  await shot('day_westgate');

  await tele(-380, 120);
  await shot('day_shao');

  await page.eval("window.__yanyuan.hourOverride = 18.2");
  await tele(-120, 60);
  await shot('dusk');

  await page.eval("window.__yanyuan.hourOverride = 21.2");
  await tele(-20, 240);
  await shot('night_library');

  await tele(-150, -110);
  await shot('night_lake');

  // 手册
  await page.eval("window.__yanyuan.openJournal()");
  await sleep(600);
  await page.screenshot(`${OUT}/journal.png`);
  console.log('shot journal');
  await page.eval("document.getElementById('journalClose').click()");

  // 地图
  await page.eval("window.__yanyuan.openMap()");
  await sleep(800);
  await page.screenshot(`${OUT}/map.png`);
  console.log('shot map');
  await page.eval("document.getElementById('mapClose').click()");

  // 手机
  await page.b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, page.sessionId);
  await page.b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, page.sessionId);
  await sleep(800);
  await page.eval("window.__yanyuan.hourOverride = 15.5");
  await tele(-120, -100);
  await shot('mobile');

  if (page.errors.length) {
    console.log('errors:');
    for (const e of page.errors.slice(0, 6)) console.log(' !', e.split('\n')[0]);
  }
} catch (e) {
  console.error('失败:', e.message);
  for (const er of page.errors.slice(0, 6)) console.error(' !', er.split('\n')[0]);
} finally {
  await b.close();
}
