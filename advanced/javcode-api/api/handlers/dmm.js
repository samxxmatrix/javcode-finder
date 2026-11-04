/**
 * Vercel Function: DMM / FALENO 番号查询 API
 * 部署区域：东京 hnd1（见 vercel.json）——CF Worker 出口被 DMM geo 拦截，改用东京部署
 * 环境变量：API_KEY（可选，设置后请求必须携带）；REDIS_URL（Redis 存储自动注入，可选）；
 *          FALENO_ORIGIN（可选，FALENO 源站，默认 https://faleno.jp）；
 *          可选调参：PREVIEW_HEIGHT_MIN / PREVIEW_HEIGHT_MAX（档位区间，默认 320/600）、
 *          PROBE_BUDGET_MS（playlist 探测总预算，默认 12000）、
 *          INCOMPLETE_CACHE_TTL_SECONDS（资料不全条目的缓存秒数，默认 21600，0 = 关闭该策略）
 * 请求示例:
 * GET /BDSM-091?key=YOUR_KEY           （由 vercel.json rewrite 支持，与 Worker 版一致）
 * GET /faleno/FNS-263?key=YOUR_KEY     （FALENO 作品页，返回与 DMM 相同的字段形状）
 * GET /api?code=BDSM-091&key=YOUR_KEY
 * GET /api?code=BDSM-091&key=YOUR_KEY&debug=1    （调试：返回抓取中间状态）
 * GET /api?code=BDSM-091&key=YOUR_KEY&refresh=1  （强制绕过缓存重新抓取）
 */

import { createClient } from 'redis';
import {
  DEFAULT_MAX_HEIGHT,
  DEFAULT_MIN_HEIGHT,
  familyVariants,
  orderByPreference,
  parseHlsVariants,
  pickVariant,
  qualityLabel,
  shapeQualities,
  toMp4Url,
} from '../lib/preview-quality.js';
import {
  HIT,
  NOT_FOUND,
  UPSTREAM,
  classifyHttpStatus,
  combineRouteOutcomes,
  hasDetailContent,
  isBlockedPage,
} from '../lib/upstream-outcome.js';
import { SCHEMA_VERSION, cacheKeyFrom, entryTtlSeconds, INCOMPLETE_TTL_SECONDS, usableEntry } from '../lib/cache-entry.js';

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
};

// FALENO 作品页源站；换源只改环境变量 FALENO_ORIGIN
const FALENO_ORIGIN = (process.env.FALENO_ORIGIN || 'https://faleno.jp').replace(/\/+$/, '');

// 上游超时（毫秒）：接入前只有 FALENO 那一路有超时，DMM 四条上游全无 —— 挂住就挂到平台时限，
// "无法定性"的分类逻辑永远拿不到信号。取值参考 d2pass 实测（源站冷连接 1.7–2.8s，3s 会假 404）。
const TIMEOUT = {
  graphql: 6000,
  monoSearch: 8000,
  monoDetail: 8000,
  playlist: 5000,
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
  // 上游查不动（超时/网络错/WAF 403/拦截页）：不能报成"番号不存在"，否则客户端把接口抖动当查无
  SOURCE_UNAVAILABLE: { status: 503, code: 50301, error: 'SOURCE_UNAVAILABLE', message: 'DMM source is temporarily unavailable. Please retry later.' },
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
  // 2. 解析番号 + 键卫生守门（纯语法；脏入参不产生缓存键）
  // ----------------------------------------------------
  const code = (req.query.code || '').toString().trim();

  if (!code) {
    return sendError(res, ERRORS.MISSING_CODE);
  }

  // canonical 只在"入参本身就是干净短标识符"时非空；为空 = 不读也不写缓存。
  // 搜索仍用原始入参（DMM 搜索容忍分隔符/噪声，这是它能查到脏输入的原因，保留该宽容度）。
  const cacheKey = cacheKeyFrom(code);

  // ?quality=432p → 432；非法/缺省 → null（走默认区间 [320,600] 取中点）
  const qualityMatch = /^(\d{3,4})p$/i.exec(String(req.query.quality || '').trim());
  const quality = qualityMatch ? Number(qualityMatch[1]) : null;

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
      // await 不可省：handleCidOnly 内部若有 rejection，只有 await 才落进下面的外层 catch
      // （直接 return promise 的话异常逃出 handler，客户端一个响应都拿不到）
      return await handleCidOnly(res, req, code);
    }

    // ----------------------------------------------------
    // 3b. FALENO 作品页查询（?only=faleno，由 /faleno/:code rewrite 进入）：
    //     返回与 DMM 完全相同的字段形状，扩展侧复用同一套解析与错误处理
    // ----------------------------------------------------
    if (req.query.only === 'faleno') {
      // 同 ?only=cid：必须 await，否则 handleFaleno 的 rejection 连外层 catch 都观察不到
      return await handleFaleno(res, req, code);
    }

    // ----------------------------------------------------
    // 4. Redis 缓存匹配（?refresh=1 强制绕过；键为空 / 未配置 / 失败时静默跳过）
    //    版本不符 / 键值不一致（脏条目）/ 档位不符都当未命中，重解析后覆盖写回
    // ----------------------------------------------------
    if (cacheKey && req.query.refresh !== '1') {
      const cached = usableEntry(await getCached(cacheKey), cacheKey, quality);
      if (cached) {
        return sendJson(res, 200, { ...cached, cached: true });
      }
    }

    // ----------------------------------------------------
    // 5. 搜索番号：数字版 GraphQL 优先，无匹配回退 mono
    // ----------------------------------------------------
    const found = await searchCid(code, quality);
    // 只有确认查无才是 404，其余一切（含未知 outcome）都按"上游查不动"报 503：
    // 写成"非 HIT ⇒ 报错"而非两段式 === 判断，未知值才不会掉进下面的详情分支
    if (found.outcome !== HIT) {
      if (found.outcome === NOT_FOUND) {
        return sendError(res, ERRORS.ITEM_NOT_FOUND, `Item not found for code: ${code}`);
      }
      return sendError(res, ERRORS.SOURCE_UNAVAILABLE, null, { 'Retry-After': '5' });
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
        previewQuality: digitalData.previewQuality,
        previewQualities: digitalData.previewQualities,
        // ⚠️ 三个封面浮条字段必须一起带过来：resultData 从 detail.* 取，
        // 漏在重组的字面量里会让 digital 通道静默返回空元数据（本地 mono/faleno 检查抓不到）
        actresses: digitalData.actresses,
        deliveryDate: digitalData.deliveryDate,
        saleDate: digitalData.saleDate,
      };
    } else {
      const page = await fetchDetailPage(cid, cookieJar, channel);
      if (page.outcome !== HIT) {
        if (page.outcome === NOT_FOUND) {
          return sendError(res, ERRORS.ITEM_NOT_FOUND, `Detail page not found for code: ${code}`);
        }
        return sendError(res, ERRORS.SOURCE_UNAVAILABLE, null, { 'Retry-After': '5' });
      }
      detail = extractDetail(page.html, cid);
      // 详情页只给一个 mp4 地址（没有 playlist），按静态家族表在同目录逐档探测（spec §6）；
      // 探测失败时 probeFamilyPreview 保留原 URL，不会降画质
      detail = { ...detail, ...(await probeFamilyPreview(detail.previewUrl, quality)) };
    }

    // ----------------------------------------------------
    // 7. 构造数据 & 写入缓存（永久保存：番号数据静态，容量管够；写入失败不影响响应）
    //    脏入参（cacheKey 为空）照常响应，但绝不落盘 —— 脏键永远不会产生
    // ----------------------------------------------------
    const resultData = {
      v: SCHEMA_VERSION,
      code: cacheKey || code.toUpperCase(),
      quality: quality ?? null,
      cid: cid,
      channel: channel,
      title: detail.title,
      short_title: detail.shortTitle,
      cover_url: detail.coverUrl,
      preview_url: detail.previewUrl,
      preview_quality: detail.previewQuality ?? null,
      preview_qualities: detail.previewQualities ?? [],
      // 封面浮条用（spec §4.2）：出演者数组 + 两个**原始抓取值**的日期，扩展侧做优先级与归一化
      actresses: detail.actresses || [],
      delivery_date: detail.deliveryDate || null,
      sale_date: detail.saleDate || null,
      detail_url: CHANNELS[channel].detail(cid)
    };

    if (cacheKey) {
      try {
        await setCached(cacheKey, resultData, entryTtlSeconds(resultData, incompleteCacheTtl()));
      } catch (err) {
        // 写入失败不影响响应
      }
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
  const cacheKey = cacheKeyFrom(code);

  if (cacheKey && req.query.refresh !== '1') {
    // 普通键优先；其次 CID 专属键。两者都要过版本 + 键值一致性守卫（spec §14）。
    // 这里不校验 quality（cid 与档位无关），故 usableEntry 走两参形式。
    const cached =
      usableEntry(await getCached(cacheKey), cacheKey) ||
      usableEntry(await getCached(`CID:${cacheKey}`), cacheKey);
    if (cached) {
      return sendJson(res, 200, { code: cacheKey, cid: cached.cid, channel: cached.channel, cached: true });
    }
  }

  const found = await searchCid(code);
  // 与全量查询路径同一套定性规则：非 HIT 一律走错误分支（查无 → 404，其余 → 503），
  // 不把非命中当命中回 200；键卫生守门本路径已接线：cacheKey 为空则不读也不写缓存
  if (found.outcome !== HIT) {
    if (found.outcome === NOT_FOUND) {
      return sendError(res, ERRORS.ITEM_NOT_FOUND, `Item not found for code: ${code}`);
    }
    return sendError(res, ERRORS.SOURCE_UNAVAILABLE, null, { 'Retry-After': '5' });
  }

  const result = {
    v: SCHEMA_VERSION,
    code: cacheKey || code.toUpperCase(),
    quality: null,
    cid: found.cid,
    channel: found.channel,
  };
  if (cacheKey) {
    // CID: 条目**不设 TTL**：它按设计就只有 cid/channel，重抓拿不到任何增量，
    // 加短 TTL 只会让 only=cid 查询每隔几小时白跑一次源站（字段完整性判定不适用于它）
    await setCached(`CID:${cacheKey}`, result);
  }
  sendJson(res, 200, { ...result, cached: false });
}

/**
 * FALENO 作品页查询：抓 faleno.jp 作品页并归一化成与 DMM 相同的响应形状。
 * 尾斜杠：站点规范形状（东京出口会 301 到带斜杠版本），直接请求省一跳，故固定带上。
 * ⚠️ 拦截口径（2026-11-02 实测更正）：站点拦的是**大陆段**，不是"非日本出口"——
 * 大陆宽带带不带尾斜杠一律 403（XSERVER 拦截页）；美国 / 东京（hnd1）出口均 200。
 * 所以"带斜杠就能过"的旧经验已不成立；本函数必须跑在 hnd1 这类非大陆出口才有数据。
 * 响应与 DMM 对齐后，扩展侧复用同一套解析与错误处理。
 */
async function handleFaleno(res, req, code) {
  const key = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) {
    return sendError(res, ERRORS.MISSING_CODE);
  }
  const canonical = cacheKeyFrom(code);
  const cacheKey = canonical ? `FALENO:${canonical}` : null;

  // Redis 缓存优先（永久保存：作品页数据静态，容量管够）；键为空 / 未配置 / 失败时静默跳过，
  // 且必须过版本 + 键值一致性守卫（spec §14）—— 脏入参不读也不写
  if (cacheKey && req.query.refresh !== '1') {
    const cached = usableEntry(await getCached(cacheKey), canonical);
    if (cached) {
      return sendJson(res, 200, { ...cached, cached: true });
    }
  }

  const worksUrl = `${FALENO_ORIGIN}/top/works/${key}/`;

  let upstream;
  try {
    upstream = await fetch(worksUrl, {
      headers: COMMON_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    return sendError(res, ERRORS.SERVER_ERROR, `FALENO fetch failed: ${err.message}`);
  }

  // 404 = 作品不存在，按未找到返回（与 DMM 的 40401 语义一致）
  if (upstream.status === 404) {
    return sendError(res, ERRORS.ITEM_NOT_FOUND, `Item not found for code: ${code}`);
  }
  if (!upstream.ok) {
    return sendError(res, ERRORS.SERVER_ERROR, `FALENO upstream HTTP ${upstream.status}`);
  }

  // body 读取也可能 reject（流中断/超时），必须自己兜住：此前它在任何 try 之外，
  // 加上 dispatcher 的 return 没有 await，失败时整个请求一个响应都发不出去。
  let html;
  try {
    html = await upstream.text();
  } catch (err) {
    return sendError(res, ERRORS.SERVER_ERROR, `FALENO body read failed: ${err.message}`);
  }
  const detail = parseFalenoWorksHtml(html);
  // 以 200 返回的「ページが見つかりませんでした」页面同样判为查无
  if (!detail) {
    return sendError(res, ERRORS.ITEM_NOT_FOUND, `Item not found for code: ${code}`);
  }

  const resultData = {
    v: SCHEMA_VERSION,
    code: canonical || code.toUpperCase(),
    cid: key,
    channel: 'faleno',
    title: detail.title,
    short_title: detail.shortTitle,
    cover_url: detail.coverUrl,
    preview_url: detail.previewUrl,
    actresses: detail.actresses || [],
    delivery_date: detail.deliveryDate || null,
    sale_date: detail.saleDate || null,
    detail_url: worksUrl
  };

  if (cacheKey) {
    try {
      await setCached(cacheKey, resultData, entryTtlSeconds(resultData, incompleteCacheTtl()));
    } catch (err) {
      // 写入失败不影响响应
    }
  }

  sendJson(res, 200, { ...resultData, cached: false });
}

/**
 * 出演者清洗：数组逐项 / 字符串按分隔符切分；trim、丢空、按原样去重保序。
 * 与扩展端 src/lib/release-meta.ts 的 toPerformers 同规则。
 */
function splitPerformersJs(raw) {
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s\u3000、,，・/]+/) : [];
  const seen = new Set();
  const names = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** FALENO 主作品信息块的标签表（与扩展端 src/lib/faleno.ts 的常量保持一致） */
const FALENO_CAST_LABELS = ['出演女優', '出演者'];
const FALENO_DELIVERY_LABELS = ['配信日', '配信開始日'];
const FALENO_SALE_LABELS = ['発売日', '商品発売日'];

/** 主作品信息块里 `<span>标签</span><p>值</p>` 的首个值（同名标签只认第一次） */
function readFalenoInfoPairs(block) {
  const pairs = new Map();
  const pattern = /<span>([^<]{1,20})<\/span>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
  for (const match of block.matchAll(pattern)) {
    const label = (match[1] || '').trim();
    const value = decodeHtmlEntities((match[2] || '').replace(/<[^>]+>/g, '').trim()).trim();
    if (label && value && !pairs.has(label)) pairs.set(label, value);
  }
  return pairs;
}

function readFalenoLabeledValue(pairs, labels) {
  for (const label of labels) {
    const value = pairs.get(label);
    if (value) return value;
  }
  return null;
}

/**
 * DMM 商品情報テーブル（mono 详情页实测：`<table class="mg-b20">` 的行是
 * `<td align="right" valign="top" class="nw">标签：</td><td width="100%">值</td>`）。
 * ⚠️ 必须锚定「标签：</td>」这一整段：页面导航里还有「予約商品(発売日順)」这种同名单词。
 * @returns 单元格原始 HTML（未剥标签）；找不到返回 null
 */
function readDmmTableCell(html, label) {
  const pattern = new RegExp(`${label}：</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`);
  const match = html.match(pattern);
  return match ? match[1] : null;
}

/** 单元格 → 纯文本（剥标签、解实体、压空白） */
function dmmCellText(cell) {
  if (!cell) return null;
  const text = decodeHtmlEntities(cell.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text || null;
}

/** 出演者单元格：`<span id="performer"><a …>名前</a>`（多女优＝多个 <a>） */
function dmmCellPerformers(cell) {
  if (!cell) return [];
  return splitPerformersJs(
    [...cell.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) =>
      decodeHtmlEntities((m[1] || '').replace(/<[^>]+>/g, '').trim())
    )
  );
}

/**
 * 解析 FALENO 作品页 HTML，规则与扩展 src/lib/faleno.ts 的 parseFalenoWorksHtml 完全一致：
 * 首个 pop_sample 块 → <a href> 预告片 / 块内首个 <img> 封面 / 其 alt 标题；
 * 首个 box_works01_text 块的首个 <p> → 介绍（HTML 实体解码）。
 * 404 页面与无 pop_sample 结构的页面均返回 null（视为查无）。
 * 对拍基线：2026-10 hnd1 探针实测 FNS-263（预告片 FNS-263_PR.mp4、封面 FNS-263_1200.jpg）。
 */
function parseFalenoWorksHtml(html) {
  if (!html || html.includes('ページが見つかりませんでした')) return null;

  const sampleBlock = html.split('class="pop_sample"')[1];
  if (!sampleBlock) return null;

  const trailer = (sampleBlock.match(/href="([^"]+\.mp4[^"]*)"/i) || [])[1] || null;
  const imgTag = sampleBlock.match(/<img[^>]+>/);
  const coverUrl = imgTag ? (imgTag[0].match(/src="([^"]+)"/) || [])[1] || null : null;
  const altText = imgTag ? (imgTag[0].match(/alt="([^"]*)"/) || [])[1] ?? null : null;

  const textBlock = html.split('class="box_works01_text"')[1];
  const titleMatch = textBlock ? textBlock.match(/<p[^>]*>([\s\S]*?)<\/p>/) : null;
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : null;

  // 主作品信息块：第一个 box_works01_list。⚠️ 锚点**不带结尾引号**（实测属性是
  // class="box_works01_list clearfix"）；相关作品区的 text_kanren01 有同名「出演女優」标签、
  // 底部栏有「2026/11/5 発売開始」这种自由日期，所以必须截断到 text_kanren01 之前。
  const listBlock = (html.split('class="box_works01_list')[1] || '').split('text_kanren01')[0] || '';
  const info = readFalenoInfoPairs(listBlock);

  return {
    previewUrl: trailer,
    coverUrl,
    shortTitle: altText !== null ? decodeHtmlEntities(altText) : null,
    title,
    actresses: splitPerformersJs(readFalenoLabeledValue(info, FALENO_CAST_LABELS)),
    deliveryDate: readFalenoLabeledValue(info, FALENO_DELIVERY_LABELS),
    saleDate: readFalenoLabeledValue(info, FALENO_SALE_LABELS)
  };
}

/**
 * 搜索番号：数字版 GraphQL 优先，无匹配回退 mono HTML 搜索。
 * 两路定性用 combineRouteOutcomes 合并：数字版抖动 + mono 查无 ≠ 这部片不存在（spec §15.3）。
 * @returns {Promise<{ outcome: string, cid?: string, cookieJar?: Record<string, string>, channel?: string, digitalData?: Object | null }>}
 */
async function searchCid(code, quality) {
  // 1. 数字版：GraphQL API（无 geo 拦截、无需 cookie），非 HIT 时按定性回退 mono 搜索页
  const digital = await searchDigital(code, quality);
  if (digital.outcome === HIT) {
    return { outcome: HIT, cid: digital.data.cid, cookieJar: {}, channel: 'digital', digitalData: digital.data };
  }

  // 2. mono 通贩 HTML 搜索兜底：搜索页定性原样保留，只有选中 cid 才算这一路命中
  const cookieJar = {};
  const page = await fetchSearchPage(code, 'mono', cookieJar);
  const monoCid = page.outcome === HIT ? pickCid(page.html, code) : null;
  // 搜索页拿到（HIT）但没有候选 ≠ 这一路命中：搜索页 200 只说明页面抓到了，
  // pickCid 没匹配上就是"查无"，否则会带着 null 的 cid 去抓 .../cid=null/ 这个假 URL
  const monoOutcome = monoCid ? HIT : (page.outcome === HIT ? NOT_FOUND : page.outcome);

  const outcome = combineRouteOutcomes(digital.outcome, monoOutcome);
  if (outcome !== HIT) return { outcome };
  return { outcome: HIT, cid: monoCid, channel: 'mono', digitalData: null, cookieJar };
}

/** 读一个数字环境变量：空白/非法/缺失一律回落到默认值 */
function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** 档位区间：环境变量可覆盖，非法/空/缺失值回落到默认（320/600） */
function previewBounds() {
  return {
    minHeight: readEnvNumber('PREVIEW_HEIGHT_MIN', DEFAULT_MIN_HEIGHT),
    maxHeight: readEnvNumber('PREVIEW_HEIGHT_MAX', DEFAULT_MAX_HEIGHT),
  };
}

/**
 * 资料不全（缺标题/封面/预告片）的条目缓存多久：默认 6h，`<=0` = 关闭该策略（一律永久）。
 * 为什么要分级：条目永久缓存不会自己失效，源站后来补齐封面/预告片就永远读不到；
 * 资料齐全的条目没有这个风险，继续保持永久缓存（省源站与 Redis 往返）。
 */
function incompleteCacheTtl() {
  return readEnvNumber('INCOMPLETE_CACHE_TTL_SECONDS', INCOMPLETE_TTL_SECONDS);
}

/**
 * playlist 不可用时的兜底：按静态家族表枚举候选，逐档 Range: bytes=0-1 校验，命中即停；
 * 全部失败 → 保留原始 URL（绝不返回坏地址）。见 spec §6。
 *
 * 两道时限：单档受 TIMEOUT.playlist（5s）约束；整段探测另受 PROBE_BUDGET_MS（默认 12s）约束。
 * 为什么要有整段预算：主家族有 7 个候选，只靠单档超时最坏就是 35s，再叠加失败的 playlist
 * 与两次 GraphQL ⇒ ≈50s，已经贴住 vercel.json 的 maxDuration: 60；而扩展侧早就放弃等待了。
 * 与其把整个函数预算花在没人等的请求上，不如到点就整体放弃（返回保留原始 URL 的兜底）。
 */
async function probeFamilyPreview(originalUrl, quality) {
  // 预算在函数内读（不在模块加载时固化）：同一进程内的不同用例/请求可以给不同预算
  const PROBE_BUDGET_MS = readEnvNumber('PROBE_BUDGET_MS', 12000);
  const candidates = orderByPreference(familyVariants(originalUrl), { ...previewBounds(), quality });
  const empty = { previewUrl: originalUrl, previewQuality: null, previewQualities: [] };
  if (candidates.length === 0) return empty;

  const mp4Dir = originalUrl.replace(/\/[^/]+$/, '/');
  const deadline = Date.now() + PROBE_BUDGET_MS;
  for (const candidate of candidates) {
    // 总预算已用尽：不再发起新探测，直接走兜底（保留原 URL、档位未知）
    if (Date.now() >= deadline) break;
    const url = toMp4Url(mp4Dir, candidate.uri);
    try {
      const res = await fetch(url, {
        headers: { ...COMMON_HEADERS, 'Range': 'bytes=0-1' },
        // 单档超时取「剩余预算」与 TIMEOUT.playlist 的较小者：最后一档不会越过 deadline 才回来
        signal: AbortSignal.timeout(Math.max(1, Math.min(TIMEOUT.playlist, deadline - Date.now()))),
      });
      // 只有 206，或 200 且 content-type 是 video/* 才算档位存在：
      // 200 + text/html 是错误页/拦截页，不是预告片（实测坑，见 spec §6 步骤 3）
      const contentType = (res.headers.get('content-type') || '').trim();
      const isVideo = /^video\//i.test(contentType);
      if (res.status === 206 || (res.status === 200 && isVideo)) {
        return {
          previewUrl: url,
          previewQuality: qualityLabel(candidate.height),
          previewQualities: shapeQualities(candidates, mp4Dir),
        };
      }
    } catch (err) {
      // 单档探测失败继续下一档
    }
  }
  return empty;
}

/** sample2DMovie → 选定档位（playlist 权威；不可用时退回模板探测） */
async function buildDigitalPreview(sample, quality) {
  const lowest = sample?.lowestMovieUrl || null;
  const highest = sample?.highestMovieUrl || null;
  const hls = sample?.hlsMovieUrl || null;
  if (!lowest && !highest) return { previewUrl: null, previewQuality: null, previewQualities: [] };

  const mp4Dir = (lowest || highest).replace(/\/[^/]+$/, '/');
  if (hls) {
    try {
      const res = await fetch(hls, {
        headers: COMMON_HEADERS,
        signal: AbortSignal.timeout(TIMEOUT.playlist),
      });
      if (res.ok) {
        const variants = parseHlsVariants(await res.text());
        const picked = pickVariant(variants, { ...previewBounds(), quality });
        if (picked) {
          return {
            previewUrl: toMp4Url(mp4Dir, picked.uri),
            previewQuality: qualityLabel(picked.height),
            previewQualities: shapeQualities(variants, mp4Dir),
          };
        }
      }
    } catch (err) {
      // 落到模板探测
    }
  }
  // 探测兜底必须保留 API 给的最高档（接入前就是 highest）：全档探测失败时不能反而降画质
  return probeFamilyPreview(highest || lowest, quality);
}

/**
 * 数字版搜索：FANZA GraphQL API（api.video.dmm.co.jp）
 * 两步：legacySearchPPV 按补零番号搜 id → ppvContent(id) 拿完整详情
 * 实测可用字段：id/title/description（介绍）/packageImage.largeUrl/sample2DMovie（预告片）
 * 返回 { outcome, data }：outcome 是 HIT / NOT_FOUND / UPSTREAM 的定性（Task 6 接线）。
 */
async function searchDigital(code, quality) {
  // 1. 搜索：两路并查（实测两种组合各命中一类，另一路返回空）：
  //    a) floor: AV + 补零格式：AV 系老片必须补零才搜得到（现有路径）
  //    b) 无 floor + 原格式：覆盖 amateur 等非 AV floor（SIMW-011 实测，ppvContent 详情通用）
  let searchFailed = false;
  let hitId = null;
  // 是否由无 floor 路命中：amateur 内容 packageImage 为空，需用 amateur 目录拼封面
  let viaFloorless = false;
  const queries = [
    { floor: 'AV', queryWord: toDigitalQueryWord(code) },
    { floor: null, queryWord: code },
  ];
  for (const { floor, queryWord } of queries) {
    const floorArg = floor ? `, floor: ${floor}` : '';
    const searchQuery = `{ legacySearchPPV(limit: 10, offset: 0, sort: SALES_RANK_SCORE${floorArg}, queryWord: "${queryWord}") { result { contents { id } } } }`;
    let searchJson = null;
    try {
      const searchRes = await fetch('https://api.video.dmm.co.jp/graphql', {
        method: 'POST',
        headers: { ...COMMON_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery }),
        signal: AbortSignal.timeout(TIMEOUT.graphql),
      });
      if (!searchRes.ok) {
        searchFailed = true;
        continue;
      }
      searchJson = await searchRes.json();
    } catch (err) {
      searchFailed = true;
      continue;
    }
    const ids = (searchJson?.data?.legacySearchPPV?.result?.contents || [])
      .map(c => c.id)
      .filter(Boolean);
    hitId = pickCidFromList(ids, code);
    if (hitId) {
      viaFloorless = !floor;
      break;
    }
  }
  if (!hitId) return { outcome: searchFailed ? UPSTREAM : NOT_FOUND };

  // 2. 详情：SampleMovieUrl 操作按 id 查询（字段实测全可用）
  let detailJson = null;
  try {
    const detailRes = await fetch('https://api.video.dmm.co.jp/graphql', {
      method: 'POST',
      headers: { ...COMMON_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query:
          'query SampleMovieUrl($id: ID!) { ppvContent(id: $id) { id title description packageImage { largeUrl } actresses { name } deliveryStartDate sample2DMovie { lowestMovieUrl highestMovieUrl hlsMovieUrl } } }',
        variables: { id: hitId },
      }),
      signal: AbortSignal.timeout(TIMEOUT.graphql),
    });
    if (!detailRes.ok) return { outcome: UPSTREAM };
    detailJson = await detailRes.json();
  } catch (err) {
    return { outcome: UPSTREAM };
  }

  const ppv = detailJson?.data?.ppvContent;
  if (!ppv || !ppv.id) {
    // 有 errors = 上游报错（无法定性）；无 errors 且内容为空 = 确认查无
    const hasErrors = Array.isArray(detailJson?.errors) && detailJson.errors.length > 0;
    return { outcome: hasErrors ? UPSTREAM : NOT_FOUND };
  }

  const preview = await buildDigitalPreview(ppv.sample2DMovie, quality);
  return {
    outcome: HIT,
    data: {
      cid: ppv.id,
      title: ppv.description ? decodeHtmlEntities(ppv.description) : null,
      shortTitle: ppv.title ? decodeHtmlEntities(ppv.title) : null,
      // amateur 内容 packageImage 为空（SIMW-011 实测），用 amateur 目录拼封面（jp.jpg 实测 200）
      coverUrl: ppv.packageImage?.largeUrl
        || (viaFloorless ? `https://pics.dmm.co.jp/digital/amateur/${ppv.id}/${ppv.id}jp.jpg` : null),
      // 出演者：GraphQL 给 [{ id, name }]，只取 name（2026-10-10 探针实测 [{"name":"小泉玖美"}]）
      actresses: splitPerformersJs((ppv.actresses || []).map((a) => a && a.name)),
      // 配信開始日：ISO 时间戳**原样**交回（如 "2026-09-30T15:00:00Z"），JST 换算在扩展侧纯函数做
      deliveryDate: ppv.deliveryStartDate || null,
      // ⚠️ 不用 saleStartDate：实测 2026-08-31T15:00:00Z（JST 09-01）比配信開始日早整整一个月，
      // 语义是予約/販売開始而非商品発売日 —— 硬凑成"发布日"会显示错误日期（spec §5.2）
      saleDate: null,
      ...preview,
    },
  };
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
 * @returns {Promise<{ outcome: string, html: string | null }>} 命中返回搜索页 HTML；
 *          404/410 定性为查无、其余非 2xx / 超时 / 网络错 / 拦截页定性为查不动
 */
async function fetchSearchPage(code, channel, cookieJar) {
  const searchUrl = CHANNELS[channel].search(code);

  // age_check 端点 302 并下发 age_check_done；jar 里已有则跳过（幂等）
  if (!cookieJar.age_check_done) {
    try {
      const ageUrl = `https://www.dmm.co.jp/age_check/=/declared=yes/?rurl=${encodeURIComponent(searchUrl)}`;
      // redirect:'manual'：fetch 只暴露最终响应头，必须手动收集 302 的 Set-Cookie
      const ageRes = await fetch(ageUrl, {
        headers: COMMON_HEADERS,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT.monoSearch)
      });
      collectCookies(ageRes, cookieJar);
    } catch (err) {
      // 忽略，继续无 cookie 抓搜索页
    }
  }

  let searchRes;
  try {
    searchRes = await fetch(searchUrl, {
      headers: withCookies(COMMON_HEADERS, cookieJar),
      signal: AbortSignal.timeout(TIMEOUT.monoSearch)
    });
  } catch (err) {
    // 超时/网络错：无法定性，绝不当查无
    return { outcome: UPSTREAM, html: null };
  }
  if (!searchRes.ok) {
    return { outcome: classifyHttpStatus(searchRes.status), html: null };
  }
  collectCookies(searchRes, cookieJar);

  // 读 body 也可能中途超时/断网（TimeoutError 在 fetch 之后才抛），同样定性为查不动：
  // 不包住这里的话异常会冒到 handler 外层 catch，被报成 500 SERVER_ERROR
  let html;
  try {
    html = await searchRes.text();
  } catch (err) {
    return { outcome: UPSTREAM, html: null };
  }
  // 年龄确认拦截页：cookie 流程没走通，是环境问题而非番号不存在。本函数只做拦截判定，
  // 不做内容/空壳判定 —— 搜索页没有候选由调用方的 pickCid 定性（spec §15.3）
  if (isBlockedPage(html)) {
    return { outcome: UPSTREAM, html: null };
  }
  return { outcome: HIT, html };
}

/**
 * 请求详情页并定性：404/410 或 200 空壳页 = 确认查无；超时/网络错/拦截页 = 无法定性
 * @param {string} channel - 通道名（digital / mono），决定详情页 URL 格式
 * @returns {Promise<{ outcome: string, html: string | null }>}
 */
async function fetchDetailPage(cid, cookieJar, channel) {
  const detailUrl = CHANNELS[channel].detail(cid);
  let res;
  try {
    res = await fetch(detailUrl, {
      headers: withCookies(COMMON_HEADERS, cookieJar),
      signal: AbortSignal.timeout(TIMEOUT.monoDetail)
    });
  } catch (err) {
    return { outcome: UPSTREAM, html: null };
  }
  if (!res.ok) {
    // 404/410 = 已下架/不存在（确认查无）；5xx / WAF 403 = 无法定性
    return { outcome: classifyHttpStatus(res.status), html: null };
  }
  // 读 body 也可能中途超时/断网（TimeoutError 在 fetch 之后才抛），同样定性为查不动
  let html;
  try {
    html = await res.text();
  } catch (err) {
    return { outcome: UPSTREAM, html: null };
  }
  // 拦截页必须先判：拿不到 body 内容的拦截页不是"查无"
  if (isBlockedPage(html)) {
    return { outcome: UPSTREAM, html: null };
  }
  // 空壳页（200 但拿不到作品信息）按未找到处理；拦截页已在上一行返回 UPSTREAM
  if (!hasDetailContent(html)) {
    return { outcome: NOT_FOUND, html: null };
  }
  return { outcome: HIT, html };
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

  // 介绍（作品介绍文）：og:description
  const descMatch = unescaped.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
  const title = descMatch ? decodeHtmlEntities(descMatch[1]) : null;

  // 标题：og:title，h1 兜底
  const ogTitleMatch = unescaped.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
  const h1Match = unescaped.match(/<h1[^>]*id="title"[^>]*>([\s\S]*?)<\/h1>/i);
  let shortTitle = ogTitleMatch ? ogTitleMatch[1] : null;
  if (!shortTitle && h1Match) {
    shortTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
  }
  shortTitle = shortTitle ? decodeHtmlEntities(shortTitle) : null;

  // 出演者 / 配信開始日 / 発売日：DMM 商品情報テーブル（实测固件 test/fixtures/dmm-mono-BDSM-091.html）。
  // 出演者在 `<td>…出演者：</td><td><span id="performer"><a …>名前</a>`；
  // mono 页实测**只有「発売日」**（没有配信開始日/商品発売日），旧版式若有 配信開始日 优先取它。
  const castCell = readDmmTableCell(unescaped, '出演者');
  const actresses = dmmCellPerformers(castCell);
  const deliveryDate =
    dmmCellText(readDmmTableCell(unescaped, '配信開始日')) ||
    dmmCellText(readDmmTableCell(unescaped, '配信日'));
  const saleDate =
    dmmCellText(readDmmTableCell(unescaped, '商品発売日')) ||
    dmmCellText(readDmmTableCell(unescaped, '発売日'));

  return {
    coverUrl,
    previewUrl,
    title,
    shortTitle,
    actresses,
    deliveryDate,
    saleDate
  };
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

// 缓存层超时：已连接但对端不回包时 connectTimeout 不生效，必须自己掐表，
// 否则整个请求会挂到平台时限，503 永远观测不到（见 spec §15.5 的同款理由）。
const CACHE_TIMEOUT_MS = 1500;

// 每次请求一建一毁的客户端，重连没有意义：node-redis 默认策略会无限重试，
// 于是"Redis 连不上（ECONNREFUSED）"会变成 connect() 永不 settle（实测 114s 内重试 60+ 次仍无结果），
// 只能靠上面的掐表兜底 —— 白白让每个请求多等 CACHE_TIMEOUT_MS。故关掉重连：连不上就立刻降级。
const REDIS_SOCKET_OPTIONS = { connectTimeout: 3000, reconnectStrategy: false };

/**
 * 给 promise 掐表：ms 内不 settle 就按 fallback 结算；超时后原 promise 的迟到结果/异常一律丢弃。
 * 计时器 unref：缓存层挂住时也不该拖住进程退出。
 */
function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 关掉本次请求的客户端。连接阶段失败时 destroy() 会抛 ClientClosedError
 * （socket.#shouldReconnect 已把 #isOpen 置 false，destroy 见未打开就抛），
 * 而这里在 finally 里调用 —— 抛出去会把 getCached 的静默降级变成 handler 的 500，必须吞掉。
 */
function safeDestroy(client) {
  if (!client) return;
  try {
    client.destroy();
  } catch (err) {
    // 已失败/已关闭：没有需要再关的东西
  }
}

/**
 * 读取缓存：Serverless 无连接池，每次请求建连用完即断（个人低并发足够）
 * REDIS_URL 未配置或 Redis 故障时返回 null，主流程降级为直接抓取
 */
async function getCached(key) {
  let client;
  try {
    client = createClient({ url: process.env.REDIS_URL, socket: REDIS_SOCKET_OPTIONS });
    client.on('error', () => {}); // 不监听 'error' 时，连接被重置会变成未捕获异常直接杀进程
    return await withTimeout(
      (async () => {
        await client.connect();
        const raw = await client.get(key);
        return raw ? JSON.parse(raw) : null;
      })(),
      CACHE_TIMEOUT_MS,
      null,
    );
  } catch (err) {
    return null;
  } finally {
    safeDestroy(client);
  }
}

/**
 * 写入缓存。默认永久保存（无 TTL）；传了 ttlSeconds > 0 时下发 EX（字段完整性分级 TTL，spec §7）。
 * Free 计划无持久化，数据丢失时自动重抓兜底。
 */
async function setCached(key, data, ttlSeconds) {
  let client;
  try {
    client = createClient({ url: process.env.REDIS_URL, socket: REDIS_SOCKET_OPTIONS });
    client.on('error', () => {}); // 同 getCached：写缓存出问题也必须静默降级，不能变成未捕获异常
    await withTimeout(
      (async () => {
        await client.connect();
        await client.set(key, JSON.stringify(data), ttlSeconds > 0 ? { EX: ttlSeconds } : {});
      })(),
      CACHE_TIMEOUT_MS,
      null,
    );
  } catch (err) {
    // 忽略写入失败（含超时：写不进去不影响响应）
  } finally {
    safeDestroy(client);
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
 * 构造统一错误响应；headers 用于 503 的 Retry-After
 */
function sendError(res, errorType, customMessage = null, headers = null) {
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  }
  sendJson(res, errorType.status, {
    code: errorType.code,
    error: errorType.error,
    message: customMessage || errorType.message
  });
}
