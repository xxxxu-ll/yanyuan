// 第 10 轮验收：导航可达点、探索判定、输入焦点、存档状态、里程统计
import { Browser, sleep } from './cdp.mjs';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8787/yanyuan/';
const OUT = 'C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/shots';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ' — ' + detail : ''}`);
};

const b = await new Browser({ port: 9360 }).launch({ headless: true });
const page = await b.newPage('about:blank');

async function key(k, code, vk) {
  await page.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, page.sessionId);
  await sleep(80);
  await page.b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, page.sessionId);
}

try {
  await page.goto(URL);
  await sleep(1400);
  await page.eval("document.getElementById('btnCreate').click()");
  await sleep(200);
  const name = '验收' + Math.floor(Math.random() * 9000 + 1000);
  await page.eval(`(() => { const el = document.getElementById('inName'); el.value = ${JSON.stringify(name)}; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(700);
  await page.eval("document.getElementById('btnEnter').click()");
  await sleep(2000);
  await page.eval("document.getElementById('codeOk').click()");
  await sleep(1600);
  check('进入游戏', await page.eval('!!window.__yanyuan'));

  console.log('\n【1】导航终点 = 可达点');
  const nav = await page.eval(`(() => {
    const g = window.__yanyuan, w = g.world;
    const lib = w.landmarks.find(l => l.name === '北京大学图书馆' && !l.aliasOf);
    const wp = w.waypointFor(lib);
    return {
      labelBlocked: w.blocked(lib.x, lib.y, 0.6),
      approachBlocked: w.blocked(wp.x, wp.y, 0.6),
      moved: lib.moved,
      distToCentre: Math.hypot(wp.x - lib.x, wp.y - lib.y),
    };
  })()`);
  check('图书馆中心在建筑内（不可站立）', nav.labelBlocked === true);
  check('导航终点可站立', nav.approachBlocked === false, `距中心 ${nav.distToCentre.toFixed(0)}m`);
  check('可达点确实绕开了建筑', nav.moved > 20, `moved=${nav.moved}`);

  console.log('\n【2】站在门口就能完成探索');
  const disc = await page.eval(`(async () => {
    const g = window.__yanyuan, w = g.world;
    const lib = w.landmarks.find(l => l.name === '北京大学图书馆' && !l.aliasOf);
    const wp = w.waypointFor(lib);
    g.me.x = wp.x; g.me.y = wp.y; g.cam.x = wp.x; g.cam.y = wp.y;
    await new Promise(r => setTimeout(r, 1200));
    return {
      visited: !!g.progress.visited['北京大学图书馆'],
      min: w.nearbyLandmarks(wp.x, wp.y, 30).map(l => l.name).slice(0, 5),
    };
  })()`);
  check('把角色放到可达点后记录到图书馆', disc.visited === true, disc.min.join('、'));

  console.log('\n【3】打字时不该触发游戏快捷键');
  await page.eval("window.__yanyuan.openMap()");
  await sleep(500);
  await page.eval("document.getElementById('mapSearch').focus()");
  await sleep(200);
  for (const [k, code, vk] of [['t', 'KeyT', 84], ['j', 'KeyJ', 74], ['p', 'KeyP', 80]]) {
    await page.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k }, page.sessionId);
    await sleep(60);
    await page.b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, page.sessionId);
    await sleep(60);
  }
  await sleep(400);
  const typed = await page.eval(`(() => ({
    chat: window.__yanyuan.chatOpen,
    help: !document.getElementById('helpOverlay').classList.contains('hidden'),
    map: !document.getElementById('mapOverlay').classList.contains('hidden'),
    value: document.getElementById('mapSearch').value,
  }))()`);
  check('地图搜索框里打 t/j/p 不会开聊天', !typed.chat);
  check('也不会关掉地图或打开帮助', typed.map === true && typed.help === false);
  check('字符确实进了输入框', typed.value.includes('t'), JSON.stringify(typed.value));

  // 回车只选结果，不开聊天
  await page.eval(`(() => { const s = document.getElementById('mapSearch'); s.value='未名湖'; s.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(400);
  await key('Enter', 'Enter', 13);
  await sleep(500);
  const afterEnter = await page.eval(`(() => ({ chat: window.__yanyuan.chatOpen, wp: window.__yanyuan.waypoint ? window.__yanyuan.waypoint.name : null }))()`);
  check('搜索框回车不会开聊天', !afterEnter.chat);
  check('回车选中了目的地', afterEnter.wp === '未名湖', String(afterEnter.wp));
  await page.eval("document.getElementById('mapClose').click()");
  await sleep(300);

  console.log('\n【4】存档状态可见');
  const saveState = await page.eval("document.getElementById('chipSave').textContent");
  check('HUD 有存档状态', ['已保存', '待同步', '保存中…'].includes(saveState), saveState);
  await page.eval("window.__yanyuan.progress.visited['测试点']=Date.now(); window.__yanyuan.store.touch();");
  await sleep(300);
  const pending = await page.eval("document.getElementById('chipSave').textContent");
  check('改动后先显示待同步/保存中', pending !== '已保存', pending);
  await sleep(5200);
  const saved = await page.eval("document.getElementById('chipSave').textContent");
  check('几秒后变成已保存', saved === '已保存', saved);

  console.log('\n【5】里程统计写进存档');
  const before = await page.eval("window.__yanyuan.progress.stats.dist || 0");
  await key('d', 'KeyD', 68);
  await page.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 }, page.sessionId);
  await sleep(2500);
  await page.b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 }, page.sessionId);
  await sleep(2600);
  const after = await page.eval("window.__yanyuan.progress.stats.dist || 0");
  check('步行距离写入 progress.stats.dist', after > before + 1, `${before.toFixed(1)} → ${after.toFixed(1)}`);

  await page.eval("window.__yanyuan.hourOverride = 11");
  await page.screenshot(`${OUT}/round10_check.png`);

  if (page.errors.length) {
    console.log('--- 页面错误 ---');
    for (const e of page.errors.slice(0, 6)) console.log(' !', e.split('\n')[0]);
  }
} catch (e) {
  console.error('失败:', e.message);
  for (const er of page.errors.slice(0, 6)) console.error(' !', er.split('\n')[0]);
} finally {
  await b.close();
}

const ok = results.filter(r => r.ok).length;
console.log(`\n通过 ${ok}/${results.length}`);
if (ok !== results.length) process.exitCode = 1;
