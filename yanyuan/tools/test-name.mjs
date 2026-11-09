// 验证「昵称被占用」相关的交互：实时可用性、找回提示、本机恢复码展示
import { Browser, sleep } from './cdp.mjs';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8787/yanyuan/';
const b = await new Browser({ port: 9342 }).launch({ headless: true });
const page = await b.newPage('about:blank');
const OUT = 'C:/Users/徐若凯/Documents/Codex/2026-11-08/github/work/yanyuan/data/shots';

try {
  await page.goto(URL);
  await sleep(1200);

  // 先用一个名字建号（制造「已被占用」）
  await page.eval("document.getElementById('btnCreate').click()");
  await sleep(200);
  const name = '占用测试' + Math.floor(Math.random() * 90 + 10);
  await page.eval(`(() => {
    const el = document.getElementById('inName');
    el.value = ${JSON.stringify(name)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(900);
  console.log('可用性提示(新名):', await page.eval("document.getElementById('nameHint').textContent"));
  await page.eval("document.getElementById('btnEnter').click()");
  await sleep(1600);
  const code = await page.eval("document.getElementById('codeBox').textContent");
  console.log('恢复码:', code);
  await page.eval("document.getElementById('codeOk').click()");
  await sleep(1500);

  // 帮助里应该能看到恢复码
  await page.eval("document.getElementById('btnHelp').click()");
  await sleep(400);
  console.log('帮助里的恢复码:', await page.eval("document.getElementById('helpCode').textContent"));
  await page.screenshot(`${OUT}/help_code.png`);
  await page.eval("document.getElementById('helpClose').click()");

  // 换一个干净会话，试占用同一个名字
  await page.eval("localStorage.removeItem('yanyuan.token')");
  await page.b.send('Page.reload', {}, page.sessionId);
  await page.waitFor("!document.getElementById('startScreen').classList.contains('hidden')", 12000);
  await page.eval("document.getElementById('btnCreate').click()");
  await sleep(200);
  await page.eval(`(() => {
    const el = document.getElementById('inName');
    el.value = ${JSON.stringify(name)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(1000);
  console.log('占用提示:', await page.eval("document.getElementById('nameHint').textContent"));
  console.log('找回区可见:', await page.eval("!document.getElementById('createRecover').classList.contains('hidden')"));
  console.log('本机恢复按钮可见:', await page.eval("!document.getElementById('btnResumeLocal').classList.contains('hidden')"));
  await page.screenshot(`${OUT}/name_taken.png`);

  // 点「继续我上次的角色」应该能直接回去（token 已删，所以这里应失败并提示）
  await page.eval("document.getElementById('btnResumeLocal').click()");
  await sleep(900);
  console.log('无 token 时的提示:', await page.eval("document.getElementById('createError').textContent"));

  if (page.errors.length) console.log('errors:', page.errors.slice(0, 4));
} catch (e) {
  console.error('失败:', e.message);
  for (const er of page.errors.slice(0, 5)) console.error(' !', er.split('\n')[0]);
  await page.screenshot(`${OUT}/name_taken_err.png`).catch(() => {});
} finally {
  await b.close();
}
