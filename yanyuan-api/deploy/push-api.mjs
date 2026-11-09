// 通过 GitHub REST API 推送整个目录（git 直连不稳定时的可靠通道）
// 用法：node tools/push-api.mjs <dir> <owner/repo> [branch]
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const GIT = 'C:\\Users\\徐若凯\\AppData\\Local\\GitHubDesktop\\app-3.6.5\\resources\\app\\git\\cmd\\git.exe';
const [dir, repo, branch = 'main'] = process.argv.slice(2);
if (!dir || !repo) throw new Error('用法: node tools/push-api.mjs <dir> <owner/repo>');

function token() {
  const out = execFileSync(GIT, ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('没有 GitHub 凭证');
  return m[1].trim();
}

const TOKEN = token();
const API = 'https://api.github.com';

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'User-Agent': 'yanyuan-push',
      Accept: 'application/vnd.github+json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return json;
}

async function walk(root, dir, out = []) {
  for (const name of await readdir(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) await walk(root, p, out);
    else out.push({ path: relative(root, p).split(sep).join('/'), full: p });
  }
  return out;
}

async function main() {
  const files = await walk(dir, dir);
  console.log(`准备推送 ${files.length} 个文件 → ${repo}:${branch}`);

  // 当前分支头
  let parent = null;
  try {
    const ref = await api(`/repos/${repo}/git/ref/heads/${branch}`);
    parent = ref.object.sha;
    console.log('  当前 HEAD:', parent.slice(0, 8));
  } catch {
    console.log('  空仓库，将创建首个提交');
  }

  // 逐个上传 blob
  const entries = [];
  let i = 0;
  for (const f of files) {
    const content = await readFile(f.full);
    const blob = await api(`/repos/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
    });
    entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    i++;
    if (i % 10 === 0) console.log(`  已上传 ${i}/${files.length}`);
  }

  const tree = await api(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree: entries }),
  });
  console.log('  tree:', tree.sha.slice(0, 8));

  const commit = await api(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: '像素燕园 v1：全校像素地图、多人在线、服务端存档',
      tree: tree.sha,
      parents: parent ? [parent] : [],
    }),
  });
  console.log('  commit:', commit.sha.slice(0, 8));

  if (parent) {
    await api(`/repos/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } else {
    await api(`/repos/${repo}/git/refs`, {
      method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }
  console.log(`完成：https://github.com/${repo}/tree/${branch}`);
}

main().catch(e => { console.error('推送失败:', e.message); process.exitCode = 1; });
