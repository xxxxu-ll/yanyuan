// Cloudflare Workers 部署（纯 REST，无需 wrangler）
// 使用 Durable Object + 内置 SQLite 存储，不需要 D1 权限。
// 用法：node deploy/cf-deploy.mjs [--dry-run]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SECRETS = resolve(ROOT, '..', '.secrets', 'deploy.env');
const DRY = process.argv.includes('--dry-run');
const SCRIPT_NAME = 'yanyuan-world';
const API = 'https://api.cloudflare.com/client/v4';

function loadEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

async function main() {
  if (!existsSync(SECRETS)) throw new Error('缺少 .secrets/deploy.env');
  const env = { ...loadEnv(await readFile(SECRETS, 'utf8')), ...process.env };
  const token = (env.CLOUDFLARE_API_TOKEN || '').trim();
  const globalKey = (env.CLOUDFLARE_API_KEY || '').trim();
  const email = (env.CLOUDFLARE_EMAIL || '').trim();
  if (!token && !(globalKey && email)) throw new Error('没有可用的 Cloudflare 凭证');
  const usingGlobal = !token;

  const cf = async (path, { method = 'GET', body = null, form = null } = {}) => {
    const headers = usingGlobal
      ? { 'X-Auth-Email': email, 'X-Auth-Key': globalKey }
      : { Authorization: 'Bearer ' + token };
    let payload;
    if (form) payload = form;
    else if (body !== null) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(API + path, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!res.ok || (json && json.success === false)) {
      const errs = (json && json.errors) ? json.errors.map(e => `${e.code}:${e.message}`).join('; ') : text.slice(0, 300);
      const err = new Error(`Cloudflare API ${method} ${path} → ${res.status} ${errs}`);
      err.status = res.status;
      err.cfErrors = json && json.errors;
      throw err;
    }
    return json ? json.result : null;
  };

  console.log('→ 校验凭证', usingGlobal ? '(Global API Key)' : '(API Token)');
  if (!usingGlobal) {
    const verify = await cf('/user/tokens/verify');
    console.log('  token 状态:', verify.status);
  }

  let accountId = (env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!accountId) {
    const accounts = await cf('/accounts');
    if (!accounts || !accounts.length) throw new Error('这个凭证看不到任何账号');
    accountId = accounts[0].id;
  }
  console.log('  account:', accountId);

  const scripts = await cf(`/accounts/${accountId}/workers/scripts`).catch(() => []);
  const exists = (scripts || []).some(s => s.id === SCRIPT_NAME);
  console.log('  现有 Worker:', (scripts || []).map(s => s.id).join(', ') || '(无)');

  if (DRY) {
    console.log('dry-run 结束');
    return;
  }

  // ---- workers.dev 子域 ----
  console.log('→ 准备 workers.dev 子域');
  let sub = null;
  try {
    sub = await cf(`/accounts/${accountId}/workers/subdomain`);
    sub = sub && sub.subdomain;
  } catch { sub = null; }
  if (!sub) {
    const candidates = ['yanyuan-pku', 'yanyuan-campus', 'yanyuan-' + Math.random().toString(36).slice(2, 7)];
    for (const cand of candidates) {
      try {
        const r = await cf(`/accounts/${accountId}/workers/subdomain`, { method: 'PUT', body: { subdomain: cand } });
        sub = (r && r.subdomain) || cand;
        break;
      } catch (e) {
        console.log('  子域名不可用:', cand, e.message.slice(0, 80));
      }
    }
  }
  if (!sub) throw new Error('无法设置 workers.dev 子域');
  console.log('  子域:', sub);

  // ---- 上传 Worker（含 Durable Object 迁移）----
  console.log('→ 上传 Worker');
  const worker = await readFile(join(ROOT, 'dist', 'worker.mjs'), 'utf8');
  const metadata = {
    main_module: 'worker.mjs',
    compatibility_date: '2025-01-01',
    bindings: [
      { type: 'durable_object_namespace', name: 'WORLD', class_name: 'World' },
      { type: 'plain_text', name: 'ALLOW_ORIGINS', text: 'https://xxxxu-ll.github.io' },
      { type: 'plain_text', name: 'ADMIN_KEY', text: (env.ADMIN_KEY || '').trim() },
    ],
  };
  // 首次部署才声明迁移（创建 DO 类）；已存在时沿用既有配置，避免 tag 冲突
  if (!exists) metadata.migrations = { new_tag: 'v1', new_sqlite_classes: ['World'] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
  form.append('worker.mjs', new Blob([worker], { type: 'application/javascript+module' }), 'worker.mjs');
  await cf(`/accounts/${accountId}/workers/scripts/${SCRIPT_NAME}`, { method: 'PUT', form });

  // ---- 开启 workers.dev 路由 ----
  console.log('→ 开启 workers.dev 访问');
  await cf(`/accounts/${accountId}/workers/scripts/${SCRIPT_NAME}/subdomain`, {
    method: 'POST', body: { enabled: true, previews_enabled: false },
  });
  const url = `https://${SCRIPT_NAME}.${sub}.workers.dev`;
  console.log('  地址:', url);

  // ---- 健康检查 ----
  let health = null;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const r = await fetch(url + '/api/health', { headers: { Origin: 'https://xxxxu-ll.github.io' } });
      health = await r.json();
      if (health && health.ok) break;
    } catch { /* retry */ }
  }
  console.log('  健康检查:', JSON.stringify(health));
  if (!health || !health.ok) throw new Error('Worker 已上传但健康检查没通过');

  const out = {
    accountId, workerUrl: url, apiBase: url + '/api',
    subdomain: sub, deployedAt: new Date().toISOString(), health,
  };
  await mkdir(join(ROOT, 'dist'), { recursive: true });
  await writeFile(join(ROOT, 'dist', 'deployed.json'), JSON.stringify(out, null, 2));
  console.log('\n完成。API Base =', out.apiBase);
}

main().catch((e) => {
  console.error('部署失败:', e.message);
  process.exitCode = 1;
});
