// 手动调试：启动一个真实浏览器，创建角色、移动、取景截图
import { Browser, sleep } from './cdp.mjs';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8787/yanyuan/';
const DIR = 'C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data';

const b = await new Browser({ port: 9334 }).launch({ headless: true });
const page = await b.newPage('about:blank');

async function shot(name) {
  await sleep(500);
  await page.screenshot(`${DIR}/_${name}.png`);
  console.log('  截图:', name);
}

async function teleport(x, y) {
  await page.eval(`(() => { const g = window.__yanyuan; g.me.x = ${x}; g.me.y = ${y}; g.cam.x = ${x}; g.cam.y = ${y}; })()`);
}

try {
  console.log('→ 打开', URL);
  await page.goto(URL);
  await sleep(1200);
  await page.eval("document.getElementById('btnCreate').click()");
  await sleep(200);
  await page.eval(`(() => {
    const el = document.getElementById('inName');
    el.value = '测试' + Math.floor(Math.random()*9000+1000);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await page.eval("document.getElementById('btnEnter').click()");
  await sleep(1400);
  await page.eval("document.getElementById('codeOk').click()");
  await sleep(1800);

  const ok = await page.eval("!!window.__yanyuan");
  console.log('game started:', ok);
  if (!ok) throw new Error('游戏未启动');

  await page.eval("window.__yanyuan.hourOverride = 11");
  console.log('trees:', await page.eval("window.__yanyuan.world.trees.length"));
  console.log('buildings:', await page.eval("window.__yanyuan.world.buildings.length"));
  await sleep(600);
  await shot('spawn');

  // 未名湖畔 + 博雅塔
  await teleport(-150, -110);
  await shot('lake');

  // 图书馆前
  await teleport(-6, 210);
  await shot('library');

  // 西门
  await teleport(-430, -145);
  await shot('westgate');

  // 五四体育场
  await teleport(230, 600);
  await shot('sport');

  // 夜晚
  await page.eval("window.__yanyuan.hourOverride = 21.5");
  await teleport(-100, -140);
  await shot('night');

  // 碰撞检查
  const col = await page.eval(`(() => {
    const g = window.__yanyuan, w = g.world;
    const b = w.buildings.find(b => b.area > 500);
    const cx = (b.bbox[0]+b.bbox[2])/2, cy = (b.bbox[1]+b.bbox[3])/2;
    return {
      building: b.name, insideBlocked: w.blocked(cx, cy, 0.5),
      waterBlocked: w.blocked(w.water.find(x=>x.name==='未名湖').label[0], w.water.find(x=>x.name==='未名湖').label[1], 0.5),
      spawnBlocked: w.blocked(-158, 178, 0.5),
      bridgeOk: w.onBridge ? true : null,
    };
  })()`);
  console.log('碰撞检查:', JSON.stringify(col));

  // 性能
  const perf = await page.eval(`(async () => {
    const g = window.__yanyuan;
    const t0 = performance.now();
    let n = 0;
    await new Promise(res => {
      function tick() { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else res(); }
      requestAnimationFrame(tick);
    });
    return { fps: Math.round(n / ((performance.now()-t0)/1000)), frameTime: g.frameTime };
  })()`);
  console.log('性能:', JSON.stringify(perf));

  if (page.errors.length) {
    console.log('--- 页面错误 ---');
    for (const e of page.errors.slice(0, 12)) console.log(' !', e.split('\n')[0]);
  }
} catch (e) {
  console.error('失败:', e.message);
  if (page.errors.length) for (const er of page.errors.slice(0, 10)) console.error(' !', er.split('\n')[0]);
  await page.screenshot(`${DIR}/_err.png`).catch(() => {});
} finally {
  await b.close();
}
