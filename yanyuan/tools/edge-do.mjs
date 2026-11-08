// 对上面启动的 Edge 实例执行动作：goto / shot / eval / text / sleep
import { writeFile } from 'node:fs/promises';

const PORT = 9223;
const args = process.argv.slice(2);

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('没有可用的页面');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('超时 ' + method)); } }, 30000);
  });
  return { ws, send };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const { ws, send } = await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  for (let i = 0; i < args.length; i++) {
    const cmd = args[i];
    if (cmd === 'goto') {
      const url = args[++i];
      await send('Page.navigate', { url });
      await sleep(2500);
      console.log('→', url);
    } else if (cmd === 'shot') {
      const path = args[++i];
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path, Buffer.from(data, 'base64'));
      console.log('shot:', path);
    } else if (cmd === 'eval') {
      const expr = args[++i];
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) console.log('EXC:', r.exceptionDetails.text, r.exceptionDetails.exception?.description);
      else console.log(JSON.stringify(r.result.value));
    } else if (cmd === 'text') {
      const r = await send('Runtime.evaluate', { expression: 'document.body ? document.body.innerText.slice(0,4000) : ""', returnByValue: true });
      console.log(r.result.value);
    } else if (cmd === 'sleep') {
      await sleep(Number(args[++i] || 1000));
    } else if (cmd === 'url') {
      const r = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
      console.log(r.result.value);
    }
  }
  ws.close();
}

main().catch(e => { console.error('失败:', e.message); process.exitCode = 1; });
