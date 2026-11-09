// 给 Worker 绑定自有域名（国内可达），并自动切换前端 API 地址
// 用法：
//   node deploy/attach-domain.mjs --add  example.com    # 第一步：把域名加进 Cloudflare，打印要改的 NS
//   node deploy/attach-domain.mjs --bind example.com    # 第二步：NS 生效后，绑定 Worker 自定义域并重发前端
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SECRETS = resolve(ROOT, '..', '.secrets', 'deploy.env');
const API = 'https://api.cloudflare.com/client/v4';
const SCRIPT_NAME = 'yanyuan-world';

function loadEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const args = process.argv.slice(2);
const mode = args[0];
const domain = (args[1] || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');

async function main() {
  if (!existsSync(SECRETS)) throw new Error('缺少 .secrets/deploy.env');
  const env = loadEnv(await readFile(SECRETS, 'utf8'));
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('没有 CLOUDFLARE_API_TOKEN');
  if (!domain) throw new Error('用法: --add <域名> 或 --bind <域名>');

  const cf = async (path, { method = 'GET', body = null } = {}) => {
    const headers = { Authorization: 'Bearer ' + token };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok || (json && json.success === false)) {
      const errs = (json && json.errors) ? json.errors.map(e => `${e.code}:${e.message}`).join('; ') : text.slice(0, 200);
      throw new Error(`${method} ${path} → ${res.status} ${errs}`);
    }
    return json ? json.result : null;
  };

  const accounts = await cf('/accounts');
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || (accounts && accounts[0] && accounts[0].id);
  if (!accountId) throw new Error('拿不到 account id');

  if (mode === '--add') {
    let zone = null;
    try {
      const zones = await cf(`/zones?name=${encodeURIComponent(domain)}`);
      zone = zones && zones[0];
    } catch { /* ignore */ }
    if (!zone) {
      zone = await cf('/zones', { method: 'POST', body: { name: domain, account: { id: accountId }, jump_start: true } });
      console.log('已添加域名到 Cloudflare:', zone.name);
    } else {
      console.log('域名已存在:', zone.name, 'status=' + zone.status);
    }
    console.log('\n请到你的域名注册商后台，把 DNS 服务器改成：');
    for (const ns of zone.name_servers || []) console.log('   ' + ns);
    console.log('\n改完通常几分钟到几小时生效，然后运行：');
    console.log(`   node deploy/attach-domain.mjs --bind ${domain}`);
    return;
  }

  if (mode === '--bind') {
    const zones = await cf(`/zones?name=${encodeURIComponent(domain)}`);
    const zone = zones && zones[0];
    if (!zone) throw new Error('账号里没有这个域名，先运行 --add');
    if (zone.status !== 'active') throw new Error(`域名还没生效（status=${zone.status}），请等 NS 生效后再试`);

    const host = 'game.' + domain;
    // 绑定 Worker 自定义域名
    try {
      await cf(`/accounts/${accountId}/workers/domains`, {
        method: 'PUT',
        body: { zone_id: zone.id, hostname: host, service: SCRIPT_NAME, environment: 'production' },
      });
      console.log('已绑定:', host, '→', SCRIPT_NAME);
    } catch (e) {
      console.warn('绑定返回:', e.message);
      console.warn('（如果提示已存在，可忽略）');
    }

    // 等 DNS 生效
    let ok = false;
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`https://${host}/api/health`, { headers: { Origin: 'https://xxxxu-ll.github.io' } });
        const j = await r.json();
        if (j && j.ok) { ok = true; console.log('健康检查通过:', JSON.stringify(j)); break; }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 8000));
    }
    if (!ok) throw new Error('域名已绑定但健康检查没通过，稍后重试或检查 DNS');

    // 更新 deployed.json，后续发布脚本会自动用新地址
    const depPath = join(ROOT, 'dist', 'deployed.json');
    const dep = existsSync(depPath) ? JSON.parse(await readFile(depPath, 'utf8')) : {};
    dep.apiBase = `https://${host}/api`;
    dep.workerUrl = `https://${host}`;
    dep.customDomain = host;
    dep.updatedAt = new Date().toISOString();
    await writeFile(depPath, JSON.stringify(dep, null, 2));
    console.log('\n已更新 dist/deployed.json，接下来运行：');
    console.log('   node deploy/publish-pages.mjs');
    return;
  }

  throw new Error('未知参数，用法: --add <域名> | --bind <域名>');
}

main().catch(e => { console.error('失败:', e.message); process.exitCode = 1; });
