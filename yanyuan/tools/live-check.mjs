// 线上画面验收：加载、进入、走动、截图、报错检查
import { Browser, sleep } from './cdp.mjs';

const URL = process.env.GAME_URL || 'https://xxxxu-ll.github.io/yanyuan/';
const OUT = 'C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/shots';
const b = await new Browser({ port: 9350 }).launch({ headless: true });
const page = await b.newPage('about:blank');

async function press(key, code, vk, ms) {
  await page.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, page.sessionId);
  await sleep(ms);
  await page.b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, page.sessionId);
}

try {
  await page.goto(URL);
  await sleep(1500);
  const createBtn = await page.eval("!!document.getElementById('btnCreate')");
  console.log('页面元素:', createBtn);
  if (!createBtn) {
    console.log('页面内容前 400 字:', await page.eval('document.body.innerHTML.slice(0,400)'));
    throw new Error('首页没渲染出创建按钮');
  }
  await page.eval("document.getElementById('btnCreate').click()");
  await sleep(300);
  const name = '像素' + Math.floor(Math.random() * 9000 + 1000);
  await page.eval(`(() => { const el = document.getElementById('inName'); el.value = ${JSON.stringify(name)}; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(800);
  await page.eval("document.getElementById('btnEnter').click()");
  await sleep(2200);
  await page.eval("document.getElementById('codeOk').click()");
  await sleep(1800);
  console.log('进入游戏:', await page.eval('!!window.__yanyuan'));
  await page.eval("window.__yanyuan.hourOverride = 10.5");
  await sleep(400);
  await page.screenshot(`${OUT}/live_spawn.png`);
  console.log('shot live_spawn');

  await press('d', 'KeyD', 68, 900);
  await sleep(500);
  const moved = await page.eval('window.__yanyuan.me.x');
  console.log('移动后 x =', moved);

  await page.eval("(()=>{const g=window.__yanyuan; g.me.x=-150; g.me.y=-115; g.cam.x=-150; g.cam.y=-115;})()");
  await sleep(600);
  await page.screenshot(`${OUT}/live_lake.png`);
  console.log('shot live_lake');

  await page.eval("(()=>{const g=window.__yanyuan; g.me.x=-6; g.me.y=232; g.cam.x=-6; g.cam.y=232;})()");
  await sleep(700);
  await page.screenshot(`${OUT}/live_library.png`);
  console.log('shot live_library');

  console.log('帧时间:', await page.eval('window.__yanyuan.frameTime'));
  if (page.errors.length) {
    console.log('--- 页面错误 ---');
    for (const e of page.errors.slice(0, 8)) console.log(' !', e.split('\n')[0]);
  } else {
    console.log('无页面错误');
  }
} catch (e) {
  console.error('失败:', e.message);
  for (const er of page.errors.slice(0, 8)) console.error(' !', er.split('\n')[0]);
  await page.screenshot(`${OUT}/live_err.png`).catch(() => {});
} finally {
  await b.close();
}
