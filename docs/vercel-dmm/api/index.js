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

// 通道的详情页 URL 格式；搜索入口各自不同：
// digital 走 GraphQL API（api.video.dmm.co.jp，无 geo 拦截），mono 走 HTML 搜索页
const CHANNELS = {
  digital: {
    detail: (cid) => `https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=${cid}/`,
  },
  mono: {
    search: (code) => `https://www.dmm.co.jp/mono/-/search/=/searchstr=${encodeURIComponent(code)}/`,
    detail: (cid) => `https://www.dmm.co.jp/mono/dvd/-/detail/=/cid=${cid}/`,
  },
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
    // 5. 搜索番号：数字版 GraphQL 优先，无匹配回退 mono
    // ----------------------------------------------------
    const found = await searchCid(code);
    if (!found) {
      return sendError(res, ERRORS.ITEM_NOT_FOUND, `Item not found for code: ${code}`);
    }
    const { cid, cookieJar, channel, digitalData } = found;

    // ----------------------------------------------------
    // 6. 取详情：数字版用 GraphQL 详情数据，mono 抓详情页 HTML
    // ----------------------------------------------------
    let detail;
    if (channel === 'digital') {
      detail = {
        title: digitalData.title,
        shortTitle: digitalData.shortTitle,
        coverUrl: digitalData.coverUrl,
        previewUrl: digitalData.previewUrl,
      };
    } else {
      const detailHtml = await fetchDetailPage(cid, cookieJar, channel);
      if (!detailHtml) {
        return sendError(res, ERRORS.ITEM_NOT_FOUND, `Detail page not found for code: ${code}`);
      }
      detail = extractDetail(detailHtml, cid);
    }

    // ----------------------------------------------------
    // 7. 构造数据 & 写入缓存（永久保存：番号数据静态，容量管够；写入失败不影响响应）
    // ----------------------------------------------------
    const resultData = {
      code: cacheKey,
      cid: cid,
      channel: channel,
      title: detail.title,
      short_title: detail.shortTitle,
      cover_url: detail.coverUrl,
      preview_url: detail.previewUrl,
      detail_url: CHANNELS[channel].detail(cid)
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
      return sendJson(res, 200, { code: cacheKey, cid: cached.cid, channel: cached.channel, cached: true });
    }
  }

  const found = await searchCid(code);
  if (!found) {
    return sendError(res, ERRORS.ITEM_NOT_FOUND, `Item not found for code: ${code}`);
  }

  const result = { code: cacheKey, cid: found.cid, channel: found.channel };
  await setCached(`CID:${cacheKey}`, result);
  sendJson(res, 200, { ...result, cached: false });
}

/**
 * 搜索番号：数字版 GraphQL 优先，无匹配回退 mono HTML 搜索
 * @returns {Promise<{ cid: string, cookieJar: Record<string, string>, channel: string, digitalData: Object | null } | null>}
 */
async function searchCid(code) {
  // 1. 数字版：GraphQL API（无 geo 拦截、无需 cookie），失败静默回退
  const digitalData = await searchDigital(code);
  if (digitalData) {
    return { cid: digitalData.cid, cookieJar: {}, channel: 'digital', digitalData };
  }

  // 2. mono 通贩 HTML 搜索兜底
  const cookieJar = {};
  try {
    const html = await fetchSearchPage(code, 'mono', cookieJar);
    const cid = pickCid(html, code);
    if (cid) {
      return { cid, cookieJar, channel: 'mono', digitalData: null };
    }
  } catch (err) {
    // mono 通道失败（被拦/网络问题），按未找到处理
  }
  return null;
}

/**
 * 数字版搜索：FANZA GraphQL API（api.video.dmm.co.jp）
 * 两步：legacySearchPPV 按补零番号搜 id → ppvContent(id) 拿完整详情
 * 实测可用字段：id/title/description（长文）/packageImage.largeUrl/sample2DMovie.highestMovieUrl（预告片）
 * @returns {Promise<{ cid: string, title: string | null, shortTitle: string | null, coverUrl: string | null, previewUrl: string | null } | null>}
 */
async function searchDigital(code) {
  try {
    // 1. 搜索：queryWord 必须 5 位补零格式（实测原番号格式搜不到老片）
    const queryWord = toDigitalQueryWord(code);
    const searchQuery = `{ legacySearchPPV(limit: 10, offset: 0, sort: SALES_RANK_SCORE, floor: AV, queryWord: "${queryWord}") { result { contents { id } } } }`;
    const searchRes = await fetch('https://api.video.dmm.co.jp/graphql', {
      method: 'POST',
      headers: { ...COMMON_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery })
    });
    if (!searchRes.ok) {
      return null;
    }
    const searchJson = await searchRes.json();
    const ids = (searchJson?.data?.legacySearchPPV?.result?.contents || [])
      .map(c => c.id)
      .filter(Boolean);
    const hitId = pickCidFromList(ids, code);
    if (!hitId) {
      return null;
    }

    // 2. 详情：SampleMovieUrl 操作按 id 查询（字段实测全可用）
    const detailQuery = `query SampleMovieUrl($id: ID!) { ppvContent(id: $id) { id title description packageImage { largeUrl } sample2DMovie { highestMovieUrl hlsMovieUrl } } }`;
    const detailRes = await fetch('https://api.video.dmm.co.jp/graphql', {
      method: 'POST',
      headers: { ...COMMON_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: detailQuery, variables: { id: hitId } })
    });
    if (!detailRes.ok) {
      return null;
    }
    const detailJson = await detailRes.json();
    const ppv = detailJson?.data?.ppvContent;
    if (!ppv || !ppv.id) {
      return null;
    }
    return {
      cid: ppv.id,
      title: ppv.description ? decodeHtmlEntities(ppv.description) : null,
      shortTitle: ppv.title ? decodeHtmlEntities(ppv.title) : null,
      coverUrl: ppv.packageImage?.largeUrl || null,
      previewUrl: ppv.sample2DMovie?.highestMovieUrl || null,
    };
  } catch (err) {
    return null;
  }
}

/**
 * 调试模式：探测各通道/候选 URL 的抓取状态，排查 DMM 对 IP 的拦截或路径格式错误
 * @param {string} code - 番号
 */
async function debugProbe(code) {
  const cookieJar = {};
  const result = { probes: [] };

  // age_check 先初始化 cookie（无 cookie 会被年龄确认页拦截）
  try {
    const ageUrl = `https://www.dmm.co.jp/age_check/=/declared=yes/?rurl=${encodeURIComponent('https://www.dmm.co.jp/mono/')}`;
    const ageRes = await fetch(ageUrl, { headers: COMMON_HEADERS, redirect: 'manual' });
    collectCookies(ageRes, cookieJar);
  } catch (err) {
    // 忽略
  }

  // digital 通道的搜索路径格式未确定，列出候选逐一探测
  // （video.dmm.co.jp/av/list 是从 digital 拦截页 rurl 解码得到的官方入口）
  const candidates = [
    ['digital', `https://video.dmm.co.jp/av/list/?key=${encodeURIComponent(code)}`],
    ['digital', `https://www.dmm.co.jp/digital/videoa/-/list/search/=/searchstr=${encodeURIComponent(code)}/`],
    ['digital', `https://www.dmm.co.jp/digital/videoa/-/list/=/searchstr=${encodeURIComponent(code)}/`],
    ['mono', `https://www.dmm.co.jp/mono/-/search/=/searchstr=${encodeURIComponent(code)}/`],
  ];

  for (const [channel, searchUrl] of candidates) {
    const info = { channel, search_url: searchUrl };
    try {
      const res = await fetch(searchUrl, { headers: withCookies(COMMON_HEADERS, cookieJar) });
      info.status = res.status;
      if (res.ok) {
        collectCookies(res, cookieJar);
        const html = await res.text();
        info.html_size = html.length;
        info.title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || null;
        info.cids = [...html.matchAll(/\/detail\/=\/cid=([a-zA-Z0-9_]+)\//g)].map(m => m[1]);
        info.pick = pickCid(html, code);
        // 拦截页时带上关键片段，用于分析拦截类型和放行方式
        if (html.length < 50000) {
          const links = [...html.matchAll(/href="([^"]*age_check[^"]*)"/gi)].map(m => m[1]);
          info.age_links = [...new Set(links)];
          const forms = [...html.matchAll(/<form[^>]*action="([^"]*)"[^>]*>/gi)].map(m => m[1]);
          info.forms = [...new Set(forms)];
        }
      }
    } catch (err) {
      info.error = err.message;
    }
    result.probes.push(info);
  }
  result.cookie_keys = Object.keys(cookieJar);

  // GraphQL 数字版搜索探测（api.video.dmm.co.jp，无 geo 拦截），并试抓数字版详情页的预告片
  try {
    const gqlBody = JSON.stringify({
      query: `{ legacySearchPPV(limit: 10, offset: 0, sort: SALES_RANK_SCORE, floor: AV, queryWord: "${code}") { result { contents { id title } } } }`
    });
    const gqlRes = await fetch('https://api.video.dmm.co.jp/graphql', {
      method: 'POST',
      headers: { ...COMMON_HEADERS, 'Content-Type': 'application/json' },
      body: gqlBody
    });
    result.graphql_status = gqlRes.status;
    const gqlJson = await gqlRes.json();
    const ids = (gqlJson?.data?.legacySearchPPV?.result?.contents || []).map(c => c.id);
    result.graphql_ids = ids;
    if (ids.length > 0) {
      const detailUrl = `https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=${ids[0]}/`;
      try {
        const dRes = await fetch(detailUrl, { headers: withCookies(COMMON_HEADERS, cookieJar) });
        const dHtml = await dRes.text();
        const mp4 = dHtml.match(/https:\/\/[^\s"'<>]*?dmm\.co\.jp[^\s"'<>]*?\.mp4/i);
        result.digital_detail = { url: detailUrl, status: dRes.status, size: dHtml.length, mp4: mp4 ? mp4[0] : null };
      } catch (err) {
        result.digital_detail = { url: detailUrl, error: err.message };
      }

      // 新版详情页探测（video.dmm.co.jp SPA，Next.js，可能带 SSR 数据）
      const contentUrl = `https://video.dmm.co.jp/av/content/?id=${ids[0]}`;
      try {
        const cRes = await fetch(contentUrl, { headers: withCookies(COMMON_HEADERS, cookieJar) });
        const cHtml = await cRes.text();
        const cTitle = (cHtml.match(/<title>([^<]*)<\/title>/i) || [])[1] || null;
        const cMp4 = cHtml.match(/https:\/\/[^\s"'<>]*?\.mp4/i);
        result.content_page = {
          url: contentUrl,
          status: cRes.status,
          size: cHtml.length,
          title: cTitle,
          has_next_data: cHtml.includes('__NEXT_DATA__'),
          has_og: cHtml.includes('og:title'),
          mp4: cMp4 ? cMp4[0] : null,
        };
      } catch (err) {
        result.content_page = { url: contentUrl, error: err.message };
      }
    }
  } catch (err) {
    result.graphql_error = err.message;
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
 * 请求搜索页：先走 age_check 端点拿 cookie（一次），再抓指定通道的搜索页
 * 实测：只带 age_check_done=1 会被年龄确认页拦截，搜索页响应会再下发 ckcy + dmm_service
 * @param {string} code - 番号
 * @param {string} channel - 通道名（digital / mono）
 * @param {Record<string, string>} cookieJar - 跨通道共享的 cookie
 * @returns {Promise<string>} 搜索页 HTML；被拦截/网络失败时抛错
 */
async function fetchSearchPage(code, channel, cookieJar) {
  const searchUrl = CHANNELS[channel].search(code);

  // age_check 端点 302 并下发 age_check_done；jar 里已有则跳过（幂等）
  if (!cookieJar.age_check_done) {
    try {
      const ageUrl = `https://www.dmm.co.jp/age_check/=/declared=yes/?rurl=${encodeURIComponent(searchUrl)}`;
      // redirect:'manual'：fetch 只暴露最终响应头，必须手动收集 302 的 Set-Cookie
      const ageRes = await fetch(ageUrl, { headers: COMMON_HEADERS, redirect: 'manual' });
      collectCookies(ageRes, cookieJar);
    } catch (err) {
      // 忽略，继续无 cookie 抓搜索页
    }
  }

  const searchRes = await fetch(searchUrl, { headers: withCookies(COMMON_HEADERS, cookieJar) });
  if (!searchRes.ok) {
    throw new Error(`DMM ${channel} search failed: HTTP ${searchRes.status}`);
  }
  collectCookies(searchRes, cookieJar);

  const html = await searchRes.text();
  // 年龄确认拦截页：cookie 流程没走通，是环境问题而非番号不存在
  if (html.includes('年齢認証')) {
    throw new Error('Blocked by DMM age check page');
  }
  return html;
}

/**
 * 请求详情页；不存在/已下架的 cid 会被直接断连，一律按未找到处理
 * @param {string} channel - 通道名（digital / mono），决定详情页 URL 格式
 * @returns {Promise<string | null>} 详情页 HTML，失败返回 null
 */
async function fetchDetailPage(cid, cookieJar, channel) {
  const detailUrl = CHANNELS[channel].detail(cid);
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
 * 归一化番号/cid 用于比较：小写、去分隔符、数字段去前导零
 * ipx00118 → ipx118；h_1096bdsm00091 → h1096bdsm91；BDSM-091 → bdsm91
 * （DMM 数字版 id 数字段习惯 5 位补零，与番号直接比较会失配）
 */
function normalizeCode(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(^|[^0-9])0+(?=[0-9])/g, '$1');
}

/**
 * 番号转数字版搜索词：数字段补前导零到 5 位（实测 GraphQL 只认补零格式）
 * IPX-118 → ipx00118；BDSM-091 → bdsm00091；HODV-22112 → hodv22112
 */
function toDigitalQueryWord(code) {
  const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.replace(/(\d+)$/, d => d.padStart(5, '0'));
}

/**
 * 从候选 cid 列表挑选目标
 * 实测：搜索排序不可靠（合集 7ipx118 排第一）、模糊搜索带出无关番号（QQQ-000 → iqqq 系列）、
 * 特典版排在标准版前（41hodv22112a 在 41hodv22112 前），
 * 所以按规则过滤：精确 → 尾部（标准版）→ 含番号 → 放弃
 * @param {string[]} cids - 候选 cid 列表（页面顺序）
 * @param {string} code - 番号
 * @returns {string | null}
 */
function pickCidFromList(cids, code) {
  if (cids.length === 0) {
    return null;
  }
  const norm = normalizeCode(code);
  return cids.find(c => normalizeCode(c) === norm)
    || cids.find(c => normalizeCode(c).endsWith(norm))
    || cids.find(c => normalizeCode(c).includes(norm))
    || null;
}

/**
 * 从搜索页 HTML 提取候选 cid 列表并挑选目标
 */
function pickCid(html, code) {
  const cids = [...html.matchAll(/\/detail\/=\/cid=([a-zA-Z0-9_]+)\//g)].map(m => m[1]);
  return pickCidFromList(cids, code);
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
