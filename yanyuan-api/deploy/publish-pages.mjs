// 发布到 GitHub Pages 的 yanyuan/ 子路径：拷贝、注入后端地址、提交推送、校验线上地址
import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const WORK = resolve(ROOT, '..');
const GAME = join(WORK, 'yanyuan');
const PAGES = join(WORK, 'pages-repo');
const DEST = join(PAGES, 'yanyuan');
const GIT = 'C:\\Users\\徐若凯\\AppData\\Local\\GitHubDesktop\\app-3.6.5\\resources\\app\\git\\cmd\\git.exe';
const SITE = 'https://xxxxu-ll.github.io/yanyuan/';
const REPO = 'xxxxu-ll/xxxxu-ll.github.io';

function git(args, opts = {}) {
  return execFileSync(GIT, args, { cwd: PAGES, encoding: 'utf8', stdio: opts.q ? 'pipe' : 'inherit', ...opts });
}

async function getToken() {
  try {
    const out = execFileSync(GIT, ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const m = out.match(/^password=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

async function main() {
  const deployedPath = join(ROOT, 'dist', 'deployed.json');
  let apiBase;
  if (existsSync(deployedPath)) {
    const deployed = JSON.parse(await readFile(deployedPath, 'utf8'));
    apiBase = deployed.apiBase;
  } else {
    apiBase = 'https://yanyuan-world.yanyuan.workers.dev/api';
    console.warn('! 还没有 dist/deployed.json，先用占位后端地址发布（只可离线漫游）');
  }
  if (!apiBase) throw new Error('没有可用的 apiBase');

  const buildId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  // 先把本地 pages 仓库对齐远端（此前用 API 推送过，会造成分叉）
  try {
    git(['fetch', 'origin'], { q: true });
    git(['reset', '--hard', 'origin/main'], { q: true });
    console.log('→ 已同步远端 pages 仓库');
  } catch (e) {
    console.warn('  同步远端失败（继续）：', e.message.split('\n')[0]);
  }
  console.log('→ 准备发布目录', DEST);
  await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  await cp(join(GAME, 'index.html'), join(DEST, 'index.html'));
  await cp(join(GAME, 'src'), join(DEST, 'src'), { recursive: true });
  await cp(join(GAME, 'assets'), join(DEST, 'assets'), { recursive: true }).catch(() => {});
  await cp(join(GAME, 'ATTRIBUTION.md'), join(DEST, 'ATTRIBUTION.md'));
  // 只发布运行必需的地图数据，截图/统计等开发产物不进站点
  await mkdir(join(DEST, 'data'), { recursive: true });
  await cp(join(GAME, 'data', 'map.json'), join(DEST, 'data', 'map.json'));

  // 注入后端地址与构建号
  const cfg = `// 由 tools/publish-pages.mjs 生成（${new Date().toISOString()}）\n` +
    `export const API_BASE = ${JSON.stringify(apiBase)};\n` +
    `export const BUILD_ID = ${JSON.stringify(buildId)};\n`;
  await writeFile(join(DEST, 'src', 'api-base.js'), cfg);

  // 原子升级：给 index.html 与所有模块导入加 ?v=构建号，
  // 避免浏览器把新旧文件混着用导致白屏
  const idxPath = join(DEST, 'index.html');
  let html = await readFile(idxPath, 'utf8');
  html = html.replace(/(\.\/src\/[A-Za-z0-9_.-]+\.(?:js|css))(\?[^"']*)?/g, `$1?v=${buildId}`);
  await writeFile(idxPath, html);

  const srcDir = join(DEST, 'src');
  const modFiles = (await readdir(srcDir)).filter(f => f.endsWith('.js'));
  for (const f of modFiles) {
    if (f === 'api-base.js') continue;
    const p = join(srcDir, f);
    let code = await readFile(p, 'utf8');
    code = code.replace(/(from\s+['"]\.\/[A-Za-z0-9_.-]+\.js)(['"])/g, `$1?v=${buildId}$2`);
    code = code.replace(/(import\s+['"]\.\/[A-Za-z0-9_.-]+\.js)(['"])/g, `$1?v=${buildId}$2`);
    await writeFile(p, code);
  }

  // 站点内 README（Pages 上可直接查看）
  await writeFile(join(DEST, 'README.md'), [
    '# 像素燕园',
    '',
    '多人在线像素校园。入口：https://xxxxu-ll.github.io/yanyuan/',
    '',
    `- 世界服务（Cloudflare Worker + D1）：${apiBase.replace(/\/api$/, '')}`,
    `- 地图数据：© OpenStreetMap contributors, ODbL 1.0；详见 ATTRIBUTION.md`,
    '- 非官方学生作品，与北京大学无隶属关系。',
    '',
  ].join('\n'));

  console.log('→ 提交');
  git(['add', 'yanyuan']);
  const status = git(['status', '--porcelain'], { q: true });
  if (!status.trim()) {
    console.log('  没有变更，跳过提交');
  } else {
    git(['-c', 'user.name=xxxxu-ll', '-c', 'user.email=xx080102@126.com', 'commit', '-m',
      `deploy(yanyuan): 发布《像素燕园》 ${buildId}`]);
    console.log('→ 推送');
    try {
      git(['push', 'origin', 'main']);
    } catch (e) {
      console.warn('  git push 失败，改用 GitHub API 推送…');
      execFileSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'deploy', 'push-api.ps1'),
        '-Dir', DEST, '-Prefix', 'yanyuan', '-Repo', REPO, '-Branch', 'main',
        '-Message', `deploy(yanyuan): 发布《像素燕园》 ${buildId}`,
      ], { stdio: 'inherit' });
    }
  }

  // ---- 等待 Pages 构建并校验 ----
  const token = await getToken();
  if (token) {
    console.log('→ 等待 GitHub Pages 构建');
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/pages/builds/latest`, {
          headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'yanyuan-deploy', Accept: 'application/vnd.github+json' },
        });
        const j = await r.json();
        if (j.status === 'built' && j.commit && j.commit === git(['rev-parse', 'HEAD'], { q: true }).trim()) break;
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('→ 校验线上地址');
  let ok = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(SITE, { headers: { 'Cache-Control': 'no-cache' } });
      const html = await r.text();
      if (r.ok && html.includes('像素燕园') && html.includes('src/main.js')) { ok = true; break; }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 6000));
  }
  if (!ok) throw new Error('线上地址还没生效，稍后重试校验');
  const mapRes = await fetch(SITE + 'data/map.json');
  const cssRes = await fetch(SITE + 'src/style.css');
  let apiRes = null;
  try {
    const r = await fetch(apiBase + '/health', { headers: { Origin: 'https://xxxxu-ll.github.io' } });
    apiRes = await r.json();
  } catch (e) {
    apiRes = { error: e.message };
  }
  console.log('  首页:', (await fetch(SITE)).status);
  console.log('  map.json:', mapRes.status, (await mapRes.text()).length, 'bytes');
  console.log('  style.css:', cssRes.status);
  console.log('  API health:', JSON.stringify(apiRes));
  console.log('\n发布完成:', SITE);
}

main().catch((e) => { console.error('发布失败:', e.message); process.exitCode = 1; });
