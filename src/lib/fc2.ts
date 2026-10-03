import { toComparisonKey } from "./normalize-code";

/**
 * FC2（adult.contents.fc2.com）预览数据源。
 *
 * 与 DMM / JavTrailers 不同，FC2 号走**独占**链路：番号即文章号，直接问公开的
 * `/api/v2/videos/{文章号}/sample`（无需 key / cookie / 会话）。实测（2026-10-04）：
 * - 命中：HTTP 200 + `{path, poster_image_path, code:200}`，path 是带 `mid` 令牌的 mp4 直链
 * - 号不存在：HTTP 400 + `{"code":400}`
 * - 令牌会失效（过期后 403），因此 path **只能每次重新解析，绝不能缓存**
 * - 标题不在 API 里，只能从 `/embed/{文章号}/` 的 `data-title` 取
 *
 * 本模块只做纯逻辑（取号 / 拼 URL / 解析响应），网络与重试策略在 background。
 */

export const FC2_ORIGIN = "https://adult.contents.fc2.com";

/** 数字段位数范围与默认正则的 FC2 分支一致（3-8 位） */
const FC2_ARTICLE_ID_PATTERN = /^FC2(\d{3,8})$/;

/**
 * FC2 番号 → 文章号（数字段）。非 FC2 或位数不在 3-8 时返回 null。
 * 两种写法都吃：`FC2-4942266`、`FC2-PPV-4942266`（归一化后同为 FC24942266）。
 */
export function fc2ArticleId(raw: string | null | undefined): string | null {
	const key = toComparisonKey(raw);
	if (!key) return null;
	const match = FC2_ARTICLE_ID_PATTERN.exec(key);
	return match ? match[1]! : null;
}

export function buildFc2SampleUrl(articleId: string): string {
	return `${FC2_ORIGIN}/api/v2/videos/${encodeURIComponent(articleId)}/sample`;
}

export function buildFc2EmbedUrl(articleId: string): string {
	return `${FC2_ORIGIN}/embed/${encodeURIComponent(articleId)}/`;
}

export function buildFc2DetailUrl(articleId: string): string {
	return `${FC2_ORIGIN}/article/${encodeURIComponent(articleId)}/`;
}

export interface Fc2Sample {
	previewUrl: string;
	coverUrl: string | null;
}

function isHttpsUrl(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("https://");
}

/**
 * 校验 `/sample` 响应。只有 `code === 200` 且 `path` 是 https 才认；
 * 其余情况（400 无此片、字段缺失、脏地址）一律返回 null —— fail closed，
 * 绝不把不可信地址交给 `<video>` / `<img>`。封面非法只丢封面，不影响预览。
 */
export function parseFc2SampleResponse(data: unknown): Fc2Sample | null {
	if (typeof data !== "object" || data === null) return null;
	const d = data as Record<string, unknown>;
	if (d.code !== 200) return null;
	if (!isHttpsUrl(d.path)) return null;
	return {
		previewUrl: d.path,
		coverUrl: isHttpsUrl(d.poster_image_path) ? d.poster_image_path : null,
	};
}

export interface Fc2EmbedData {
	contentId: string | null;
	title: string | null;
}

/** 与 javtrailers.ts 内同名私有函数同口径（&amp; 必须先替换） */
function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

/**
 * 解析内嵌播放页：取 `data-title`（标题）与 `data-vid`（FC2 内部 contentId）。
 * 两个属性都不存在时返回 null —— 这正是 FC2「找不到该视频」页面的形态。
 * 只缺其一时仍返回，缺失字段为 null（标题取不到不该影响预览）。
 */
export function parseFc2EmbedHtml(html: string): Fc2EmbedData | null {
	if (!html) return null;
	const vid = /data-vid="([^"]*)"/.exec(html)?.[1] ?? "";
	const title = /data-title="([^"]*)"/.exec(html)?.[1] ?? "";
	if (!vid && !title) return null;
	return {
		contentId: vid || null,
		title: title ? decodeHtmlEntities(title) : null,
	};
}
