import { Browser, sleep } from './cdp.mjs';
const b = await new Browser({ port: 9482 }).launch({ headless: true });
const p = await b.newPage('about:blank', { width: 1000, height: 680 });
const logs = [];
p.b.on?.('Runtime.consoleAPICalled', () => {});
await p.b.send('Runtime.enable', {}, p.sessionId);
await p.goto('http://127.0.0.1:8787/yanyuan/?tile=1');
await sleep(2000);
const info = await p.eval(`(() => {
  const has = id => !!document.getElementById(id);
  return {
    create: has('btnCreate'),
    boot: has('bootScreen'),
    bodyText: (document.body.innerText || '').slice(0, 200),
    winErr: window.__err || null,
  };
})()`);
console.log(JSON.stringify(info, null, 1));
await b.close();
