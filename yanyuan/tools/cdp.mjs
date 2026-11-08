// 极简 Chrome DevTools Protocol 客户端：用于真实浏览器端到端验证（无第三方依赖）
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export class Browser {
  constructor(opts = {}) {
    this.opts = opts;
    this.proc = null;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.port = opts.port || 9222;
    this.profileDir = null;
  }

  async launch({ headless = true, width = 1280, height = 800 } = {}) {
    const { existsSync } = await import('node:fs');
    let exe = null;
    for (const p of EDGE_CANDIDATES) if (existsSync(p)) { exe = p; break; }
    if (!exe) throw new Error('找不到 Edge/Chrome');

    this.profileDir = await mkdtemp(join(tmpdir(), 'yanyuan-profile-'));
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-features=Translate,BackForwardCache',
      `--window-size=${width},${height}`,
      '--force-device-scale-factor=1',
      'about:blank',
    ];
    if (headless) args.unshift('--headless=new');

    this.proc = spawn(exe, args, { stdio: 'ignore', windowsHide: true });

    const version = await this._waitVersion();
    this.ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => this._onMessage(ev));
    return this;
  }

  async _waitVersion(timeout = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (r.ok) return await r.json();
      } catch { /* retry */ }
      await sleep(200);
    }
    throw new Error('调试端口未就绪');
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      const hs = this.handlers.get(msg.method);
      if (hs) for (const h of hs) h(msg.params);
    }
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时: ' + method));
        }
      }, 30000);
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  /** 打开一个页面并返回 Page 封装 */
  async newPage(url, { width = 1280, height = 800 } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId);
    await page.init({ width, height });
    await page.goto(url);
    return page;
  }

  async close() {
    try { this.ws && this.ws.close(); } catch { /* ignore */ }
    try { if (this.proc) this.proc.kill(); } catch { /* ignore */ }
    await sleep(300);
    try { if (this.profileDir) await rm(this.profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export class Page {
  constructor(browser, sessionId, targetId) {
    this.b = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.logs = [];
    this.errors = [];
  }

  async init({ width, height }) {
    await this.b.send('Page.enable', {}, this.sessionId);
    await this.b.send('Runtime.enable', {}, this.sessionId);
    await this.b.send('Log.enable', {}, this.sessionId);
    await this.b.send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false }, this.sessionId);

    this.b.on('Runtime.consoleAPICalled', (p) => {
      if (p.sessionId && p.sessionId !== this.sessionId) return;
      const text = (p.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      this.logs.push({ type: p.type, text });
      if (p.type === 'error') this.errors.push(text);
    });
    this.b.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      this.errors.push(d.exception?.description || d.text || 'exception');
    });
    this.b.on('Log.entryAdded', (p) => {
      if (p.entry && p.entry.level === 'error') this.errors.push(p.entry.text);
    });
  }

  async goto(url) {
    await this.b.send('Page.navigate', { url }, this.sessionId);
    await this.waitFor('document.readyState === "complete"', 15000);
  }

  async eval(expression, { awaitPromise = true } = {}) {
    const res = await this.b.send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, userGesture: true,
    }, this.sessionId);
    if (res.exceptionDetails) {
      throw new Error('页面异常: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result.value;
  }

  async waitFor(expr, timeout = 10000, interval = 120) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeout) {
      try {
        const v = await this.eval(`(() => { try { return !!(${expr}); } catch(e) { return false; } })()`);
        if (v) return true;
      } catch (e) { last = e; }
      await sleep(interval);
    }
    throw new Error(`等待超时: ${expr}${last ? ' (' + last.message + ')' : ''}`);
  }

  async screenshot(path) {
    const { data } = await this.b.send('Page.captureScreenshot', { format: 'png' }, this.sessionId);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, Buffer.from(data, 'base64'));
    return path;
  }

  async close() {
    try { await this.b.send('Target.closeTarget', { targetId: this.targetId }); } catch { /* ignore */ }
  }
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
