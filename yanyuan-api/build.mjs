// 把 src/core.mjs、worker/glue.mjs、worker/world.mjs 拼成单文件 Worker（含 Durable Object）
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
process.chdir(ROOT);

const core = await readFile('src/core.mjs', 'utf8');
const glue = await readFile('worker/glue.mjs', 'utf8');
const world = await readFile('worker/world.mjs', 'utf8');

const stripped = core
  .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
  .replace(/^export\s+/gm, '');

if (/^\s*export\s/m.test(stripped)) throw new Error('core.mjs 中仍有 export 语句，无法内联');
if (!/export\s+class\s+World/.test(world)) throw new Error('world.mjs 必须导出 World 类');

const banner = '// 《像素燕园》世界服务 Worker（由 build.mjs 自动生成，勿手改）\n';
const bundled = banner + stripped + '\n' + glue + '\n' + world;

// 语法校验
const tmp = join(tmpdir(), `yanyuan-worker-${Date.now()}.mjs`);
await writeFile(tmp, bundled);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
} finally {
  await rm(tmp, { force: true });
}

await mkdir('dist', { recursive: true });
await writeFile('dist/worker.mjs', bundled);
await mkdir('dist/migrations', { recursive: true });
for (const f of ['0001_init.sql']) {
  await writeFile(join('dist', 'migrations', f), await readFile(join('migrations', f), 'utf8'));
}
await writeFile('dist/meta.json', JSON.stringify({
  builtAt: new Date().toISOString(),
  bytes: Buffer.byteLength(bundled),
  module: 'worker.mjs',
  durableObject: 'World',
}, null, 2));

console.log(`[build] dist/worker.mjs ${(Buffer.byteLength(bundled) / 1024).toFixed(1)} KB（含 Durable Object）`);
