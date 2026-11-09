// 线上验收：注册后恢复码弹窗是否真的可见（截图证据）
import { Browser, sleep } from './cdp.mjs';

const URL = process.env.GAME_URL || 'https://xxxxu-ll.github.io/yanyuan/';
const OUT = 'C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/shots';
const b = await new Browser({ port: 9344 }).launch({ headless: true });
const page = await b.newPage('about:blank');

try {
  await page.goto(URL);
  await sleep(1600);
  await page.eval("document.getElementById('btnCreate').click()");
  await sleep(300);
  const name = '验收' + Math.floor(Math.random() * 9000 + 1000);
  await page.eval(`(() => {
    const el = document.getElementById('inName');
    el.value = ${JSON.stringify(name)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(900);
  console.log('nameHint:', await page.eval("document.getElementById('nameHint').textContent"));
  await page.eval("document.getElementById('btnEnter').click()");
  await sleep(2200);

  const visible = await page.eval(`(() => {
    const el = document.getElementById('codeOverlay');
    if (el.classList.contains('hidden')) return { shown: false };
    const r = el.querySelector('.code-card').getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { shown: true, insideCard: !!top && !!top.closest('.code-card'), code: document.getElementById('codeBox').textContent };
  })()`);
  console.log('恢复码弹窗:', JSON.stringify(visible));
  await page.screenshot(`${OUT}/recovery_modal.png`);

  await page.eval("document.getElementById('codeOk').click()");
  await sleep(1800);
  const started = await page.eval('!!window.__yanyuan');
  console.log('进入游戏:', started);
  if (started) {
    await page.eval("document.getElementById('btnHelp').click()");
    await sleep(400);
    console.log('帮助内恢复码:', await page.eval("document.getElementById('helpCode').textContent"));
    await page.screenshot(`${OUT}/help_code_live.png`);
  }
  if (page.errors.length) console.log('errors:', page.errors.slice(0, 3));
} catch (e) {
  console.error('失败:', e.message);
  await page.screenshot(`${OUT}/__fail.png`).catch(() => {});
} finally {
  await b.close();
}
