import { toComparisonKey } from "./normalize-code";
import { pickReleaseDate, toPerformers } from "./release-meta";

/**
 * 番号 → FALENO 官网格式 key:去分隔符、转小写(如 FNS-263 → fns263)。
 * 空输入返回空串,调用方跳过请求。
 */
export function toFalenoCodeKey(code: string): string {
	return toComparisonKey(code).toLowerCase();
}

/**
 * 拼接 FALENO 作品页 URL:https://faleno.jp/top/works/{小写去连字符番号}/。
 *
 * 拦截口径(2026-11-02 实测更正):站点拦的是**大陆段**,不是"非日本出口"。
 * 大陆宽带带不带尾斜杠一律 403(XSERVER 拦截页,Server: nginx,静态页);
 * 美国 / 东京出口则 200。所以"带斜杠就能过"的旧经验已不成立,尾斜杠不再是通行证。
 *
 * 仍保留尾斜杠的三条理由:① 它是站点规范/跳转后的形状(东京出口会 301 到带斜杠版本),
 * 直接请求省一跳;② 与反代端 `FALENO_ORIGIN + /top/works/{key}/` 保持同一形状;
 * ③ 历史固件(FNS263.html)与反代解析都基于该形状,改了没有收益只有风险。
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
	/** 出演者（源站顺序，已拆分/去空/去重） */
	performers: string[];
	/** 发布日（配信日 优先，回退 発売日；归一化为 YYYY-MM-DD） */
	releaseDate: string | null;
}

/** 主作品信息块的标签表（固件 FNS263 实测：出演女優 / 配信日 / 発売日） */
const CAST_LABELS = ["出演女優", "出演者"] as const;
const DELIVERY_LABELS = ["配信日", "配信開始日"] as const;
const SALE_LABELS = ["発売日", "商品発売日"] as const;

/**
 * 取主作品信息块里 `<span>标签</span><p>值</p>` 的**首个**值（同名标签只认第一次出现）。
 * 值里可能嵌 `<a>`/`<br>`：剥标签后解码实体。
 */
function readInfoPairs(block: string): Map<string, string> {
	const pairs = new Map<string, string>();
	const pattern = /<span>([^<]{1,20})<\/span>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
	for (const match of block.matchAll(pattern)) {
		const label = (match[1] ?? "").trim();
		const value = decodeHtmlEntities(
			(match[2] ?? "").replace(/<[^>]+>/g, "").trim(),
		).trim();
		if (label && value && !pairs.has(label)) pairs.set(label, value);
	}
	return pairs;
}

function readLabeledValue(
	pairs: Map<string, string>,
	labels: readonly string[],
): string | null {
	for (const label of labels) {
		const value = pairs.get(label);
		if (value) return value;
	}
	return null;
}

/**
 * 解析 FALENO 作品页 HTML(实测结构,固件 test/fixtures/FNS263.html):
 * <a class="pop_sample" href="{预告片 mp4}">
 *   <img src="{封面}" alt="{标题}">
 *   <p><img src=".../img_play.png" alt="サンプル動画を見る"></p>
 * </a>
 * <div class="box_works01_text"><p>{介绍}</p></div>
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

	// 主作品信息块：第一个 box_works01_list。⚠️ 锚点**不带结尾引号**：
	// 固件里属性是 `class="box_works01_list clearfix"`，写成 `class="box_works01_list"` 永远切不出来
	// （与 box_works01_text 不同，它没有附加类）。相关作品区的 text_kanren01 有同名「出演女優」标签，
	// 底部栏还有「2026/11/5 発売開始」这种自由日期 → 必须在 text_kanren01 之前截断。
	const listBlock = (html.split('class="box_works01_list')[1] ?? "").split(
		"text_kanren01",
	)[0] ?? "";
	const info = readInfoPairs(listBlock);

	return {
		previewUrl: trailer,
		coverUrl,
		shortTitle: altText !== null ? decodeHtmlEntities(altText) : null,
		title,
		performers: toPerformers(readLabeledValue(info, CAST_LABELS)),
		releaseDate: pickReleaseDate(
			readLabeledValue(info, DELIVERY_LABELS),
			readLabeledValue(info, SALE_LABELS),
		),
	};
}
