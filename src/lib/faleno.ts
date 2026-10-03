import { toComparisonKey } from "./normalize-code";

/**
 * 番号 → FALENO 官网格式 key:去分隔符、转小写(如 FNS-263 → fns263)。
 * 空输入返回空串,调用方跳过请求。
 */
export function toFalenoCodeKey(code: string): string {
	return toComparisonKey(code).toLowerCase();
}

/**
 * 拼接 FALENO 作品页 URL:https://faleno.jp/top/works/{小写去连字符番号}/。
 * 尾斜杠是必需的:2026-10 实测站点对非日本出口只放行带斜杠的地址,
 * 不带斜杠直接返回 XSERVER 403 拦截页(国内出口多批次 100% 403),
 * 带斜杠多批次 100% 200;东京出口虽会 301 到带斜杠版本,但直连路径依赖这个形状。
 */
export function buildFalenoWorksUrl(code: string): string {
	const key = toFalenoCodeKey(code);
	if (!key) return "";
	return `https://faleno.jp/top/works/${key}/`;
}

/**
 * 归一化番号头设置项:trim + 转 comparison key(去分隔符、大写)。
 * 空串或纯分隔符输入返回空串,由调用方过滤。
 */
export function normalizePrefix(input: string): string {
	return toComparisonKey(input);
}

/**
 * 番号是否命中任一 FALENO 番号前缀:两侧均转 comparison key 比较,
 * 大小写与分隔符通吃。空番号或空前缀列表均不命中。
 */
export function matchesFalenoPrefix(code: string, prefixes: string[]): boolean {
	const key = toComparisonKey(code);
	if (!key) return false;
	return prefixes.some((prefix) => {
		const normalized = normalizePrefix(prefix);
		return Boolean(normalized) && key.startsWith(normalized);
	});
}

/** 解码 SSR HTML 属性中常见的 HTML 实体 */
function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

/** 站点「页面不存在」页的标题锚点 */
const NOT_FOUND_PAGE_MARKER = "ページが見つかりませんでした";

/**
 * HTML 是否为站点「ページが見つかりませんでした」(404 Not Found) 页面。
 * 不存在的作品可能以 404 状态码返回,也可能以 200 + 该页面返回,两种情况都按查无处理。
 */
export function isFalenoNotFoundPage(html: string): boolean {
	return html.includes(NOT_FOUND_PAGE_MARKER);
}

export interface FalenoWorksData {
	previewUrl: string | null;
	coverUrl: string | null;
	shortTitle: string | null;
	title: string | null;
}

/**
 * 解析 FALENO 作品页 HTML(实测结构,固件 test/fixtures/FNS263.html):
 * <a class="pop_sample" href="{预告片 mp4}">
 *   <img src="{封面}" alt="{短标题}">
 *   <p><img src=".../img_play.png" alt="サンプル動画を見る"></p>
 * </a>
 * <div class="box_works01_text"><p>{长标题}</p></div>
 *
 * 页面内 pop_sample 出现多次(相关作品区),首个即目标作品;
 * 块内第一个 <img> 是封面(第二个是播放图标,忽略)。
 * 404 页面与无 pop_sample 结构的页面均返回 null(视为查无)。
 */
export function parseFalenoWorksHtml(html: string): FalenoWorksData | null {
	if (!html || isFalenoNotFoundPage(html)) return null;
	const sampleBlock = html.split('class="pop_sample"')[1];
	if (!sampleBlock) return null;

	const trailer = sampleBlock.match(/href="([^"]+\.mp4[^"]*)"/i)?.[1] ?? null;
	const imgTag = sampleBlock.match(/<img[^>]+>/);
	const coverUrl = imgTag?.[0].match(/src="([^"]+)"/)?.[1] ?? null;
	const altText = imgTag?.[0].match(/alt="([^"]*)"/)?.[1] ?? null;

	const textBlock = html.split('class="box_works01_text"')[1];
	const titleMatch = textBlock?.match(/<p[^>]*>([\s\S]*?)<\/p>/);
	const title = titleMatch ? decodeHtmlEntities(titleMatch[1]!.trim()) : null;

	return {
		previewUrl: trailer,
		coverUrl,
		shortTitle: altText !== null ? decodeHtmlEntities(altText) : null,
		title,
	};
}
