// Cloudflare Worker 入口：把 /api/* 全部转给同一个 Durable Object，
// 让世界状态（在线玩家、聊天、存档）只有一个写入点，避免多实例不同步。
// 该文件由 build.mjs 与 src/core.mjs、worker/world.mjs 拼成单文件 Worker。

function allowedOrigins(env) {
  const raw = (env && env.ALLOW_ORIGINS) || 'https://xxxxu-ll.github.io';
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

function corsFor(origin, env) {
  if (!origin) return {};
  const allowed = allowedOrigins(env);
  const ok = allowed.some(o => o === origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!ok) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsFor(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ ok: true, service: 'yanyuan-world', api: '/api/health' }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
      });
    }

    try {
      const id = env.WORLD.idFromName('yanyuan-main');
      const stub = env.WORLD.get(id);
      const res = await stub.fetch(request);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      out.headers.set('X-Content-Type-Options', 'nosniff');
      out.headers.set('Referrer-Policy', 'no-referrer');
      out.headers.set('Cache-Control', 'no-store');
      return out;
    } catch (err) {
      return new Response(JSON.stringify({ error: 'server_error', message: '世界服务出错了' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
      });
    }
  },
};
