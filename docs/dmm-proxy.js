/**
 * Cloudflare Worker: DMM API 反代
 * 用途：vercel.app 域名对国内访问不友好，本 Worker 提供 CF 边缘入口
 * 请求原样转发到 Vercel，响应原样返回（API Key 校验与 Redis 缓存在 Vercel 层完成）
 * 请求示例:
 * GET /BDSM-091?key=YOUR_KEY
 * GET /?code=BDSM-091&key=YOUR_KEY
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    // Host 是 fetch 的禁止头，自动重写为 vercel-dmm.vercel.app，Vercel 才能正确识别
    return fetch(`https://vercel-dmm.vercel.app${url.pathname}${url.search}`, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });
  }
};
