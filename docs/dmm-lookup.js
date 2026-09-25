/**
 * Cloudflare Worker: DMM 番号查询 API (带 API Key 校验 & KV 缓存)
 * KV名称：必须填写：DMM_KV
 * Variable name（变量名称） 填写：API_KEY
 *
 * API Key 传递方式（任选其一）:
 * 1. Header 头: x-api-key: YOUR_KEY
 * 2. URL 参数:  ?key=YOUR_KEY
 *
 * 请求示例:
 * GET /BDSM-091?key=YOUR_SECRET_KEY
 * GET /?code=BDSM-091&key=YOUR_SECRET_KEY
 *
 * 抓取流程（2026-09 实测）:
 * 1. age_check 端点下发 age_check_done cookie（只带它不够，但它是前置条件）
 * 2. 搜索页响应再下发 ckcy + dmm_service cookie，携带三者访问详情页
 * 3. 详情页: og:image 封面 / og:description 长标题 / og:title 短标题，
 *    预告片 URL 嵌在 JS 里且为 \/ 转义形式
 */

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
};

// 番号信息不变，缓存 7 天（KV expirationTtl 下限为 60 秒）
const CACHE_TTL = 7 * 24 * 3600;

// 错误码字典定义
const ERRORS = {
  MISSING_CODE: { status: 400, code: 40001, error: 'MISSING_CODE', message: 'Please provide a valid code, e.g. /BDSM-091 or /?code=BDSM-091' },
  MISSING_API_KEY: { status: 401, code: 40101, error: 'MISSING_API_KEY', message: 'API Key is missing. Provide via query parameter ?key= or Header x-api-key.' },
  INVALID_API_KEY: { status: 403, code: 40301, error: 'INVALID_API_KEY', message: 'Invalid API Key provided.' },
  ITEM_NOT_FOUND: { status: 404, code: 40401, error: 'ITEM_NOT_FOUND', message: 'Item not found for the requested code.' },
  SERVER_ERROR: { status: 500, code: 50001, error: 'INTERNAL_SERVER_ERROR', message: 'An internal error occurred while processing your request.' }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 浏览器跨域带自定义头 x-api-key 会先发 OPTIONS 预检，不放行则请求直接失败
    if (request.method === 'OPTIONS') {
      return responseJSON({}, 204);
    }

    // ----------------------------------------------------
    // 1. API Key 身份验证
    // ----------------------------------------------------
    // 支持从 Header 或 Query 参数获取 key
    const clientKey = request.headers.get('x-api-key') || url.searchParams.get('key');
    const validKey = env.API_KEY; // 从环境变量获取系统设定的密钥

    // 如果 Worker 设定了环境变量 API_KEY，则进行校验
    if (validKey) {
      if (!clientKey) {
        return buildErrorResponse(ERRORS.MISSING_API_KEY);
      }
      if (clientKey !== validKey) {
        return buildErrorResponse(ERRORS.INVALID_API_KEY);
      }
    }

    // ----------------------------------------------------
    // 2. 解析番号参数
    // ----------------------------------------------------
    let code = url.searchParams.get('code');
    if (!code) {
      code = url.pathname.replace(/^\//, '').trim();
    }

    if (!code) {
      return buildErrorResponse(ERRORS.MISSING_CODE);
    }

    const cacheKey = code.toUpperCase();

    // 调试模式：返回 DMM 抓取过程的中间状态，排查反爬/拦截用（已通过 API Key 校验）
    if (url.searchParams.get('debug') === '1') {
      return responseJSON(await debugProbe(code), 200);
    }

    try {
      // ----------------------------------------------------
      // 3. KV 缓存匹配
      // ----------------------------------------------------
      if (env.DMM_KV) {
        const cachedData = await env.DMM_KV.get(cacheKey, { type: 'json' });
        if (cachedData) {
          cachedData.cached = true;
          return responseJSON(cachedData, 200);
        }
      }

      // ----------------------------------------------------
      // 4. 年龄确认 → 搜索页拿 CID
      // ----------------------------------------------------
      const searchResult = await fetchSearchPage(code);
      const cid = pickCid(searchResult.html, code);
      if (!cid) {
        return buildErrorResponse(ERRORS.ITEM_NOT_FOUND, `Item not found for code: ${code}`);
      }

      // ----------------------------------------------------
      // 5. 抓取 DMM 详情页解析数据
      // ----------------------------------------------------
      const detailHtml = await fetchDetailPage(cid, searchResult.cookieJar);
      if (!detailHtml) {
        return buildErrorResponse(ERRORS.ITEM_NOT_FOUND, `Detail page not found for code: ${code}`);
      }

      const detail = extractDetail(detailHtml, cid);

      // ----------------------------------------------------
      // 6. 构造数据 & 写入缓存
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

      if (env.DMM_KV) {
        await env.DMM_KV.put(cacheKey, JSON.stringify(resultData), {
          expirationTtl: CACHE_TTL
        });
      }

      resultData.cached = false;
      return responseJSON(resultData, 200);

    } catch (err) {
      return buildErrorResponse(ERRORS.SERVER_ERROR, err.message);
    }
  }
};

/**
 * 调试模式：逐步抓取并记录中间状态，排查 DMM 对 Worker IP 的拦截
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

  // Worker 自身出口探测：判断 DMM 视角下的请求来源（ip + colo 位置）
  try {
    const traceRes = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { headers: COMMON_HEADERS });
    const traceText = await traceRes.text();
    result.worker_egress = Object.fromEntries(
      traceText.trim().split('\n').map(line => line.split('='))
    );
  } catch (err) {
    result.worker_egress_error = err.message;
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
 * 构造统一错误响应
 */
function buildErrorResponse(errorType, customMessage = null) {
  const payload = {
    code: errorType.code,
    error: errorType.error,
    message: customMessage || errorType.message
  };
  return responseJSON(payload, errorType.status);
}

/**
 * 格式化 JSON 响应与 CORS 配置
 */
function responseJSON(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key'
    }
  });
}
