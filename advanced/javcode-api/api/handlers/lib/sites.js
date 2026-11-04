/**
 * 18 家加盟站适配器。
 *
 * 每个站点声明：详情页模板、标题清洗、预告片候选（按偏好顺序）。
 * 预告片一律"先按模板列候选 → 逐个 Range 校验 → 命中即用"，因此模板过期不会把坏地址交给播放器；
 * 没有模板可用的站（eroxjapanz / 3d-eros / unkotare）退化为从页面里抽真实链接。
 *
 * 全部形态与体积均为实测所得，出处见 docs/d2pass-api接口文档.md 第 5 节。
 */

import {
	fetchText,
	fetchRaw,
	fetchJson,
	probeExists,
	probeStatus,
	extractMediaFromHtml,
	siteDispatcher,
	decodeEntities,
} from "./http.js";

export const DEFAULT_QUALITY_ORDER = ["480p", "360p", "240p", "720p", "1080p"];
export const DEFAULT_HEYZO_ORDER = ["sample_low", "sample", "sample_hd"];

const BIFROST = "bifrost";

/** 站点表：key 即 API 返回的 site_id */
export const SITES = {
	heydouga: {
		id: "heydouga",
		name: "Hey動画",
		host: "www.heydouga.com",
		kind: "html",
		twoSegment: true,
		page: ({ a, b }) => `https://www.heydouga.com/moviepages/${a}/${b}/index.html`,
		previews: ({ a, b }) => [`https://sample.heydouga.com/contents/${a}/${b}/hls-1800k.mp4`],
		hlsAlt: ({ a, b }) => `https://hls-mediaac.heydouga.com/sample/${a}/${b}/mb.m3u8`,
	},
	av9898: {
		id: "av9898",
		name: "av9898",
		host: "av9898.heydouga.com",
		kind: "html",
		twoSegment: true,
		page: ({ a, b }) => `https://av9898.heydouga.com/moviepages/${a}/${b}/index.html`,
		// 详情页实测 302 到 www.heydouga.com 后 404（站点已并入 Hey動画），保留适配器但会自然判为未收录
		previews: () => [],
	},
	heyzo: {
		id: "heyzo",
		name: "HEYZO",
		host: "www.heyzo.com",
		kind: "html",
		page: ({ n }) => `https://www.heyzo.com/moviepages/${n}/index.html`,
		// 实测体积 sample_low 3.1MB / sample 12.8MB / sample_hd 31.1MB —— 默认取最轻档
		previews: ({ n }, order) =>
			order.map((q) => `https://sample.heyzo.com/contents/3000/${n}/${q}.mp4`),
		cleanTitle: (t) => stripSuffix(t, [/\s*-\s*無修正アダルト動画\s*HEYZO\s*$/i]),
	},
	caribbeancom: {
		id: "caribbeancom",
		name: "カリビアンコム",
		host: "www.caribbeancom.com",
		kind: "html",
		charset: "euc-jp",
		page: ({ code }) => `https://www.caribbeancom.com/moviepages/${code}/index.html`,
		// 老页面**没有 og:image**（实测 052725-001 / 052425-001），站点自己的封面在同目录 l_l.jpg；
		// 只有 og:image 缺失时才用它，并且**先探活**（206 才采用）——绝不给面板 404 地址。
		coverTemplate: ({ code }) => `https://www.caribbeancom.com/moviepages/${code}/images/l_l.jpg`,
		previews: ({ code }, order) =>
			order.map((q) => `https://smovie.caribbeancom.com/sample/movies/${code}/${q}.mp4`),
		cleanTitle: (t) => stripSuffix(t, [/\s*\|\s*無修正アダルト動画\s*カリビアンコム\s*$/, /\s*\|\s*無修正アダルト動画\s*$/]),
	},
	caribbeancompr: {
		id: "caribbeancompr",
		name: "カリビアンコムプレミアム",
		host: "www.caribbeancompr.com",
		kind: "html",
		charset: "euc-jp",
		page: ({ code }) => `https://www.caribbeancompr.com/moviepages/${code}/index.html`,
		previews: ({ code }, order) =>
			order.map((q) => `https://smovie.caribbeancompr.com/sample/movies/${code}/${q}.mp4`),
		cleanTitle: (t) => stripSuffix(t, [/\s*\|\s*無修正アダルト動画.*$/]),
	},
	"1pondo": {
		id: "1pondo",
		name: "一本道",
		host: "www.1pondo.tv",
		kind: BIFROST,
		json: ({ code }) => `https://www.1pondo.tv/dyn/phpauto/movie_details/movie_id/${code}.json`,
		page: ({ code }) => `https://www.1pondo.tv/moviepages/${code}/index.html`,
		previews: ({ code }, order) =>
			order.map((q) => `https://smovie.1pondo.tv/sample/movies/${code}/${q}.mp4`),
	},
	"10musume": {
		id: "10musume",
		name: "天然むすめ",
		host: "www.10musume.com",
		kind: BIFROST,
		json: ({ code }) => `https://www.10musume.com/dyn/phpauto/movie_details/movie_id/${code}.json`,
		page: ({ code }) => `https://www.10musume.com/moviepages/${code}/index.html`,
		previews: ({ code }, order) =>
			order.map((q) => `https://smovie.10musume.com/sample/movies/${code}/${q}.mp4`),
	},
	pacopacomama: {
		id: "pacopacomama",
		name: "パコパコママ",
		host: "www.pacopacomama.com",
		kind: BIFROST,
		json: ({ code }) => `https://www.pacopacomama.com/dyn/phpauto/movie_details/movie_id/${code}.json`,
		page: ({ code }) => `https://www.pacopacomama.com/moviepages/${code}/index.html`,
		previews: ({ code }, order) =>
			order.map((q) => `https://smovie.pacopacomama.com/sample/movies/${code}/${q}.mp4`),
	},
	muramura: {
		id: "muramura",
		name: "ムラムラ",
		host: "www.muramura.tv",
		kind: BIFROST,
		json: ({ code }) => `https://www.muramura.tv/dyn/phpauto/movie_details/movie_id/${code}.json`,
		page: ({ code }) => `https://www.muramura.tv/moviepages/${code}/index.html`,
		previews: ({ code }, order) =>
			order.map((q) => `https://smovie.muramura.tv/sample/movies/${code}/${q}.mp4`),
	},
	pikkur: {
		id: "pikkur",
		name: "ピッカー",
		host: "www.pikkur.com",
		kind: "html",
		charset: "euc-jp",
		page: ({ code }) => `https://www.pikkur.com/moviepages/${code}/index.html`,
		// 注意：www 主域会 302，稳定直链在 smovie 子域
		previews: ({ code }) => [`https://smovie.pikkur.com/contents/movie/${code}/video/sample.mp4`],
		cleanTitle: (t) => stripSuffix(t, [/\s*-\s*PIKKUR\.COM\s*$/i]),
	},
	nyoshin: {
		id: "nyoshin",
		name: "女体のしんぴ",
		host: "www.nyoshin.com",
		kind: "html",
		// 2026-10-10 实测：/moviepages/{code}/index.html 会 302 到 Next.js 页面（UTF-8，
		// class 形如 MovieHeader_*_actress__<hash>）。原先写 euc-jp → 标题与标签全是乱码。
		charset: "utf-8",
		page: ({ code }) => `https://www.nyoshin.com/moviepages/${code}/index.html`,
		// 番号 n3391 → 预告片路径只用数字 3391
		previews: ({ code }) => {
			const digits = code.replace(/^[A-Za-z]+/, "");
			return [`https://smovie.nyoshin.com/d2p/movie/${digits}/sample.mp4`];
		},
	},
	kin8tengoku: {
		id: "kin8tengoku",
		name: "金髪天國",
		host: "www.kin8tengoku.com",
		kind: "html",
		charset: "euc-jp",
		page: ({ code }) => `https://www.kin8tengoku.com/moviepages/${code}/index.html`,
		previews: ({ code }) => [`https://www.kin8tengoku.com/${code}/pht/sample_en.mp4`],
	},
	h0930: {
		id: "h0930",
		name: "エッチな0930",
		host: "www.h0930.com",
		kind: "html",
		charset: "euc-jp",
		presenceByContent: true,
		page: ({ code }) => `https://www.h0930.com/moviepages/${code}/index.html`,
		previews: ({ code }) => [`https://smovie.h0930.com/moviepages/${code}/sample.mp4`],
		extractTitle: extractPerformerTitle,
	},
	h4610: {
		id: "h4610",
		name: "エッチな4610",
		host: "www.h4610.com",
		kind: "html",
		charset: "euc-jp",
		presenceByContent: true,
		page: ({ code }) => `https://www.h4610.com/moviepages/${code}/index.html`,
		previews: ({ code }) => [`https://smovie.h4610.com/moviepages/${code}/sample.mp4`],
		extractTitle: extractPerformerTitle,
	},
	c0930: {
		id: "c0930",
		name: "人妻斬り",
		host: "www.c0930.com",
		kind: "html",
		charset: "euc-jp",
		presenceByContent: true,
		page: ({ code }) => `https://www.c0930.com/moviepages/${code}/index.html`,
		previews: ({ code }) => [`https://smovie.c0930.com/moviepages/${code}/sample.mp4`],
		extractTitle: extractPerformerTitle,
	},
	eroxjapanz: {
		id: "eroxjapanz",
		name: "エロックスジャパンZ",
		host: "www.eroxjapanz.com",
		kind: "html",
		charset: "euc-jp",
		page: ({ code }) => `https://www.eroxjapanz.com/moviepages/${code}/index.html`,
		// 预告片路径含原始片商域名（如 10musume.com），无法从番号推导 → 只能从页面抽
		previews: () => [],
	},
	"3d-eros": {
		id: "3d-eros",
		name: "3d-eros.net",
		host: "www.3d-eros.net",
		kind: "html",
		charset: "euc-jp",
		page: ({ code }) => `https://www.3d-eros.net/moviepages/${code}/index.html`,
		previews: () => [],
		cleanTitle: (t) => stripSuffix(t, [/\s*-\s*3D-EROS\.NET\s*$/i]),
	},
	unkotare: {
		id: "unkotare",
		name: "うんこたれ",
		host: "www.unkotare.com",
		kind: "html",
		page: ({ code }) => `https://www.unkotare.com/moviepages/${code}/index.html`,
		// 站点整体 302 到 info.unkotare.com，回链已失效；模板保留，探测失败会自动放弃
		previews: ({ code }) => [`https://www.unkotare.com/moviepages/${code}/sample.mp4`],
	},
};

function stripSuffix(title, patterns) {
	let out = (title || "").trim();
	for (const re of patterns) out = out.replace(re, "");
	// HEYZO 型标题把女优名与假名放在【】前，作品名在最后一个】之后
	if (out.includes("】")) out = out.slice(out.lastIndexOf("】") + 1).trim();
	return out.replace(/\s+/g, " ").trim();
}

/**
 * 0930 系（h0930 / h4610 / c0930）专用标题提取。
 *
 * 这三个站**没有 `<title>` 也没有 og:title**：作品名只在 `<h1><span class="style1">` 里，
 * 而且**对任何番号都返回 HTTP 200**（不存在的号也 200，只是 h1 里没有出演者）。
 * 因此这里的"取到出演者"同时充当存在性判据。
 */
function extractPerformerTitle(html) {
	if (!html) return "";
	const m = /<h1[^>]*>[\s\S]{0,300}?<span[^>]*class=["']style1["'][^>]*>([^<]{2,40})<\/span>/i.exec(html);
	if (m) return m[1].replace(/\s+/g, " ").trim();
	const h1 = /<h1[^>]*>([\s\S]{0,160}?)<\/h1>/i.exec(html);
	if (h1) {
		const text = h1[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
		// 站点名不作出演者
		if (text && !/0930|4610|人妻斬り|エッチな/.test(text)) return text;
	}
	return "";
}

/**
 * 源站抖动兜底：网络错误 / 超时 / 5xx 重试一次（404 是明确答案，不重试）。
 * 实测 heyzo、caribbeancom、muramura 偶发首连失败，重试能显著降低假 404。
 */
async function fetchWithRetry(fn, attempts = 2) {
	let lastError;
	for (let i = 0; i < attempts; i++) {
		try {
			const res = await fn();
			if (res && res.status >= 500 && i < attempts - 1) continue;
			return res;
		} catch (err) {
			lastError = err;
			if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250));
		}
	}
	if (lastError) throw lastError;
	return null;
}

/** 从页面 HTML 取标题（og:title 优先，其次 <title>） */
export function titleFromHtml(html) {
	const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html);
	if (og?.[1]) return decodeEntities(og[1]);
	const t = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
	return t?.[1] ? decodeEntities(t[1]) : "";
}

/** 标题里女优名/假名/站点后缀的清洗在下面 stripSuffix；实体解码走 http.js 的共享实现 */

/** 从页面 HTML 取封面（og:image）；把协议相对 URL 补成 https（否则扩展面板会解析成 chrome-extension://） */
export function coverFromHtml(html) {
	const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i.exec(html);
	if (!og?.[1]) return null;
	const url = decodeEntities(og[1]);
	if (url.startsWith("//")) return `https:${url}`;
	if (url.startsWith("http://")) return `https://${url.slice(7)}`;
	return url;
}

/**
 * 用番号片段解析出该站需要的路径参数。
 * code 既可能是显示码（HEYZO-3953 / 100426-001），也可能是站点原始形态。
 */
export function codeParts(site, code) {
	if (site.twoSegment) {
		const m = /^(\d{2,5})[-/](\d{2,5})$/.exec(code);
		if (!m) return null;
		return { a: m[1], b: m[2] };
	}
	if (site.id === "heyzo") {
		const m = /(\d{3,5})$/.exec(code);
		return m ? { n: m[1] } : null;
	}
	return { code };
}

/** 预告片候选：优先站点模板，其次页面里抽到的真实链接 */
export function previewCandidates(site, code, order, pageMedia) {
	const parts = codeParts(site, code);
	const list = [];
	if (parts) {
		for (const u of site.previews ? site.previews(parts, order) : []) list.push({ url: u, quality: qualityOf(u) });
	}
	for (const u of pageMedia?.mp4 || []) list.push({ url: u, quality: qualityOf(u) || "page" });
	if (site.hlsAlt && parts) list.push({ url: site.hlsAlt(parts), quality: "hls", type: "hls" });
	if (pageMedia?.hls) list.push({ url: pageMedia.hls, quality: "hls", type: "hls" });
	return dedupe(list);
}

function qualityOf(url) {
	// 必须锚定文件名：`sample.heyzo.com` 这种主机名里也含 "sample"，不锚定会取错档位
	const m = /([0-9]{3,4}p)\.mp4/i.exec(url);
	if (m) return m[1];
	const h = /\/(sample_low|sample_hd|sample|hls-\d+k)\.mp4/i.exec(url);
	return h ? h[1] : null;
}

function dedupe(list) {
	const seen = new Set();
	return list.filter((x) => x?.url && !seen.has(x.url) && seen.add(x.url));
}

/**
 * 按偏好顺序逐个校验预告片候选，返回第一个可播的。
 * 校验用 Range 请求（1 KB），代价小；结果会被永久缓存，所以每个番号只付一次。
 */
export async function pickPlayablePreview(candidates, order, { verify = true, timeoutMs = 5000 } = {}) {
	if (candidates.length === 0) return null;
	const ranked = [...candidates].sort((a, b) => rankQuality(a.quality, order) - rankQuality(b.quality, order));
	for (const candidate of ranked) {
		if (candidate.type === "hls") continue; // mp4 优先，HLS 只在前面的都没戏时才考虑
		if (!verify) return { url: candidate.url, quality: candidate.quality || "single", type: "mp4" };
		if (await probeExists(candidate.url, { timeoutMs })) {
			return { url: candidate.url, quality: candidate.quality || "single", type: "mp4" };
		}
	}
	const hls = ranked.find((c) => c.type === "hls");
	return hls ? { url: hls.url, quality: "hls", type: "hls" } : null;
}

function rankQuality(quality, order) {
	if (!quality) return order.length;
	const idx = order.findIndex((q) => q.toLowerCase() === String(quality).toLowerCase());
	return idx === -1 ? order.length : idx;
}

/** 出演者标签（按优先级；配对结构里第一个命中的就是它） */
const META_ACTRESS_LABELS = ["出演者", "出演", "主演", "モデル", "女優"];
/** 发行日标签（按优先级：配信类优先，其次公开/販売/発売） */
const META_DATE_LABELS = ["配信開始日", "配信日", "公開日", "販売日", "発売日", "商品発売日"];
/** 日期形状：只有长这样才认（裸标签搜索靠它兜住误命中） */
const DATE_SHAPE = /^\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}日?$/;

/**
 * 三种通用配对结构（2026-10-10 在 9 家 HTML 站真实固件上实测）：
 * - `td/td`：HEYZO（`<td>出演</td><td><a><span>名前</span></a></td>`、`<td>公開日</td><td>2024-09-10</td>`）
 * - `dt/dd`：ピッカー / 0930系（`<dt>配信開始日 :</dt><dd>2026-08-25</dd>`）
 * - `span/span`：Hey動画（`<span>主演：</span><span><a>名前</a></span>`）、カリビアンコム（`spec-title/spec-content`）
 */
const META_PAIR_PATTERNS = [
	(label) => new RegExp(`<td[^>]*>\\s*${label}\\s*[:：]?\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, "i"),
	(label) => new RegExp(`<dt[^>]*>\\s*${label}\\s*[:：]?\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, "i"),
	(label) => new RegExp(`<span[^>]*>\\s*${label}\\s*[:：]?\\s*</span>\\s*<span[^>]*>([\\s\\S]*?)</span>`, "i"),
];

/**
 * 站点专属提示：形态差异太大，逐个声明而不是用裸标签搜索
 * （裸搜「出演者」会命中搜索框 placeholder 与「本作品の出演者は…18歳以上」免责声明）。
 */
export const SITE_META_HINTS = {
	// <p class="movie-actor"><a href="/listpages/actor_…">円山のぞみ</a></p>
	pikkur: { actressClass: "movie-actor" },
	// MovieHeader_*_actress__<hash>（CSS Modules 哈希会变，用中缀匹配）
	nyoshin: { actressClass: "_actress__" },
	// <h1>船井 悠佳 28歳</h1>（标题即出演者，去掉末尾年龄）
	h0930: { actressFromH1: true },
	h4610: { actressFromH1: true },
	c0930: { actressFromH1: true },
};

/** 单元格 → 文本：优先取 <a>/<span> 的文本（多个用「、」连），否则剥标签 */
function metaCellText(raw) {
	const links = [...String(raw).matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
		.map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
		.filter(Boolean);
	if (links.length) return links.join("、");
	return decodeEntities(String(raw).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * 从 HTML 详情页抽出演者与发行日（**只用于 HTML 站**；bifrost 站走 JSON 的 ActressesJa/Release）。
 * 解析不出就返回 null —— 绝不猜、绝不误命中免责声明或搜索框。
 */
export function extractSiteMeta(html, site) {
	const hints = SITE_META_HINTS[site?.id] || {};
	const text = String(html || "");
	if (!text) return { actress: null, releaseDate: null };

	// 出演者：配对结构 → 站点类选择器 → <h1>
	let actress = null;
	outer: for (const label of META_ACTRESS_LABELS) {
		for (const pattern of META_PAIR_PATTERNS) {
			const m = pattern(label).exec(text);
			const value = m ? metaCellText(m[1]) : "";
			if (value && value.length <= 120) {
				actress = value;
				break outer;
			}
		}
	}
	if (!actress && hints.actressClass) {
		const re = new RegExp(`<[a-z]+[^>]*class="[^"]*${hints.actressClass}[^"]*"[^>]*>([\\s\\S]*?)</`, "i");
		const m = re.exec(text);
		const value = m ? metaCellText(m[1]) : "";
		if (value && value.length <= 120) actress = value;
	}
	if (!actress && hints.actressFromH1) {
		const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text);
		const value = m ? metaCellText(m[1]).replace(/\s*\d{1,2}\s*歳\s*$/, "").trim() : "";
		if (value && value.length <= 60) actress = value;
	}

	// 发行日：配对结构（值必须是纯日期）→ 「标签：日期」文本（带日期形状约束）
	let releaseDate = null;
	outerDate: for (const label of META_DATE_LABELS) {
		for (const pattern of META_PAIR_PATTERNS) {
			const m = pattern(label).exec(text);
			const value = m ? metaCellText(m[1]) : "";
			if (DATE_SHAPE.test(value)) {
				releaseDate = value;
				break outerDate;
			}
		}
	}
	if (!releaseDate) {
		for (const label of META_DATE_LABELS) {
			// 允许标签与日期之间夹 Next.js 的 <!-- --> 标记（女体のしんぴ实测）
			const re = new RegExp(`${label}\\s*[:：]\\s*(?:<!--[\\s\\S]*?-->\\s*)?(\\d{4}[-/年.]\\d{1,2}[-/月.]\\d{1,2}日?)`);
			const m = re.exec(text);
			if (m) {
				releaseDate = m[1];
				break;
			}
		}
	}

	return { actress: actress || null, releaseDate: releaseDate || null };
}

/**
 * 解析单个站点：拿标题、封面兜底、女优/发行日（bifrost 才有）、预告片候选。
 * 返回 null 表示该站没有这个番号（404 / JSON 缺失）。
 */
export async function resolveSite(siteId, code, { qualityOrder, heyzoOrder, timeoutMs = 6000, verifyPreview = true } = {}) {
	const site = SITES[siteId];
	if (!site) return null;
	const parts = codeParts(site, code);
	if (!parts) return null;
	const sourceUrl = site.page(parts);
	const order = site.id === "heyzo" ? heyzoOrder || DEFAULT_HEYZO_ORDER : qualityOrder || DEFAULT_QUALITY_ORDER;
	// 受限站点专用的出口（未配置则为 undefined，走直连）
	const dispatcher = await siteDispatcher(site.id);

	if (site.kind === BIFROST) {
		const url = site.json(parts);
		let res;
		try {
			res = await fetchWithRetry(() =>
				fetchJson(url, { headers: { Referer: `https://${site.host}/` }, timeoutMs, dispatcher }),
			);
		} catch (err) {
			// 上游不可达（超时/网络错误）：抛出去，绝不能当成"这个号不存在"
			throw new Error(`source unreachable: ${site.host} (${err?.message || err})`);
		}
		if (res?.status >= 500) throw new Error(`source ${res.status}: ${site.host}`);
		if (res?.status !== 200 || !res.json?.Title) return null;
		const j = res.json;
		const candidates = previewCandidates(site, code, order, {
			mp4: (j.SampleFiles || []).map((f) => f.URL).filter(Boolean),
		});
		return {
			siteId: site.id,
			siteName: site.name,
			host: site.host,
			sourceUrl,
			title: site.cleanTitle ? site.cleanTitle(j.Title) : String(j.Title).trim(),
			titleRaw: j.Title,
			// 剧情介绍：bifrost JSON 自带 Desc（日文原文），比再抓 D2Pass 更省一次请求
			description: (j.Desc || "").trim() || (j.DescEn || "").trim() || null,
			actress: (j.ActressesJa || [])[0] || null,
			releaseDate: j.Release || null,
			coverAlt: j.ThumbHigh || j.MovieThumb || null,
			candidates,
			order,
			pageMedia: null,
		};
	}

	let page;
	try {
		page = await fetchWithRetry(() =>
			// charset 用适配器声明：部分站（如 caribbeancompr）既不声明 Content-Type charset、
			// 页面里也没有 <meta charset>，回落 UTF-8 就是乱码
			fetchText(sourceUrl, { headers: { Referer: `https://${site.host}/` }, timeoutMs, dispatcher, charset: site.charset }),
		);
	} catch (err) {
		throw new Error(`source unreachable: ${site.host} (${err?.message || err})`);
	}
	if (page?.status >= 500) throw new Error(`source ${page.status}: ${site.host}`);
	if (page?.status !== 200) return null;
	const rawTitle = site.extractTitle ? site.extractTitle(page.text) : titleFromHtml(page.text);
	if (!rawTitle) return null;
	const pageMedia = extractMediaFromHtml(page.text);
	// 出演者 / 发行日：HTML 站从页面标签抽（2026-10-10 起；此前这两项**硬编码 null**，
	// 导致 HEYZO / ピッカー / 0930系 / 女体のしんぴ 等站的面板浮条两侧全空）
	const meta = extractSiteMeta(page.text, site);
	// 封面：og:image 优先；老页面没有 og:image 时用站点模板拼，但**先探活**再采用
	let coverAlt = coverFromHtml(page.text);
	if (!coverAlt && site.coverTemplate) {
		const candidate = site.coverTemplate(parts);
		if (candidate && (await probeExists(candidate, { timeoutMs }))) coverAlt = candidate;
	}
	return {
		siteId: site.id,
		siteName: site.name,
		host: site.host,
		sourceUrl,
		title: site.cleanTitle ? site.cleanTitle(rawTitle) : stripSuffix(rawTitle, []),
		titleRaw: rawTitle,
		actress: meta.actress,
		releaseDate: meta.releaseDate,
		coverAlt,
		candidates: previewCandidates(site, code, order, pageMedia),
		order,
		pageMedia,
	};
}

/**
 * 只探测存在性，不下整页（用于歧义番号的多站并发判定）。
 *
 * **返回三态**而非布尔：`ok` / `notfound` / `error`。把"探测失败"和"确认不存在"混为一谈，
 * 会让路由层误判为需要退到分隔符兄弟形态，从而在另一个站上命中同数字的另一部影片。
 */
export async function siteExists(siteId, code, { timeoutMs = 6000 } = {}) {
	const site = SITES[siteId];
	if (!site) return "notfound";
	const parts = codeParts(site, code);
	if (!parts) return "notfound";
	if (site.kind === BIFROST) {
		try {
			const res = await fetchRaw(site.json(parts), { method: "HEAD", headers: { Referer: `https://${site.host}/` }, timeoutMs });
			if (res.status === 200) return "ok";
			if (res.status === 404 || res.status === 410) return "notfound";
			if (res.status >= 500) return "error";
			if (res.status !== 405 && res.status !== 403 && res.status !== 501) return "notfound";
		} catch {
			return "error";
		}
		try {
			const res = await fetchJson(site.json(parts), { headers: { Referer: `https://${site.host}/` }, timeoutMs });
			if (res.status >= 500) return "error";
			return res.status === 200 && Boolean(res.json?.Title) ? "ok" : "notfound";
		} catch {
			return "error";
		}
	}
	// 有些站点对任何番号都回 200（0930 系），只能靠页面内容判断收录与否
	if (site.presenceByContent) {
		try {
			const res = await fetchText(site.page(parts), {
				headers: { Referer: `https://${site.host}/` },
				timeoutMs,
				charset: site.charset,
			});
			if (res.status >= 500) return "error";
			if (res.status !== 200) return res.status === 404 || res.status === 410 ? "notfound" : "error";
			const title = site.extractTitle ? site.extractTitle(res.text) : titleFromHtml(res.text);
			return title ? "ok" : "notfound";
		} catch {
			return "error";
		}
	}
	return probeStatus(site.page(parts), { timeoutMs, referer: `https://${site.host}/` });
}

export function siteName(siteId) {
	return SITES[siteId]?.name || siteId;
}
