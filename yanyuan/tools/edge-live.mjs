// 用你本机 Edge 的登录态开一个可被脚本控制的实例（只复制 Cookie，不修改原配置）
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
const DST = join(process.env.TEMP, 'yanyuan-edge-profile');
const PORT = 9223;
const EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main() {
  if (!existsSync(join(SRC, 'Local State'))) throw new Error('找不到 Edge 配置');
  await rm(DST, { recursive: true, force: true });
  await mkdir(join(DST, 'Default', 'Network'), { recursive: true });
  await cp(join(SRC, 'Local State'), join(DST, 'Local State'));
  const cookies = join(SRC, 'Default', 'Network', 'Cookies');
  if (existsSync(cookies)) await cp(cookies, join(DST, 'Default', 'Network', 'Cookies'));
  // 顺带复制本地存储（有些站点把登录态放在这里）
  const ls = join(SRC, 'Default', 'Local Storage');
  if (existsSync(ls)) await cp(ls, join(DST, 'Default', 'Local Storage'), { recursive: true }).catch(() => {});
  const prefs = join(SRC, 'Default', 'Preferences');
  if (existsSync(prefs)) await cp(prefs, join(DST, 'Default', 'Preferences')).catch(() => {});

  const child = spawn(EXE, [
    `--user-data-dir=${DST}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--window-size=1440,900',
    'about:blank',
  ], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) {
        const v = await r.json();
        console.log('浏览器已启动:', v.Browser);
        console.log('调试端口:', PORT, ' 配置目录:', DST);
        return;
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('调试端口未就绪');
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
