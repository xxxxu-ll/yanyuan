// 建筑几何自检：检查「屋顶下沿 ↔ 墙面」之间有没有露出地面
// 用法：node tools/geom-check.mjs [建筑名...]
import { Browser, sleep } from './cdp.mjs';
import { writeFile } from 'node:fs/promises';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8787/yanyuan/';
const OUT = 'C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/shots';

// 默认挑几栋不同形状的楼
const TARGETS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['哲学楼', '燕南食堂', '一院', '二院', '三院', '四院', '五院', '六院', '俄文楼', '百周年纪念讲堂'];

const b = await new Browser({ port: 9471 }).launch({ headless: true });
const p = await b.newPage('about:blank', { width: 900, height: 620 });
await p.b.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 620, deviceScaleFactor: 1, mobile: false }, p.sessionId);
await p.goto(URL);
await sleep(1400);
await p.eval("document.getElementById('btnCreate').click()");
await sleep(200);
await p.eval(`(() => { const el=document.getElementById('inName'); el.value='自检'+Math.floor(Math.random()*9000+1000); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(650);
await p.eval("document.getElementById('btnEnter').click()");
await sleep(1800);
await p.eval("document.getElementById('codeOk').click()");
await sleep(1500);
await p.eval("window.__yanyuan.offerQuests = () => {}; document.getElementById('inviteCard').classList.add('hidden'); window.__yanyuan.hourOverride = 12; window.__yanyuan.cam.zoom = 1.5");

// 在页面里做像素采样
const probe = `(() => {
  const g = window.__yanyuan;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cam = g.cam;
  const S = cam.scale;
  // 草地/路面颜色（判定"露出地面"）
  // 只把「草绿」和「中性浅灰铺装」算作地面；米白墙面 r>g，不会被误判
  const groundish = (r, gg, b2) => {
    if (gg - r > 25 && gg - b2 > 30) return true;                       // 草地
    if (Math.abs(r - gg) < 12 && Math.abs(gg - b2) < 14 && r > 170) return true; // 灰色铺装
    return false;
  };
  const res = [];
  for (const name of window.__geomTargets) {
    const bl = g.world.buildings.find(x => x.name === name);
    if (!bl) { res.push({ name, missing: true }); continue; }
    const bb = bl.bbox;
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    // 把镜头对准这栋楼
    cam.x = (bb[0] + bb[2]) / 2; cam.y = bb[3];
    // 手动清一帧
    const wallPx = Math.max(12, Math.round(Math.max(bl._hpx * cam.zoom, Math.min(h * S * 0.32, 110))));
    const yGround = Math.round((bb[3] - cam.y) * S + cam.w / 2);
    const yRoofBottom = yGround - wallPx;
    let gaps = 0, samples = 0;
    // 点在多边形内（判断这一列是否真的落在楼上）
    const pip = (px, py, ring) => {
      let inside = false;
      for (let i2 = 0, j2 = ring.length - 2; i2 < ring.length; j2 = i2, i2 += 2) {
        const xi = ring[i2], yi = ring[i2 + 1], xj = ring[j2], yj = ring[j2 + 1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    };
    const cols = 11;
    for (let i = 1; i < cols; i++) {
      const wx = bb[0] + (w * i) / cols;
      if (!bl.outer.some(ring => pip(wx, bb[3] - 0.8, ring))) continue;   // 这一列楼下没轮廓，跳过
      const x = Math.round((wx - cam.x) * S + cam.w / 2);
      if (x < 2 || x > cam.w - 2) continue;
      for (let y = yRoofBottom; y <= yGround; y += 2) {
        if (y < 2 || y > cam.h - 2) continue;
        samples++;
        const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
        if (d[3] > 8 && groundish(d[0], d[1], d[2])) { gaps++; break; }
      }
    }
    res.push({ name, hpx: bl._hpx, wallPx, gaps, samples, shape: bl.outer.length });
  }
  return res;
})()`;

const names = TARGETS;
await p.eval(`window.__geomTargets = ${JSON.stringify(names)}`);
// 预热：把镜头依次移到每栋楼，强制渲染一帧（否则 _hpx 还没算出来）
for (const nm of names) {
  await p.eval(`(() => {
    const g = window.__yanyuan;
    const bl = g.world.buildings.find(x => x.name === ${JSON.stringify(nm)});
    if (!bl) return;
    g.cam.x = (bl.bbox[0] + bl.bbox[2]) / 2;
    g.cam.y = bl.bbox[3];
    g.me.x = g.cam.x; g.me.y = g.cam.y;
  })()`);
  await sleep(260);
}

const rows = await p.eval(probe);
let bad = 0;
console.log('建筑几何自检（屋顶下沿与墙面之间是否露出地面）\n');
for (const r of rows) {
  if (r.detail) { console.log(`       ${r.name} ${r.detail}`); continue; }
  if (r.missing) { console.log(`  ?  ${r.name}  地图里没有这栋楼`); continue; }
  const ok = r.gaps === 0;
  if (!ok) bad++;
  console.log(`  ${ok ? '✔' : '✘'}  ${r.name.padEnd(8)} 墙高${String(r.wallPx).padStart(3)}px  采样${r.samples}  漏光${r.gaps}`);
}
console.log(`\n通过 ${rows.length - bad}/${rows.length}`);
if (bad) process.exitCode = 1;

await p.screenshot(`${OUT}/geom-check.png`);
await b.close();
