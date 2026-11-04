/**
 * D2Pass（无码源）番号查询 API —— Vercel Node Function 入口。
 *
 * 路由（见 vercel.json 的 rewrites）：
 *   GET /:code                按番号查询
 *   GET /api?code=xxx         等价写法
 *   GET /batch?codes=A,B,C    批量
 *
 * 设计文档：docs/d2pass-api接口文档.md ／ 部署与配置：docs/d2pass-api部署指南.md
 */

import { normalizeCode, classifyCode, routeCandidates, alternateCodes } from "./lib/codes.js";
import { SITES, resolveSite, siteExists, pickPlayablePreview, titleFromHtml } from "./lib/sites.js";
import { lookupOnD2Pass } from "./lib/d2pass.js";
import {
	cacheGet,
	cacheGetMany,
	cacheSet,
	cacheIsNegative,
	cacheSetNegative,
	rateLimit,
	cacheBackend,
} from "./lib/cache.js";

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

const ERRORS = {
	MISSING_CODE: { status: 400, code: 40001, error: "MISSING_CODE", message: "Please provide a code, e.g. /HEYZO-3953 or /?code=HEYZO-3953" },
	INVALID_CODE: { status: 400, code: 40002, error: "INVALID_CODE", message: "Code could not be normalized into a known format." },
	TOO_MANY_CODES: { status: 400, code: 40003, error: "TOO_MANY_CODES", message: "Batch size exceeded." },
	MISSING_API_KEY: { status: 401, code: 40101, error: "MISSING_API_KEY", message: "API Key is missing. Provide via query parameter ?key= or Header x-api-key." },
	INVALID_API_KEY: { status: 403, code: 40301, error: "INVALID_API_KEY", message: "Invalid API Key provided." },
	ITEM_NOT_FOUND: { status: 404, code: 40401, error: "ITEM_NOT_FOUND", message: "Item not found for the requested code." },
	/**
	 * 源站**无法定性**（超时 / 网络错误 / 5xx / 地域拦截）——与 404 严格区分。
	 *
	 * 绝不能报成 404：那会被负缓存 6 小时，而且会诱导调用方去试别的分隔符形态/站点，
	 * 在另一个站上命中同数字的**另一部影片**。此响应不写任何缓存，并带 `Retry-After`。
	 */
	SOURCE_UNAVAILABLE: {
		status: 503,
		code: 50301,
		error: "SOURCE_UNAVAILABLE",
		message: "Upstream source is unreachable or blocked right now. Retry later.",
	},
	RATE_LIMITED: { status: 429, code: 42901, error: "RATE_LIMITED", message: "Too many requests. Slow down." },
	SERVER_ERROR: { status: 500, code: 50001, error: "INTERNAL_SERVER_ERROR", message: "An internal error occurred while processing your request." },
};

// ---------- 环境配置（每次调用读取，便于本地测试改 env） ----------
function config() {
	const num = (key, fallback) => {
		const v = Number(process.env[key]);
		return Number.isFinite(v) && v > 0 ? v : fallback;
	};
	const list = (key, fallback) =>
		(process.env[key] || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.length
			? process.env[key]
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: fallback;
	return {
		apiKey: process.env.API_KEY || "",
		sourceTimeoutMs: num("SOURCE_TIMEOUT_MS", 6000),
		d2passTimeoutMs: num("D2PASS_TIMEOUT_MS", 4000),
		budgetMs: num("TOTAL_BUDGET_MS", 12000),
		negativeTtlHours: process.env.NEGATIVE_TTL_HOURS === undefined ? 6 : Number(process.env.NEGATIVE_TTL_HOURS),
		rateLimitPerMin: num("RATE_LIMIT_PER_MIN", 120),
		batchMax: num("BATCH_MAX", 50),
		useRsc: process.env.D2PASS_USE_RSC !== "false",
		previewEnabled: process.env.PREVIEW_ENABLED !== "false",
		previewVerify: process.env.PREVIEW_VERIFY !== "false",
		previewOrder: list("PREVIEW_QUALITY_ORDER", ["480p", "360p", "240p", "720p", "1080p"]),
		heyzoOrder: list("PREVIEW_HEYZO_ORDER", ["sample_low", "sample", "sample_hd"]),
		disabledSites: list("DISABLED_SITES", []),
	};
}

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

/** 带缓存的单条查询 */
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

export default async function handler(req, res) {
	const cfg = config();
	const url = new URL(req.url || "/", `https://${req.headers?.host || "localhost"}`);
	const query = Object.fromEntries(url.searchParams.entries());

	setCommonHeaders(res);

	if (req.method === "OPTIONS") {
		res.statusCode = 204;
		res.end();
		return;
	}

	// 鉴权
	if (cfg.apiKey) {
		const provided = query.key || req.headers["x-api-key"];
		if (!provided) return send(res, ERRORS.MISSING_API_KEY);
		if (provided !== cfg.apiKey) return send(res, ERRORS.INVALID_API_KEY);
	}

	const identity = query.key || req.headers["x-forwarded-for"] || "anonymous";
	// debug=1 直接生效（接口本身由 API Key 保护，不再需要额外开关）；
	// refresh=1 绕过缓存重抓；no_preview=1 只取元数据；quality= 覆盖本档清晰度偏好。
	// 后三者都会改变输出内容，故响应一律 no-store，且不进 CDN。
	const debug = query.debug === "1";
	const refresh = query.refresh === "1";
	const noPreview = query.no_preview === "1";
	const qualityOverride = query.quality ? String(query.quality).trim() : "";
	const bustCache = debug || refresh || noPreview || Boolean(qualityOverride);
	const startedAt = Date.now();

	// 本请求生效的配置（不改全局 config）：清晰度偏好按请求覆盖，no_preview 关掉预告片解析
	const reqCfg = {
		...cfg,
		previewEnabled: noPreview ? false : cfg.previewEnabled,
		previewOrder: prioritizeQuality(cfg.previewOrder, qualityOverride),
		heyzoOrder: prioritizeQuality(cfg.heyzoOrder, qualityOverride),
	};
	const lookupOpts = { refresh, wantPreview: reqCfg.previewEnabled, quality: qualityOverride || null };

	try {
		// ---- 批量 ----
		if (url.pathname === "/batch" || query.mode === "batch") {
			const raw = (query.codes || "").split(",").map((s) => s.trim()).filter(Boolean);
			if (raw.length === 0) return send(res, ERRORS.MISSING_CODE);
			if (raw.length > cfg.batchMax) return send(res, ERRORS.TOO_MANY_CODES);

			// 先按类别分流：无关番号（有码/素人/乱码）就地拒绝，不进限流、不碰缓存
			const codes = [...new Set(raw.map(normalizeCode).filter(Boolean))];
			const errors = {};
			const routed = [];
			for (const code of codes) {
				const early = earlyReject(code, reqCfg);
				if (early) errors[code] = early;
				else routed.push(code);
			}
			if (routed.length === 0) return send(res, null, { results: {}, errors, cached: {} }, bustCache);

			const limit = await rateLimit(identity, reqCfg.rateLimitPerMin);
			if (!limit.allowed) return send(res, ERRORS.RATE_LIMITED);
			const result = await handleBatch(routed, reqCfg, debug, errors, lookupOpts);
			return send(res, null, result, bustCache);
		}

		// ---- 单个 ----
		const pathCode = url.pathname.replace(/^\/+/, "").split("/")[0];
		const rawCode = query.code || (pathCode && pathCode !== "api" ? decodeURIComponent(pathCode) : "");
		if (!rawCode) return send(res, ERRORS.MISSING_CODE);
		const normalized = normalizeCode(rawCode);
		if (!normalized) return send(res, ERRORS.INVALID_CODE);

		// 早退发生在限流之前：无关番号零 Redis 命令、零上游流量（有码号远多于无码号，这是主路径）
		const early = earlyReject(normalized, reqCfg);
		if (early) {
			const body = debug
				? {
						...early,
						debug: { code: normalized, rejectedAt: "routing", cacheSkipped: true, elapsedMs: Date.now() - startedAt },
					}
				: early;
			return send(res, early, body, bustCache);
		}

		const limit = await rateLimit(identity, reqCfg.rateLimitPerMin);
		if (!limit.allowed) return send(res, ERRORS.RATE_LIMITED);

		const debugInfo = { startedAt };
		if (qualityOverride) debugInfo.qualityOverride = qualityOverride;
		if (noPreview) debugInfo.noPreview = true;
		const { result, error } = await lookup(rawCode, reqCfg, debugInfo, lookupOpts);
		if (error) {
			const body = debug ? { ...error, debug: { ...debugInfo, elapsedMs: Date.now() - startedAt } } : error;
			return send(res, error, body, bustCache);
		}
		const body = debug
			? { ...result, debug: { ...debugInfo, elapsedMs: Date.now() - startedAt, backend: cacheBackend() } }
			: result;
		return send(res, null, body, bustCache);
	} catch (err) {
		console.error("[handler] failed:", err);
		return send(res, ERRORS.SERVER_ERROR);
	}
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

function setCommonHeaders(res) {
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type");
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

function send(res, error, body, bustCache = false) {
	if (error) {
		res.statusCode = error.status;
		res.setHeader("Cache-Control", "no-store");
		// 上游不可达是暂时性的：让调用方知道可以稍后重试（也避免被中间层当永久失败缓存）
		if (error.status === 503) res.setHeader("Retry-After", "5");
		res.end(
			JSON.stringify(
				body && typeof body === "object" && !body.code
					? body
					: { code: error.code, error: error.error, message: error.message, ...(body || {}) },
			),
		);
		return;
	}
	res.statusCode = 200;
	// ?key= 走 query（不是 Authorization 头），CDN 才愿意缓存
	res.setHeader(
		"Cache-Control",
		bustCache ? "no-store" : "public, s-maxage=86400, stale-while-revalidate=604800",
	);
	res.end(JSON.stringify(body));
}

export { resolveCode, lookup };
