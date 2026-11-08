// 端到端验证：两个独立浏览器会话、真实多人同步、聊天、刷新续玩、恢复码、越权、移动端
import { Browser, sleep } from './cdp.mjs';
import { mkdir, readdir, stat } from 'node:fs/promises';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8787/yanyuan/';
const OUT = process.env.E2E_OUT || 'C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/e2e';
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function createCharacter(page, name) {
  await page.goto(URL);
  await page.waitFor("!document.getElementById('startScreen').classList.contains('hidden')", 12000);
  await page.eval("document.getElementById('btnCreate').click()");
  await sleep(200);
  await page.eval(`(() => {
    const el = document.getElementById('inName');
    el.value = ${JSON.stringify(name)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnEnter').click();
  })()`);
  await page.waitFor("!document.getElementById('codeOverlay').classList.contains('hidden')", 12000);
  const code = await page.eval("document.getElementById('codeBox').textContent");
  await page.eval("document.getElementById('codeOk').click()");
  await page.waitFor("!!window.__yanyuan", 12000);
  return code;
}

async function press(page, key, code, vk, ms = 700) {
  await page.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, page.sessionId);
  await sleep(ms);
  await page.b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, page.sessionId);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const A = await new Browser({ port: 9335 }).launch({ headless: true });
  const B = await new Browser({ port: 9336 }).launch({ headless: true });
  const C = await new Browser({ port: 9337 }).launch({ headless: true });
  const pa = await A.newPage('about:blank');
  const pb = await B.newPage('about:blank');
  const pc = await C.newPage('about:blank');

  try {
    const stamp = Date.now().toString(36).slice(-4);
    const nameA = '甲' + stamp;
    const nameB = '乙' + stamp;

    console.log('\n【1】两个独立浏览器创建不同角色');
    const codeA = await createCharacter(pa, nameA);
    const codeB = await createCharacter(pb, nameB);
    check('A 拿到恢复码', /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/.test(codeA), codeA);
    check('B 拿到恢复码', /^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/.test(codeB), codeB);
    const idA = await pa.eval('window.__yanyuan.character.id');
    const idB = await pb.eval('window.__yanyuan.character.id');
    check('两个角色 id 不同', idA !== idB, `${idA} vs ${idB}`);
    check('两个恢复码不同', codeA !== codeB);

    console.log('\n【2】真实多人同屏');
    await sleep(2600);
    const aSeesB = await pa.eval(`JSON.stringify([...window.__yanyuan.remotes.values()].map(r=>r.name))`);
    const bSeesA = await pb.eval(`JSON.stringify([...window.__yanyuan.remotes.values()].map(r=>r.name))`);
    check('A 能看到 B', aSeesB.includes(nameB), aSeesB);
    check('B 能看到 A', bSeesA.includes(nameA), bSeesA);
    const online = await pa.eval("document.getElementById('chipOnline').textContent");
    check('在线人数真实反映（≥2）', parseInt(online.replace(/\D/g, ''), 10) >= 2, online);

    console.log('\n【3】位置同步');
    const before = await pb.eval(`(() => { const r = [...window.__yanyuan.remotes.values()].find(r=>r.tx!==undefined); return r ? [r.tx, r.ty] : null; })()`);
    await press(pa, 'd', 'KeyD', 68, 1200);
    await sleep(2200);
    const after = await pb.eval(`(() => { const r = [...window.__yanyuan.remotes.values()].find(r=>r.name===${JSON.stringify(nameA)}); return r ? [r.tx, r.ty] : null; })()`);
    check('A 移动后 B 端坐标变化', before && after && Math.hypot(after[0] - before[0], after[1] - before[1]) > 0.5,
      `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    const movedA = await pa.eval('window.__yanyuan.me.x');
    check('A 自身位置变化', Math.abs(movedA - -158) > 0.5, String(movedA));

    console.log('\n【4】聊天');
    const msg = '在湖边测试 ' + stamp;
    await pa.eval(`(() => {
      const g = window.__yanyuan;
      g.openChat();
      document.getElementById('chatInput').value = ${JSON.stringify(msg)};
      g.sendChat();
    })()`);
    await sleep(2600);
    const blog = await pb.eval("document.getElementById('chatlog').textContent");
    check('B 收到 A 的聊天', blog.includes(msg), blog.slice(-80));
    check('B 端显示的是 A 的昵称', blog.includes(nameA));

    await pa.screenshot(`${OUT}/a_see_b.png`);
    await pb.screenshot(`${OUT}/b_see_a.png`);

    console.log('\n【5】刷新后继续游玩');
    await pb.b.send('Page.reload', {}, pb.sessionId);
    await pb.waitFor("!!window.__yanyuan", 15000);
    await sleep(1200);
    const idB2 = await pb.eval('window.__yanyuan.character.id');
    const nameB2 = await pb.eval('window.__yanyuan.character.name');
    check('刷新后角色 id 不变', idB2 === idB, `${idB2}`);
    check('刷新后昵称不变', nameB2 === nameB, nameB2);

    console.log('\n【6】恢复码跨设备恢复');
    await pc.goto(URL);
    await pc.waitFor("!document.getElementById('startScreen').classList.contains('hidden')", 12000);
    await pc.eval("document.getElementById('btnRestore').click()");
    await sleep(200);
    await pc.eval(`(() => {
      const el = document.getElementById('inRecovery');
      el.value = ${JSON.stringify(codeA)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('btnDoRestore').click();
    })()`);
    await pc.waitFor("!!window.__yanyuan", 12000);
    const idC = await pc.eval('window.__yanyuan.character.id');
    check('新浏览器用恢复码恢复到同一角色', idC === idA, `${idC} vs ${idA}`);
    const progC = await pc.eval('JSON.stringify(window.__yanyuan.progress.visited)');
    check('恢复后带回探索记录', Object.keys(JSON.parse(progC)).length > 0, progC.slice(0, 120));
    await pc.screenshot(`${OUT}/c_restored.png`);

    console.log('\n【7】越权与 CORS');
    const apiBase = await pc.eval("window.__yanyuan.api.base");
    const unauth = await pc.eval(`fetch(${JSON.stringify(apiBase)} + '/progress', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({progress:{}})}).then(r=>r.status)`);
    check('无凭证写进度被拒绝 (401)', unauth === 401, String(unauth));
    const badToken = await pc.eval(`fetch(${JSON.stringify(apiBase)} + '/session', {method:'POST', headers:{'content-type':'application/json', authorization:'Bearer ${'f'.repeat(40)}'}, body:'{}'}).then(r=>r.status)`);
    check('伪造恢复码被拒绝 (401)', badToken === 401, String(badToken));
    const otherSession = await pc.eval(`fetch(${JSON.stringify(apiBase)} + '/session', {method:'POST', headers:{'content-type':'application/json', authorization:'Bearer ${codeB.replace(/-/g, '').toLowerCase()}'}, body:'{}'}).then(r=>r.json()).then(j=>j.character && j.character.name)`);
    check('用 B 的恢复码得到 B 的角色（不是 A 的）', otherSession === nameB, String(otherSession));

    console.log('\n【8】碰撞与出生点');
    const col = await pa.eval(`(() => {
      const g = window.__yanyuan, w = g.world;
      const b = w.buildings.find(x => x.area > 800);
      const cx = (b.bbox[0]+b.bbox[2])/2, cy = (b.bbox[1]+b.bbox[3])/2;
      const lake = w.water.find(x=>x.name==='未名湖');
      const before = [g.me.x, g.me.y];
      g.me.x = cx; g.me.y = cy;
      const blockedNow = w.blocked(cx, cy, 0.5);
      g.me.x = before[0]; g.me.y = before[1];
      return { insideBuildingBlocked: blockedNow, lakeBlocked: w.blocked(lake.label[0], lake.label[1], 0.5), spawnFree: w.blocked(-158, 178, 0.5) };
    })()`);
    check('建筑内部不可通行', col.insideBuildingBlocked === true);
    check('湖面不可通行', col.lakeBlocked === true);
    check('出生点可站立', col.spawnFree === false);

    // 真实按键撞墙测试：往建筑方向走，位置不应进入建筑
    const walkInto = await pa.eval(`(async () => {
      const g = window.__yanyuan, w = g.world;
      const b = w.buildings.filter(x => x.area > 400).sort((a,c)=>Math.abs(a.label[0])-Math.abs(c.label[0]))[0];
      g.me.x = b.bbox[0] - 3; g.me.y = (b.bbox[1]+b.bbox[3])/2;
      return [g.me.x, g.me.y, b.name];
    })()`);
    await press(pa, 'd', 'KeyD', 68, 1400);
    const stopped = await pa.eval(`(() => {
      const g = window.__yanyuan;
      return { x: g.me.x, blocked: g.world.blocked(g.me.x, g.me.y, 0.45) };
    })()`);
    check('走向建筑会被挡住而不是穿墙', stopped.blocked === false, `${JSON.stringify(walkInto)} → x=${stopped.x.toFixed(1)}`);

    console.log('\n【9】地图 / 搜索 / 目的地');
    await pa.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'm', code: 'KeyM', windowsVirtualKeyCode: 77 }, pa.sessionId);
    await sleep(600);
    await pa.eval(`(() => {
      const s = document.getElementById('mapSearch');
      s.value = '未名湖';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);
    const results1 = await pa.eval("document.querySelectorAll('#searchResults li').length");
    check('全图搜索能返回结果', results1 > 0, String(results1));
    await pa.eval("document.querySelector('#searchResults li').click()");
    await sleep(400);
    const wp = await pa.eval("JSON.stringify(window.__yanyuan.waypoint)");
    check('点击结果设置目的地', wp && wp.includes('未名湖'), wp);
    await pa.screenshot(`${OUT}/map_overlay.png`);
    await pa.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, pa.sessionId);
    await pa.eval("document.getElementById('mapClose').click()");

    console.log('\n【10】拍照');
    const photosBefore = await pa.eval("window.__yanyuan.progress.stats.photos || 0");
    await pa.eval("document.getElementById('btnPhoto').click()");
    await sleep(1200);
    const photosAfter = await pa.eval("window.__yanyuan.progress.stats.photos || 0");
    check('拍照计数增加', photosAfter === photosBefore + 1, `${photosBefore} → ${photosAfter}`);

    console.log('\n【11】手机端');
    await pb.b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, pb.sessionId);
    await pb.b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, pb.sessionId);
    await sleep(800);
    const mobile = await pb.eval(`(() => {
      const joy = document.getElementById('joystick');
      const r = joy.getBoundingClientRect();
      const btn = document.getElementById('btnInteract').getBoundingClientRect();
      return { joyVisible: !joy.classList.contains('hidden'), joyW: Math.round(r.width), btnW: Math.round(btn.width) };
    })()`);
    check('手机摇杆可见', mobile.joyVisible === true);
    check('触屏按钮足够大（≥44px）', mobile.btnW >= 44, `${mobile.btnW}px`);
    await pb.eval("window.__yanyuan.hourOverride = 16.8");
    await pb.screenshot(`${OUT}/mobile.png`);

    console.log('\n【12】页面错误检查');
    const errs = [...pa.errors, ...pb.errors, ...pc.errors]
      .filter(e => !/favicon|404|status of 401|status of 403/.test(e));
    check('三个会话均无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    check('端到端流程未中断', false, e.message);
    console.error(e);
  } finally {
    await A.close(); await B.close(); await C.close();
  }

  console.log('\n================ 结果 ================');
  const ok = results.filter(r => r.ok).length;
  console.log(`通过 ${ok} / ${results.length}，失败 ${failures}`);
  if (failures) {
    for (const r of results.filter(x => !x.ok)) console.log(' ✘', r.name, r.detail);
    process.exitCode = 1;
  }
}

main();
