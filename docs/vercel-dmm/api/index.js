/**
 * Vercel Function: DMM 番号查询 API
 * 部署区域：东京 hnd1（见 vercel.json）——CF Worker 出口被 DMM geo 拦截，改用东京部署
 * 环境变量：API_KEY（可选，设置后请求必须携带）；REDIS_URL（Redis 存储自动注入，可选）
 * 请求示例:
 * GET /BDSM-091?key=YOUR_KEY           （由 vercel.json rewrite 支持，与 Worker 版一致）
 * GET /api?code=BDSM-091&key=YOUR_KEY
 * GET /api?code=BDSM-091&key=YOUR_KEY&debug=1    （调试：返回抓取中间状态）
 * GET /api?code=BDSM-091&key=YOUR_KEY&refresh=1  （强制绕过缓存重新抓取）
 */

import { createClient } from 'redis';

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
};

// 错误码字典定义（与 Worker 版保持一致）
const ERRORS = {
  MISSING_CODE: { status: 400, code: 40001, error: 'MISSING_CODE', message: 'Please provide a valid code, e.g. /BDSM-091 or /?code=BDSM-091' },
  MISSING_API_KEY: { status: 401, code: 40101, error: 'MISSING_API_KEY', message: 'API Key is missing. Provide via query parameter ?key= or Header x-api-key.' },
  INVALID_API_KEY: { status: 403, code: 40301, error: 'INVALID_API_KEY', message: 'Invalid API Key provided.' },
  ITEM_NOT_FOUND: { status: 404, code: 40401, error: 'ITEM_NOT_FOUND', message: 'Item not found for the requested code.' },
  SERVER_ERROR: { status: 500, code: 50001, error: 'INTERNAL_SERVER_ERROR', message: 'An internal error occurred while processing your request.' }
};

export default async function handler(req, res) {
  // 浏览器跨域带自定义头 x-api-key 会先发 OPTIONS 预检，不放行则请求直接失败
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  // ----------------------------------------------------
  // 1. API Key 身份验证
  // ----------------------------------------------------
  const clientKey = req.headers['x-api-key'] || req.query.key;
  const validKey = process.env.API_KEY;

  if (validKey) {
    if (!clientKey) {
      return sendError(res, ERRORS.MISSING_API_KEY);
    }
    if (clientKey !== validKey) {
      return sendError(res, ERRORS.INVALID_API_KEY);
    }
  }

  // ----------------------------------------------------
  // 2. 解析番号参数
  // ----------------------------------------------------
  const code = (req.query.code || '').toString().trim();

  if (!code) {
    return sendError(res, ERRORS.MISSING_CODE);
  }

  try {
    // 调试模式：返回 DMM 抓取过程的中间状态，排查反爬/拦截用
    if (req.query.debug === '1') {
      return sendJson(res, 200, await debugProbe(code));
    }

    // ----------------------------------------------------
    // 3. 仅查 CID 模式（?only=cid，由 /cid/:code rewrite 进入）：
    //    跳过详情页抓取，只做搜索页 + cid 筛选
    // ----------------------------------------------------
    if (req.query.only === 'cid') {
      return handleCidOnly(res, req, code);
    }

    // ----------------------------------------------------
    // 4. Redis 缓存匹配（?refresh=1 强制绕过；未配置/失败时静默跳过）
    // ----------------------------------------------------
    const cacheKey = code.toUpperCase();
    if (req.query.refresh !== '1') {
      const cached = await getCached(cacheKey);
      if (cached) {
        return sendJson(res, 200, { ...cached, cached: true });
      }
    }

    // ----------------------------------------------------
    // 5. 年龄确认 → 搜索页拿 CID
    // ----------------------------------------------------
    const searchResult = await fetchSearchPage(code);
    const cid = pickCid(searchResult.html, code);
    if (!cid) {
      return sendError(res, ERRORS.ITEM_NOT_FOUND, `Item not found for code: ${code}`);
    }

    // ----------------------------------------------------
    // 6. 抓取 DMM 详情页解析数据
    // ----------------------------------------------------
    const detailHtml = await fetchDetailPage(cid, searchResult.cookieJar);
    if (!detailHtml) {
      return sendError(res, ERRORS.ITEM_NOT_FOUND, `Detail page not found for code: ${code}`);
    }

    const detail = extractDetail(detailHtml, cid);

    // ----------------------------------------------------
    // 7. 构造数据 & 写入缓存（永久保存：番号数据静态，容量管够；写入失败不影响响应）
    // ----------------------------------------------------
    const resultData = {
      code: cacheKey,
      cid: cid,
      title: detail.title,
      short_title: detail.shortTitle,
      cover_url: detail.coverUrl,
      preview_url: detail.previewUrl,
      detail_url: `https://www.dmm.co.jp/mono/dvd/-/detail/=/cid=${cid}/`
    };

    try {
      await setCached(cacheKey, resultData);
    } catch (err) {
      // 写入失败不影响响应
    }

    sendJson(res, 200, { ...resultData, cached: false });
  } catch (err) {
    sendError(res, ERRORS.SERVER_ERROR, err.message);
  }
}

/**
 * 仅查 CID：跳过详情页抓取，只返回 cid
 * 缓存优先复用完整查询的结果（key 相同），其次 cid 专属缓存（CID: 前缀）
 */
async function handleCidOnly(res, req, code) {
  const cacheKey = code.toUpperCase();

  if (req.query.refresh !== '1') {
    const cached = (await getCached(cacheKey)) || (await getCached(`CID:${cacheKey}`));
    if (cached) {
      return sendJson(res, 200, { code: cacheKey, cid: cached.cid, cached: true });
    }
  }

  const { html } = await fetchSearchPage(code);
  const cid = pickCid(html, code);
  if (!cid) {
    return sendError(res, ERRORS.ITEM_NOT_FOUND, `Item not found for code: ${code}`);
  }

  const result = { code: cacheKey, cid };
  await setCached(`CID:${cacheKey}`, result);
  sendJson(res, 200, { ...result, cached: false });
}

/**
 * 调试模式：逐步抓取并记录中间状态，排查 DMM 对 IP 的拦截
 * @param {string} code - 番号
 */
async function debugProbe(code) {
  const cookieJar = {};
  const searchUrl = `https://www.dmm.co.jp/mono/-/search/=/searchstr=${encodeURIComponent(code)}/`;
  const result = { search_url: searchUrl };

  try {
    const ageUrl = `https://www.dmm.co.jp/age_check/=/declared=yes/?rurl=${encodeURIComponent(searchUrl)}`;
    const ageRes = await fetch(ageUrl, { headers: COMMON_HEADERS, redirect: 'manual' });
    result.age_status = ageRes.status;
    collectCookies(ageRes, cookieJar);
  } catch (err) {
    result.age_error = err.message;
  }

  try {
    const searchRes = await fetch(searchUrl, { headers: withCookies(COMMON_HEADERS, cookieJar) });
    result.search_status = searchRes.status;
    collectCookies(searchRes, cookieJar);
    const html = await searchRes.text();
    result.html_size = html.length;
    result.title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || null;
    result.html_head = html.slice(0, 300);
    result.cookie_keys = Object.keys(cookieJar);
    result.cid = pickCid(html, code);
  } catch (err) {
    result.search_error = err.message;
  }

  // 自身出口探测：判断 DMM 视角下的请求来源（ip + 位置）
  try {
    const traceRes = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { headers: COMMON_HEADERS });
    const traceText = await traceRes.text();
    result.egress = Object.fromEntries(
      traceText.trim().split('\n').map(line => line.split('='))
    );
  } catch (err) {
    result.egress_error = err.message;
  }

  return result;
}

/**
 * 请求搜索页：先走 age_check 端点拿 cookie，再抓搜索页
 * 实测：只带 age_check_done=1 会被年龄确认页拦截，搜索页响应会再下发 ckcy + dmm_service
 * @param {string} code - 番号
 * @returns {Promise<{ html: string, cookieJar: Record<string, string> }>}
 */
async function fetchSearchPage(code) {
  const cookieJar = {};
  const searchUrl = `https://www.dmm.co.jp/mono/-/search/=/searchstr=${encodeURIComponent(code)}/`;

  // age_check 端点 302 并下发 age_check_done；部分 IP 不弹年龄确认，失败不致命
  try {
    const ageUrl = `https://www.dmm.co.jp/age_check/=/declared=yes/?rurl=${encodeURIComponent(searchUrl)}`;
    // redirect:'manual'：fetch 只暴露最终响应头，必须手动收集 302 的 Set-Cookie
    const ageRes = await fetch(ageUrl, { headers: COMMON_HEADERS, redirect: 'manual' });
    collectCookies(ageRes, cookieJar);
  } catch (err) {
    // 忽略，继续无 cookie 抓搜索页
  }

  const searchRes = await fetch(searchUrl, { headers: withCookies(COMMON_HEADERS, cookieJar) });
  if (!searchRes.ok) {
    throw new Error(`DMM search request failed: HTTP ${searchRes.status}`);
  }
  collectCookies(searchRes, cookieJar);

  const html = await searchRes.text();
  // 年龄确认拦截页：cookie 流程没走通，是环境问题而非番号不存在
  if (html.includes('年齢認証')) {
    throw new Error('Blocked by DMM age check page');
  }
  return { html, cookieJar };
}

/**
 * 请求详情页；不存在/已下架的 cid 会被直接断连，一律按未找到处理
 * @returns {Promise<string | null>} 详情页 HTML，失败返回 null
 */
async function fetchDetailPage(cid, cookieJar) {
  const detailUrl = `https://www.dmm.co.jp/mono/dvd/-/detail/=/cid=${cid}/`;
  try {
    const res = await fetch(detailUrl, { headers: withCookies(COMMON_HEADERS, cookieJar) });
    if (!res.ok) {
      return null;
    }
    const html = await res.text();
    // 拦截页/空壳页没有作品信息，按未找到处理
    if (!html.includes('og:title') && !html.includes('pl.jpg')) {
      return null;
    }
    return html;
  } catch (err) {
    return null;
  }
}

/**
 * 从搜索页 HTML 挑选目标 cid
 * 实测：搜索排序不可靠（搜 IPX-118 时合集 7ipx118 排第一）、
 * 模糊搜索会带出无关番号（搜 QQQ-000 返回一堆 iqqq 系列），
 * 所以按规则过滤：精确匹配 → cid 含番号 → 放弃
 * @param {string} html - 搜索页 HTML
 * @param {string} code - 番号
 * @returns {string | null}
 */
function pickCid(html, code) {
  const cids = [...html.matchAll(/\/mono\/dvd\/-\/detail\/=\/cid=([a-zA-Z0-9_]+)\//g)].map(m => m[1]);
  if (cids.length === 0) {
    return null;
  }

  const normalized = code.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return cids.find(c => c.toLowerCase() === normalized)
    || cids.find(c => c.toLowerCase().includes(normalized))
    || null;
}

/**
 * 从详情页 HTML 提取作品信息
 * JS 字符串里的 URL 形如 https:\/\/cc3001.dmm.co.jp\/...，先统一还原 \/ 为 / 再匹配
 * @param {string} html - 详情页 HTML
 * @param {string} cid
 * @returns {{ coverUrl: string, previewUrl: string | null, title: string | null, shortTitle: string | null }}
 */
function extractDetail(html, cid) {
  const unescaped = html.replace(/\\\//g, '/');

  // 封面：og:image 实测稳定指向 {cid}pl.jpg 大图；兜底按命名规律拼接
  const coverMatch = unescaped.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
  const coverUrl = coverMatch
    ? coverMatch[1]
    : `https://pics.dmm.co.jp/mono/movie/adult/${cid}/${cid}pl.jpg`;

  // 预告片：不写死 host（cc3001 只是当前 CDN 节点），文件名无规律只能整体提取
  const previewMatch = unescaped.match(/https:\/\/[^\s"'<>]*?dmm\.co\.jp[^\s"'<>]*?\.mp4/i);
  const previewUrl = previewMatch ? previewMatch[0] : null;

  // 长标题（作品介绍文）：og:description
  const descMatch = unescaped.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
  const title = descMatch ? decodeHtmlEntities(descMatch[1]) : null;

  // 短标题：og:title，h1 兜底
  const ogTitleMatch = unescaped.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
  const h1Match = unescaped.match(/<h1[^>]*id="title"[^>]*>([\s\S]*?)<\/h1>/i);
  let shortTitle = ogTitleMatch ? ogTitleMatch[1] : null;
  if (!shortTitle && h1Match) {
    shortTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
  }
  shortTitle = shortTitle ? decodeHtmlEntities(shortTitle) : null;

  return { coverUrl, previewUrl, title, shortTitle };
}

/**
 * 把响应里的 Set-Cookie 头合并进 cookie jar（只取 name=value，丢弃属性）
 */
function collectCookies(response, jar) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('Set-Cookie')].filter(Boolean);
  for (const cookie of setCookies) {
    const pair = cookie.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) {
      jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
    }
  }
}

/**
 * 在基础请求头上附加 Cookie 头（jar 为空时不带 Cookie 头）
 */
function withCookies(headers, jar) {
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  return cookie ? { ...headers, 'Cookie': cookie } : headers;
}

/**
 * 解码 HTML 实体（DMM 内容里的 &amp; &#39; 等）
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * 读取缓存：Serverless 无连接池，每次请求建连用完即断（个人低并发足够）
 * REDIS_URL 未配置或 Redis 故障时返回 null，主流程降级为直接抓取
 */
async function getCached(key) {
  let client;
  try {
    client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 3000 } });
    await client.connect();
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  } finally {
    if (client) {
      client.destroy();
    }
  }
}

/**
 * 写入缓存：永久保存（无 TTL）；Free 计划无持久化，数据丢失时自动重抓兜底
 */
async function setCached(key, data) {
  let client;
  try {
    client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 3000 } });
    await client.connect();
    await client.set(key, JSON.stringify(data));
  } catch (err) {
    // 忽略写入失败
  } finally {
    if (client) {
      client.destroy();
    }
  }
}

/**
 * 统一 JSON 响应（带 CORS 头）
 */
function sendJson(res, status, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.status(status).json(data);
}

/**
 * 构造统一错误响应
 */
function sendError(res, errorType, customMessage = null) {
  sendJson(res, errorType.status, {
    code: errorType.code,
    error: errorType.error,
    message: customMessage || errorType.message
  });
}
