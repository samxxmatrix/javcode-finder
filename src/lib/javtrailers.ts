import { toComparisonKey } from "./normalize-code";
import { pickReleaseDate, toPerformers } from "./release-meta";

/**
 * JavTrailers 站点基础链接（**日语版**）。所有主域请求（搜索页 / 详情页）一律由它派生，
 * 不要再散落硬编码：不带 /ja 的英文版会返回英文标题与英文元数据。
 * 注意 CDN 子域（images / media.javtrailers.com）是独立的资产域名，不走这个前缀。
 */
export const JAVTRAILERS_BASE_URL = "https://javtrailers.com/ja";

/** 搜索页：日语版 /ja/search/{code} */
export function buildSearchUrl(code: string): string {
	return `${JAVTRAILERS_BASE_URL}/search/${encodeURIComponent(code)}`;
}

/** 详情页：日语版 /ja/video/{contentId} */
export function buildDetailUrl(contentId: string): string {
	return `${JAVTRAILERS_BASE_URL}/video/${encodeURIComponent(contentId)}`;
}

export interface SearchPageResolution {
	detailUrl: string;
	contentId: string;
	// 影片标题（优先日语卡片正文 vid-title；取不到才回退 a 标签的英文 title），无标题时为 null
	title: string | null;
}

/** 解码 SSR HTML 属性/正文里常见的 HTML 实体（含十进制与十六进制数字实体） */
function decodeHtmlEntities(text: string): string {
	const fromCodePoint = (
		match: string,
		digits: string,
		radix: number,
	): string => {
		const code = Number.parseInt(digits, radix);
		return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
	};
	return text
		.replace(/&#(\d+);/g, (m, d: string) => fromCodePoint(m, d, 10))
		.replace(/&#x([0-9a-f]+);/gi, (m, d: string) => fromCodePoint(m, d, 16))
		.replace(/&amp;/g, "&")
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

/**
 * vid-title 形如 `DLDSS-529 電撃移籍 DAHLIA …`：开头番号只用于定位作品，不是标题的一部分。
 * 仅当开头 token 与卡片 alt 番号一致时才剥掉，避免误删以英数字开头的正常标题。
 */
function stripLeadingCode(text: string, altCode: string): string {
	const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)\s+/.exec(text);
	if (!match || toComparisonKey(match[1]) !== toComparisonKey(altCode)) {
		return text;
	}
	return text.slice(match[0].length).trim() || text;
}

/**
 * 第一张卡片的标题有两个来源，优先级不可颠倒（2026-11-11 线上实测）：
 * 1. `<p class="card-text title mb-0 vid-title">`：日语版搜索页给**日文原文**
 *    （`/ja/search/DLDSS-529` → `DLDSS-529 電撃移籍 DAHLIA …`；英文版同一位置是英文）。
 * 2. `<a title="…">`：站点所有语言共用的一份**英文**标题，仅在 vid-title 缺失时兜底。
 * 此前只取 a 标签，导致 JT 源标题恒为英文，英文界面还会「把英文翻成英文」。
 */
function readCardTitle(cardHtml: string, altCode: string): string | null {
	const cardTitle = cardHtml.match(
		/<p[^>]*class="[^"]*vid-title[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
	);
	if (cardTitle) {
		const text = decodeHtmlEntities(
			(cardTitle[1] ?? "").replace(/<[^>]+>/g, " "),
		)
			.replace(/\s+/g, " ")
			.trim();
		if (text) return stripLeadingCode(text, altCode);
	}
	const anchorTitle = cardHtml.match(
		/href="(?:\/ja)?\/video\/[a-zA-Z0-9_-]+"[^>]*title="([^"]*)"/,
	);
	return anchorTitle ? decodeHtmlEntities(anchorTitle[1]!) : null;
}

/**
 * 解析 javtrailers 搜索页 HTML，确认第一张结果卡片是否精确匹配目标番号。
 * 命中时返回其详情页 URL、Content ID（javtrailers 的完整番号格式，含前缀与补零，
 * 如 1dldss00547）与影片标题，否则返回 null（调用方回退到搜索页）。
 *
 * 搜索页为 SSR，卡片结构（已实测验证）：
 * <div class="card-container"><a href="/ja/video/{contentId}" title="{英文标题}">…<img alt="{番号} jav">
 *   <p class="card-text title mb-0 vid-title">{番号} {日文标题}</p></a></div>
 */
export function parseSearchPageHtml(
	html: string,
	code: string,
): SearchPageResolution | null {
	const targetKey = toComparisonKey(code);
	if (!html || !targetKey) return null;

	// 按卡片容器切块；split 后首元素是卡片之前的页面头部，从第二块起才是卡片。
	// 锚点必须用 class="card-container"：页面 <style> 内的 .card-container 规则会先出现，
	// 仅靠 "card-container" 切分会落在 CSS 块上（真实页面实测踩坑）。
	const blocks = html.split('class="card-container"').slice(1);
	const firstCard = blocks[0];
	if (!firstCard) return null;

	// 卡片链接在日语站带语言前缀（实测 /ja/search 的卡片是 href="/ja/video/…"）：
	// 必须容忍可选前缀，否则改走 /ja/ 后整个解析直接失效。
	// 2026-10 固件：<a href="/ja/video/1dldss00529" class="video-link" title="…"><img alt="DLDSS-529 jav">
	const hrefMatch = firstCard.match(/href="(?:\/ja)?\/video\/([a-zA-Z0-9_-]+)"/);
	const altMatch = firstCard.match(/alt="([^"]*)"/);
	if (!hrefMatch || !altMatch) return null;

	// alt 形如 "DLDSS-529 jav"：提取空格前的番号 token 与目标比对
	const altCode = altMatch[1]!.split(/\s+/)[0] ?? "";
	const altKey = toComparisonKey(altCode);
	if (!altKey || !altKey.includes(targetKey)) return null;

	const contentId = hrefMatch[1]!.toLowerCase();
	return {
		detailUrl: buildDetailUrl(contentId),
		contentId,
		title: readCardTitle(firstCard, altCode),
	};
}

/**
 * 由 Content ID（完整格式，含前缀与补零，来自 parseSearchPageHtml）构造封面图 URL。
 * 番号→Content ID 无法可靠推导（前缀规则不公开），封面/预告片 URL 一律以解析结果为准。
 */
export function buildCoverUrlFromContentId(contentId: string): string {
	if (!contentId) return "";
	return `https://images.javtrailers.com/digital/video/${contentId}/${contentId}pl.w800.webp`;
}

/**
 * 由 Content ID 构造预告片 HLS URL。
 * 路径规律（已实测验证）：{首字母}/{前3字母}/{完整ContentId}/playlist.m3u8。
 */
export function buildTrailerUrlFromContentId(contentId: string): string {
	if (contentId.length < 3) return "";
	const prefix = contentId.slice(0, 3);
	return `https://media.javtrailers.com/hlsvideo/freepv/${contentId[0]}/${prefix}/${contentId}/playlist.m3u8`;
}

export interface DetailPageMeta {
	/** 出演者（源站顺序，已拆分/去空/去重） */
	performers: string[];
	/** 发布日（已归一化为 YYYY-MM-DD）；取不到为 null */
	releaseDate: string | null;
}

/** 发现日期的两档标签：配信開始日/配信日 优先，回退 商品発売日/発売日（与全站口径一致） */
const DETAIL_DELIVERY_LABELS = ["配信開始日", "配信日"] as const;
const DETAIL_SALE_LABELS = ["商品発売日", "発売日"] as const;

/** 取 `<span …>标签：</span>` 到该段落 `</p>` 之间的原始片段（找不到返回空串） */
function readLabeledParagraph(html: string, label: string): string {
	const at = html.indexOf(`${label}：`);
	if (at < 0) return "";
	const end = html.indexOf("</p>", at);
	return end < 0 ? html.slice(at, at + 800) : html.slice(at, end);
}

/** 段落片段里的纯文本值（剥标签、解实体、去掉标签与冒号、压空白） */
function readLabeledText(html: string, labels: readonly string[]): string | null {
	for (const label of labels) {
		const fragment = readLabeledParagraph(html, label);
		if (!fragment) continue;
		const text = decodeHtmlEntities(fragment.replace(/<[^>]+>/g, " "))
			.replace(label, " ")
			.replace(/[：:]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (text) return text;
	}
	return null;
}

/**
 * javtrailers 日语详情页 → 出演者 + 发布日。
 *
 * 固件实测（`test/fixtures/javtrailers-ja-video-1dldss00529.html`）：
 * - 出演者：`<p class="mb-1"><span class="font-weight-bold mr-3">出演者：</span>
 *   <!--[--><a href="/ja/casts/kumi-koizumi" …>小泉玖美</a><!--]--></p>`（多女优＝多个 `<a>`）
 * - 日期：该页**只有** `商品発売日： 01 Oct 2026`（没有配信開始日/配信日）→ 走回退档
 *
 * 注意：详情页的「関連動画」区也有 `class="card-container"`，所以**只能**按标签锚定解析，
 * 绝不能去抓卡片。解析不到一律空值，绝不猜。
 */
export function parseDetailPageMeta(html: string): DetailPageMeta {
	const empty: DetailPageMeta = { performers: [], releaseDate: null };
	if (!html) return empty;

	const castFragment = readLabeledParagraph(html, "出演者");
	const performers = castFragment
		? toPerformers(
				[
					...castFragment.matchAll(
						/<a\b[^>]*href="\/ja\/casts\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
					),
				].map((match) =>
					decodeHtmlEntities((match[1] ?? "").replace(/<[^>]+>/g, "").trim()),
				),
			)
		: [];

	return {
		performers,
		releaseDate: pickReleaseDate(
			readLabeledText(html, DETAIL_DELIVERY_LABELS),
			readLabeledText(html, DETAIL_SALE_LABELS),
		),
	};
}

export interface DetailPageFallback {
	coverUrl: string | null;
	trailerUrl: string | null;
}

/**
 * 解析详情页 HTML，提取备用媒体（主媒体服务 404 时兜底）：
 * - 封面：第一张 mgstage 图片（og:image 的包装图）
 * - 预告片：mgstage sample MP4 直链；无 mgstage 时（如 VR 系列）取
 *   media.javtrailers.com 的 vrsample MP4（路径形如 /vrsample/s/siv/sivr00513/sivr00513vrlite.mp4）
 * 提取不到时对应字段为 null。
 */
export function parseDetailPageFallback(html: string): DetailPageFallback {
	if (!html) return { coverUrl: null, trailerUrl: null };
	const cover =
		html.match(/https:\/\/image\.mgstage\.com[^"\s\\]+\.(?:jpg|webp|png)/i)?.[0] ??
		null;
	const trailer =
		html.match(/https:\/\/sample\.mgstage\.com[^"\\]+\.mp4/i)?.[0] ??
		html.match(/https:\/\/media\.javtrailers\.com[^"\\]+\.mp4/i)?.[0] ??
		null;
	return { coverUrl: cover, trailerUrl: trailer };
}
