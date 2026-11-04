/**
 * D2Pass（无码源）番号查询 —— 纯业务 handler。
 *
 * 合并后入口层（api/index.js）统一处理 OPTIONS / CORS / 鉴权 / 错误映射 / 响应发送，
 * 这里只接收 req、返回 {status, body, headers?}，不接触响应对象。
 * 批量与单查由入口按 mode 分发到两个导出函数，故本文件不再根据 pathname 自行分流。
 *
 * 设计文档：docs/d2pass-api接口文档.md ／ 部署与配置：docs/d2pass-api部署指南.md
 */

import { normalizeCode, classifyCode, routeCandidates, alternateCodes } from "../lib/d2pass/codes.js";
import { SITES, resolveSite, siteExists, pickPlayablePreview, titleFromHtml } from "../lib/d2pass/sites.js";
import { lookupOnD2Pass } from "../lib/d2pass/d2pass.js";
import {
	cacheGet,
	cacheGetMany,
	cacheSet,
	cacheIsNegative,
	cacheSetNegative,
	rateLimit,
	cacheBackend,
} from "../lib/d2pass/cache.js";
import { ERRORS, errorResult, okResult } from "../shared/errors.js";
import { readConfig } from "../shared/config.js";
import { normalizeQuery } from "../shared/router.js";

/**
 * 缓存载荷版本。**改动响应字段口径时必须递增**。
 *
 * 正结果是永久缓存（不设 TTL），所以口径变更后旧条目不会自己失效——
 * 读缓存时比对版本，不匹配就当未命中、重新解析并覆盖。这样不必去清 Redis，
 * 键名也不变（不会产生一堆孤儿键）。
 *
 * 3 = HTML 站开始产出 actress / release_date（2026-10-10）。2 的条目里这两项是被硬编码成 null 的，
 * 必须整体作废重抓，否则 HEYZO 等站会一直返回空元数据。
 * 4 = caribbeancom 老页面（无 og:image）启用模板封面兜底（2026-10-10）：3 的条目里 cover_url 可能是 null。
 */
const SCHEMA_VERSION = 4;

const qualityOf = (url) => {
	// 必须锚定文件名：`sample.heyzo.com` 主机名里也含 "sample"
	const m = /([0-9]{3,4}p)\.mp4/i.exec(url || "");
	if (m) return m[1];
	const h = /\/(sample_low|sample_hd|sample|hls-\d+k)\.mp4/i.exec(url || "");
	return h ? h[1] : null;
};

/**
 * 在给定候选集里解析出第一个**真正解析成功**的站点。
 *
 * 返回 `{ site, upstreamError }`：
 * - `site` 命中即成功；
 * - 全部探测定性为"确认没有" → `{ site: null, upstreamError: false }`；
 * - 有任何一次是**超时/网络错误/5xx**（无法定性）→ `upstreamError: true`。
 *
 * 这个区分是硬要求：路由有歧义时若不区分，一次偶发超时会被当成"该站没有这个号"，
 * 进而退到分隔符兄弟形态，在**另一个站上命中同数字的另一部影片**并静默返回。
 */
async function resolveSiteFromCandidates(code, candidates, cfg, debugInfo) {
	if (candidates.length === 0) return { site: null, upstreamError: false };
	let order = candidates;
	if (candidates.length > 1) {
		const probes = await Promise.all(
			candidates.map(async (id) => {
				try {
					return { id, status: await siteExists(id, code, { timeoutMs: cfg.sourceTimeoutMs }) };
				} catch {
					return { id, status: "error" };
				}
			}),
		);
		debugInfo.probes = probes;
		const alive = candidates.filter((id) => probes.some((p) => p.id === id && p.status === "ok"));
		if (alive.length > 0) {
			order = alive;
		} else {
			// 没有任何候选确认存在：区分"都没收录"与"都没探通"
			const anyNotfound = probes.some((p) => p.status === "notfound");
			if (!anyNotfound) return { site: null, upstreamError: true };
			return { site: null, upstreamError: false };
		}
	}
	// 探测通过 ≠ 能解析出标题：逐个试到成功为止（0930 系对任何号都回 200，就是靠这一步兜住的）
	let upstreamError = false;
	for (const id of order) {
		try {
			const site = await resolveSite(id, code, {
				qualityOrder: cfg.previewOrder,
				heyzoOrder: cfg.heyzoOrder,
				timeoutMs: cfg.sourceTimeoutMs,
			});
			if (site) return { site, upstreamError: false };
		} catch (err) {
			// resolveSite 对"确认 404"返回 null、对"上游不可达"抛错——抛错才算无法定性
			upstreamError = true;
			debugInfo.siteError = String(err?.message || err);
		}
	}
	return { site: null, upstreamError };
}

/**
 * 早退判定：这个番号是否归本服务管辖。
 *
 * 有码番号（`IPX-118`）、素人号、乱码都路由不到任何无码加盟站——**纯 CPU 判定，零网络**。
 * 这类号必须在「读缓存 / 写缓存 / 限流计数」之前就返回：
 *
 * - 否则每来一个有码号，Redis 里就留一个 6 小时的 `D2P:NF:` 键。有码数量远多于无码，
 *   扩展一旦把有码号也送进来，键数会被撑爆；
 * - 同时省掉每条请求 2 条 Redis 命令（GET + EXISTS）与限流 INCR。
 *
 * 返回 null 表示"归本服务管"，否则返回可直接发送的错误对象（带 `class`，便于调用方分流到 DMM/FALENO）。
 */
function earlyReject(code, cfg) {
	const candidates = routeCandidates(code).filter((id) => !cfg.disabledSites.includes(id));
	if (candidates.length > 0) return null;
	return { ...ERRORS.ITEM_NOT_FOUND, class: classifyCode(code) };
}

/** 解析一个番号（不含缓存读写） */
async function resolveCode(rawCode, cfg, debugInfo) {
	const code = normalizeCode(rawCode);
	const cls = classifyCode(code);
	const candidates = routeCandidates(code).filter((id) => !cfg.disabledSites.includes(id));
	debugInfo.code = code;
	debugInfo.class = cls;
	debugInfo.candidates = candidates;

	const primary = await resolveSiteFromCandidates(code, candidates, cfg, debugInfo);
	let site = primary.site;

	// 主路由**无法定性**（超时/网络错误/5xx）时直接失败，不猜：
	// 否则会退到分隔符兄弟形态，在另一个站上命中同数字的另一部影片。
	if (!site && primary.upstreamError) {
		debugInfo.upstreamError = "primary";
		return { code, cls, error: ERRORS.SOURCE_UNAVAILABLE };
	}

	// 主路由确认"不存在"时，才试分隔符兄弟形态：`100126-100` 不存在就试 `100126_100`
	if (!site) {
		let altUpstream = false;
		for (const alt of alternateCodes(code)) {
			const altCandidates = routeCandidates(alt).filter((id) => !cfg.disabledSites.includes(id));
			if (altCandidates.length === 0) continue;
			const altResult = await resolveSiteFromCandidates(alt, altCandidates, cfg, debugInfo);
			if (altResult.site) {
				site = altResult.site;
				debugInfo.alternateCode = alt;
				break;
			}
			if (altResult.upstreamError) altUpstream = true;
		}
		// 兄弟形态也全都探不通 → 同样是"无法定性"，不能报成 404（会被负缓存 6 小时）
		if (!site && altUpstream) {
			debugInfo.upstreamError = "alternate";
			return { code, cls, error: ERRORS.SOURCE_UNAVAILABLE };
		}
	}
	if (!site) return { code, cls, error: ERRORS.ITEM_NOT_FOUND };
	debugInfo.site = site.siteId;

	// D2Pass：拿商品页（封面/标题/女优/回链校验）
	let product = null;
	let hostMatched = false;
	const spent = debugInfo.startedAt ? Date.now() - debugInfo.startedAt : 0;
	if (spent < cfg.budgetMs * 0.7) {
		try {
			const hit = await lookupOnD2Pass(code, site.title, {
				timeoutMs: cfg.d2passTimeoutMs,
				useRsc: cfg.useRsc,
				expectedHost: site.host,
				attempts: debugInfo.searchAttempts,
			});
			product = hit?.product || null;
			hostMatched = Boolean(hit?.hostMatched);
			if (hit) debugInfo.d2passFragment = hit.fragment;
			// 剧情走了哪条抽取路径（class / after-h1 / missing）——让"突然取不到剧情"可见
			if (product) debugInfo.descriptionVia = product.descriptionVia;
		} catch (err) {
			debugInfo.d2passError = String(err?.message || err);
		}
	} else {
		debugInfo.d2passSkipped = "budget";
	}

	// 预告片：站点模板优先，D2Pass 商品页样片作为最后兜底
	let preview = null;
	if (cfg.previewEnabled) {
		const candidatesForPreview = [...site.candidates];
		if (product?.sample) candidatesForPreview.push({ url: product.sample, quality: qualityOf(product.sample) || "d2pass" });
		try {
			preview = await pickPlayablePreview(candidatesForPreview, site.order, { verify: cfg.previewVerify });
		} catch (err) {
			debugInfo.previewError = String(err?.message || err);
		}
	}

	return {
		code,
		cls,
		result: {
			code,
			class: cls,
			// 字段口径与 DMM 源一致：title = 介绍（剧情长文），short_title = 标题（作品名）
			// title 取源站 Desc（bifrost 自带）→ 兜底 D2Pass 商品页的剧情段落
			title: site.description || product?.description || null,
			short_title: site.title || null,
			cover_url: product?.cover || site.coverAlt || null,
			cover_url_alt: site.coverAlt || null,
			preview_url: preview?.url || null,
			preview_type: preview?.type || null,
			preview_quality: preview?.quality || null,
			actress: site.actress || product?.actress || null,
			release_date: site.releaseDate || null,
			site_id: site.siteId,
			site_name: site.siteName,
			source_url: site.sourceUrl,
			d2pass_url: product?.productUrl || null,
			match: product ? (hostMatched ? "backlink" : "fuzzy") : "exact",
			cached: false,
		},
	};
}

/**
 * 把请求指定的清晰度提到偏好列表最前面（`?quality=720p`）。
 *
 * 大小写不敏感；若该档位原生不存在（例如给 HEYZO 传 `480p`），候选的排序会退回原有相对顺序，
 * 不会挑出坏地址——只是"没有就照旧"。
 */
function prioritizeQuality(order, wanted) {
	if (!wanted) return order;
	const w = String(wanted).trim().toLowerCase();
	if (!w) return order;
	return [wanted, ...order.filter((q) => q.toLowerCase() !== w)];
}

/**
 * 缓存条目是否可用。
 *
 * 缓存键只有番号，但**输出会随请求参数变化**，所以条目里要记下"这份结果是按什么口径抓的"：
 *
 * - `partial: true` —— 这条是 `no_preview=1` 存的**残缺条目**（没有预告片）。只能被同样不要预告片的
 *   请求复用；否则"先用列表模式扫一遍"会把每个番号的预告片**永久**污染成 null。
 * - `quality` —— 记下当时生效的清晰度覆盖值（默认 `null`）。`?quality=1080p` 的结果不能被
 *   默认请求复用（反之亦然），否则一次带参数的查询会把该番号的默认口径**永久**改掉。
 *
 * 口径不匹配时按未命中处理：重新解析并覆盖写回，所以不需要清 Redis、也不需要升 `SCHEMA_VERSION`。
 */
function usableCache(cached, { wantPreview = true, quality = null } = {}) {
	if (!cached || cached.v !== SCHEMA_VERSION || !cached.data) return null;
	if (cached.partial && wantPreview) return null;
	if ((cached.quality ?? null) !== (quality ?? null)) return null;
	return cached.data;
}

/**
 * 带缓存的单条查询。
 *
 * `refresh` 完全绕过缓存（正负都不读）重新解析后覆盖写回；
 * `no_preview=1` 时跳过预告片解析，写回的条目带 `partial` 标记。
 */
async function lookup(rawCode, cfg, debugInfo, { refresh = false, wantPreview = true, quality = null } = {}) {
	const code = normalizeCode(rawCode);
	if (!code) return { error: ERRORS.MISSING_CODE };

	// 防御性早退：调用方已过滤过一遍，这里再挡一次，保证任何路径都不会为无关番号写缓存
	const early = earlyReject(code, cfg);
	if (early) return { error: early };

	if (refresh) {
		debugInfo.refresh = true;
	} else {
		const hit = usableCache(await cacheGet(code), { wantPreview, quality });
		if (hit) return { result: { ...hit, cached: true } };

		if (await cacheIsNegative(code)) {
			debugInfo.negativeCacheHit = true;
			return { error: ERRORS.ITEM_NOT_FOUND };
		}
	}

	const resolved = await resolveCode(code, cfg, debugInfo);
	if (resolved.error) {
		if (resolved.error === ERRORS.ITEM_NOT_FOUND && cfg.negativeTtlHours > 0) {
			await cacheSetNegative(code, cfg.negativeTtlHours * 3600);
		}
		return { error: resolved.error };
	}
	// D2Pass 阶段报错（超时/被拦截）时结果是不完整的：HTML 站的剧情会缺失。
	// 这种"暂时性残缺"绝不能写进**永久**缓存，否则该番号会被永久判成没有剧情。
	if (debugInfo.d2passError) {
		debugInfo.cacheSkipped = "d2pass-error";
	} else {
		await cacheSet(code, { v: SCHEMA_VERSION, data: resolved.result, partial: !wantPreview, quality: quality ?? null });
	}
	return { result: resolved.result };
}

async function pool(items, limit, worker) {
	const queue = [...items];
	const out = new Array(items.length);
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (queue.length) {
				const index = items.indexOf(queue.shift());
				out[index] = await worker(items[index]);
			}
		}),
	);
	return out;
}

async function handleBatch(rawCodes, cfg, debug, preErrors = {}, opts = {}) {
	const codes = [...new Set(rawCodes.map(normalizeCode).filter(Boolean))];
	// refresh 时不读缓存；no_preview 时只读"完整条目"，残缺条目不能当命中
	const cachedMap = opts.refresh ? new Map() : await cacheGetMany(codes);
	const results = {};
	const errors = { ...preErrors };
	const cachedMapOut = {};
	const pending = [];

	for (const code of codes) {
		const hit = usableCache(cachedMap.get(code), opts);
		if (hit) {
			results[code] = { ...hit, cached: true };
			cachedMapOut[code] = true;
		} else {
			pending.push(code);
		}
	}

	await pool(pending, 4, async (code) => {
		const debugInfo = { startedAt: Date.now() };
		const { result, error } = await lookup(code, cfg, debugInfo, opts);
		if (error) errors[code] = { ...error };
		else {
			results[code] = result;
			cachedMapOut[code] = false;
		}
	});

	return { results, errors, cached: cachedMapOut };
}

/**
 * 内部业务函数沿用共享错误对象做标识（含引用相等比较与展开副本），边界需要把它还原成
 * errorResult 认识的错误名 —— 用数字错误码反查，避免为每种错误再维护一张映射表。
 */
function errorNameOf(error) {
	return Object.keys(ERRORS).find((name) => ERRORS[name].code === error.code) || "SERVER_ERROR";
}

/**
 * 两个 handler 共用同一套请求级配置派生：清晰度覆盖与 no_preview 都会改变输出内容，
 * 必须在这里一并决定是否 no-store，否则一次带参查询会污染默认口径的 CDN 缓存。
 */
function prepare(req) {
	const cfg = readConfig();
	const q = normalizeQuery(req);
	const bustCache = q.debug || q.refresh || q.noPreview || Boolean(q.quality);
	const reqCfg = {
		...cfg,
		previewEnabled: q.noPreview ? false : cfg.previewEnabled,
		previewOrder: prioritizeQuality(cfg.previewOrder, q.quality),
		heyzoOrder: prioritizeQuality(cfg.heyzoOrder, q.quality),
	};
	return {
		cfg,
		q,
		debug: q.debug,
		noPreview: q.noPreview,
		qualityOverride: q.quality,
		bustCache,
		startedAt: Date.now(),
		reqCfg,
		lookupOpts: { refresh: q.refresh, wantPreview: reqCfg.previewEnabled, quality: q.quality || null },
		identity: req.query?.key || req.headers?.["x-forwarded-for"] || "anonymous",
	};
}

/** 会改变输出内容的请求一律不进 CDN；其余成功响应不自带缓存头，交给入口层按 src 补 s-maxage。 */
function cacheHeaders(bustCache) {
	return bustCache ? { "Cache-Control": "no-store" } : {};
}

/** 单条查询：只做业务，返回 {status, body, headers?}。 */
export async function handleD2pass(req) {
	const { debug, noPreview, qualityOverride, bustCache, startedAt, reqCfg, lookupOpts, identity, q } = prepare(req);
	const headers = cacheHeaders(bustCache);
	try {
		const rawCode = q.code;
		if (!rawCode) return errorResult("MISSING_CODE");
		const normalized = normalizeCode(rawCode);
		if (!normalized) return errorResult("INVALID_CODE");

		// 早退发生在限流之前：无关番号零 Redis 命令、零上游流量（有码号远多于无码号，这是主路径）
		const early = earlyReject(normalized, reqCfg);
		if (early) {
			const body = debug
				? {
						...early,
						debug: { code: normalized, rejectedAt: "routing", cacheSkipped: true, elapsedMs: Date.now() - startedAt },
					}
				: early;
			return errorResult("ITEM_NOT_FOUND", { body });
		}

		const limit = await rateLimit(identity, reqCfg.rateLimitPerMin);
		if (!limit.allowed) return errorResult("RATE_LIMITED");

		const debugInfo = { startedAt };
		if (qualityOverride) debugInfo.qualityOverride = qualityOverride;
		if (noPreview) debugInfo.noPreview = true;
		const { result, error } = await lookup(rawCode, reqCfg, debugInfo, lookupOpts);
		if (error) {
			const body = debug ? { ...error, debug: { ...debugInfo, elapsedMs: Date.now() - startedAt } } : error;
			return errorResult(errorNameOf(error), { body });
		}
		const body = debug
			? { ...result, debug: { ...debugInfo, elapsedMs: Date.now() - startedAt, backend: cacheBackend() } }
			: result;
		return okResult(body, headers);
	} catch (err) {
		console.error("[d2pass] failed:", err);
		return errorResult("SERVER_ERROR");
	}
}

/** 批量查询：整批只计 1 次限流，返回 {status, body, headers?}。 */
export async function handleD2passBatch(req) {
	const { cfg, debug, bustCache, reqCfg, lookupOpts, identity, q } = prepare(req);
	const headers = cacheHeaders(bustCache);
	try {
		const raw = q.codes;
		if (raw.length === 0) return errorResult("MISSING_CODE");
		if (raw.length > cfg.batchMax) return errorResult("TOO_MANY_CODES");

		// 先按类别分流：无关番号（有码/素人/乱码）就地拒绝，不进限流、不碰缓存
		const codes = [...new Set(raw.map(normalizeCode).filter(Boolean))];
		const errors = {};
		const routed = [];
		for (const code of codes) {
			const early = earlyReject(code, reqCfg);
			if (early) errors[code] = early;
			else routed.push(code);
		}
		if (routed.length === 0) return okResult({ results: {}, errors, cached: {} }, headers);

		const limit = await rateLimit(identity, reqCfg.rateLimitPerMin);
		if (!limit.allowed) return errorResult("RATE_LIMITED");
		const result = await handleBatch(routed, reqCfg, debug, errors, lookupOpts);
		return okResult(result, headers);
	} catch (err) {
		console.error("[d2pass/batch] failed:", err);
		return errorResult("SERVER_ERROR");
	}
}

export { resolveCode, lookup };
