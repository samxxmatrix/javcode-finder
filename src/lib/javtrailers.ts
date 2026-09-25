import { toComparisonKey } from "./normalize-code";

export interface SearchPageResolution {
	detailUrl: string;
	contentId: string;
	// 影片完整标题（来自卡片 a 标签的 title 属性），无标题时为 null
	title: string | null;
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

/**
 * 解析 javtrailers 搜索页 HTML，确认第一张结果卡片是否精确匹配目标番号。
 * 命中时返回其详情页 URL、Content ID（javtrailers 的完整番号格式，含前缀与补零，
 * 如 1dldss00547）与影片标题，否则返回 null（调用方回退到搜索页）。
 *
 * 搜索页为 SSR，卡片结构（已实测验证）：
 * <div class="card-container"><a href="/video/{contentId}" title="{标题}">...<img alt="{番号} jav">
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

	const hrefMatch = firstCard.match(/href="\/video\/([a-zA-Z0-9_-]+)"/);
	const altMatch = firstCard.match(/alt="([^"]*)"/);
	if (!hrefMatch || !altMatch) return null;

	// alt 形如 "DLDSS-529 jav"：提取空格前的番号 token 与目标比对
	const altCode = altMatch[1]!.split(/\s+/)[0];
	const altKey = toComparisonKey(altCode);
	if (!altKey || !altKey.includes(targetKey)) return null;

	// a 标签的 title 属性即影片完整标题（不含番号前缀）
	const titleMatch = firstCard.match(
		/href="\/video\/[a-zA-Z0-9_-]+"[^>]*title="([^"]*)"/,
	);
	const title = titleMatch ? decodeHtmlEntities(titleMatch[1]!) : null;

	const contentId = hrefMatch[1]!.toLowerCase();
	return {
		detailUrl: `https://javtrailers.com/video/${contentId}`,
		contentId,
		title,
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
