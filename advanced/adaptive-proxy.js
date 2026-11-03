/**
 * Cloudflare Worker: DMM API 反代
 * 用途：vercel.app 域名对国内访问不友好，本 Worker 提供 CF 边缘入口
 * 请求原样转发到上游，响应原样返回（API Key 校验与 Redis 缓存在 Vercel 层完成）
 *
 * ⚙️ 上游域名只用环境变量 DOMAIN，**带不带 https:// 都行**：
 *     DOMAIN = api.example.com
 *     DOMAIN = https://api.example.com/
 *     DOMAIN = http://127.0.0.1:3000            （显式写了协议就按你写的来）
 *     DOMAIN = example.com/base                 （允许带路径前缀）
 *   设置位置（二选一，改完都要重新 Deploy 才生效）：
 *     · Cloudflare Dashboard → Workers & Pages → 本 Worker → Settings → Variables and Secrets
 *     · 或 wrangler 配置里的 [vars]：DOMAIN = "..."
 *
 * 失败时的对外表现（都不写任何响应内容、都不抛异常）：
 *   · DOMAIN 未配置 / 值非法 → 404 空响应
 *   · 上游请求失败（网络/DNS 等） → 502 空响应
 *   原因只写进 Worker 日志（console.error），访客看不到任何配置信息。
 *
 * 请求示例:
 * GET /BDSM-091?key=YOUR_KEY
 * GET /?code=BDSM-091&key=YOUR_KEY
 */

/** DOMAIN 未配置/非法：空 404（用工厂函数，每次返回新 Response） */
const notConfigured = () => new Response(null, { status: 404 });
/** 上游请求失败：空 502 */
const badGateway = () => new Response(null, { status: 502 });

/**
 * 把 DOMAIN 归一成可直接给 fetch 的源：
 * 去首尾空白与包裹引号 → 没有协议就补 https:// → 去掉尾部斜杠。
 * 返回空串表示"没配/配了个空白值"，调用方据此走 404。
 */
function normalizeOrigin(value) {
  if (typeof value !== 'string') return '';
  let s = value
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, '');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = normalizeOrigin(env?.DOMAIN);

    let upstream;
    try {
      upstream = new URL(origin);
    } catch {
      console.error('DMM 反代：DOMAIN 未配置或非法，返回 404（未转发）');
      return notConfigured();
    }

    // 允许 DOMAIN 自带路径前缀（如 example.com/base），拼上前缀并去掉多余尾斜杠
    const base = `${upstream.origin}${upstream.pathname.replace(/\/+$/, '')}`;
    // Host 是 fetch 的禁止头，会自动按 URL 重写成上游域名，Vercel 才能正确识别
    try {
      return await fetch(`${base}${url.pathname}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      });
    } catch (err) {
      console.error(`DMM 反代：上游请求失败（${err?.message ?? err}），返回 502`);
      return badGateway();
    }
  }
};
