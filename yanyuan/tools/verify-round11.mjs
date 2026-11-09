// 第 11 轮验收：地点卡片、前五分钟邀请、玩家名片与挥手
import { Browser, sleep } from './cdp.mjs';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8787/yanyuan/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function enter(page, name) {
  await page.goto(URL);
  await sleep(1300);
  await page.eval("document.getElementById('btnCreate').click()");
  await sleep(200);
  await page.eval(`(() => { const el = document.getElementById('inName'); el.value = ${JSON.stringify(name)}; el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await sleep(700);
  await page.eval("document.getElementById('btnEnter').click()");
  await sleep(1900);
  await page.eval("document.getElementById('codeOk').click()");
  await sleep(1500);
}

const A = await new Browser({ port: 9370 }).launch({ headless: true });
const B = await new Browser({ port: 9371 }).launch({ headless: true });
const pa = await A.newPage('about:blank');
const pb = await B.newPage('about:blank');

try {
  const stamp = Date.now().toString(36).slice(-4);
  await enter(pa, '甲' + stamp);
  check('A 进入游戏', await pa.eval('!!window.__yanyuan'));

  console.log('\n【1】前五分钟邀请');
  await sleep(3200);
  const inv = await pa.eval(`(() => {
    const c = document.getElementById('inviteCard');
    return { shown: !c.classList.contains('hidden'), n: document.querySelectorAll('#inviteList .invite-item').length };
  })()`);
  check('首次进入出现邀请卡', inv.shown === true);
  check('给了三个可选邀请', inv.n === 3, String(inv.n));
  await pa.eval("document.querySelectorAll('#inviteList .invite-item')[0].click()");
  await sleep(600);
  const quest = await pa.eval(`JSON.stringify({ wp: window.__yanyuan.waypoint, q: localStorage.getItem('yanyuan.quest'), hidden: document.getElementById('inviteCard').classList.contains('hidden') })`);
  const q = JSON.parse(quest);
  check('点选后设置了目的地', !!q.wp, q.wp ? q.wp.name : '');
  check('记录当前任务', q.q === 'cat', String(q.q));
  check('邀请卡收起', q.hidden === true);

  console.log('\n【2】地点卡片');
  await pa.eval(`(() => {
    const g = window.__yanyuan;
    const t = g.world.landmarks.find(l => l.name === '博雅塔' && !l.aliasOf);
    g.me.x = t.ax; g.me.y = t.ay; g.cam.x = t.ax; g.cam.y = t.ay;
  })()`);
  await sleep(900);
  const near = await pa.eval("window.__yanyuan.nearest ? window.__yanyuan.nearest.type : null");
  check('站在可达点能识别到地点', near === 'place', String(near));
  await pa.eval("document.getElementById('btnInteract').click()");
  await sleep(500);
  const place = await pa.eval(`(() => {
    const ov = document.getElementById('placeOverlay');
    return { shown: !ov.classList.contains('hidden'), title: document.getElementById('placeTitle').textContent,
             story: document.getElementById('placeStory').textContent.length };
  })()`);
  check('按互动弹出地点卡片', place.shown === true, place.title);
  check('卡片有故事文本', place.story > 20, `${place.story} 字`);
  await pa.eval("document.getElementById('placeRemember').click()");
  await sleep(400);
  const noteOk = await pa.eval("(window.__yanyuan.progress.items || []).some(i => i.includes('观察笔记'))");
  check('记进手册写入物品', noteOk === true);

  console.log('\n【3】玩家名片与挥手');
  await enter(pb, '乙' + stamp);
  await sleep(2600);
  const seen = await pa.eval("[...window.__yanyuan.remotes.values()].length");
  check('A 能看到 B', seen >= 1, String(seen));
  // 把 A 挪到 B 旁边，否则对方在屏幕外点不到
  await pa.eval(`(() => {
    const g = window.__yanyuan;
    const r = [...g.remotes.values()][0];
    g.me.x = r.x - 2.2; g.me.y = r.y; g.cam.x = g.me.x; g.cam.y = g.me.y;
  })()`);
  await sleep(700);
  const pos = await pa.eval(`(() => {
    const g = window.__yanyuan;
    const r = [...g.remotes.values()][0];
    const rect = g.canvas.getBoundingClientRect();
    return { x: rect.left + g.px(r.x), y: rect.top + g.py(r.y), name: r.name };
  })()`);
  await pa.b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(pos.x), y: Math.round(pos.y), button: 'left', clickCount: 1 }, pa.sessionId);
  await pa.b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(pos.x), y: Math.round(pos.y), button: 'left', clickCount: 1 }, pa.sessionId);
  await sleep(500);
  const card = await pa.eval(`(() => {
    const ov = document.getElementById('cardOverlay');
    return { shown: !ov.classList.contains('hidden'), name: document.getElementById('pcName').textContent };
  })()`);
  check('点击附近玩家弹出名片', card.shown === true, card.name);
  check('名片显示的是对方昵称', card.name.includes('乙'), card.name);

  await pa.eval("document.getElementById('pcWave').click()");
  await sleep(2600);
  const bText = await pb.eval("document.getElementById('toasts').textContent");
  check('对方收到挥手提示', bText.includes('挥了挥手'), bText.slice(0, 40));

  if (pa.errors.length || pb.errors.length) {
    console.log('--- 页面错误 ---');
    for (const e of [...pa.errors, ...pb.errors].slice(0, 6)) console.log(' !', e.split('\n')[0]);
  }
} catch (e) {
  console.error('失败:', e.message);
  for (const er of [...pa.errors, ...pb.errors].slice(0, 6)) console.error(' !', er.split('\n')[0]);
} finally {
  await A.close();
  await B.close();
}

const ok = results.filter(r => r.ok).length;
console.log(`\n通过 ${ok}/${results.length}`);
if (ok !== results.length) process.exitCode = 1;
