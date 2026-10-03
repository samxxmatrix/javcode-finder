/**
 * Emby 媒体库「已在库」判定的纯逻辑层：
 * 地址/查询构造、响应解析、番号键生成、本地匹配、同步策略判定。
 * 全部为纯函数（不碰浏览器 API），网络请求在 background 执行。
 */

/** 索引有效期：面板打开时未过期直接复用，零请求 */
export const EMBY_INDEX_TTL_MS = 10 * 60 * 1000;
/** 全量校准周期：超过则重新全量拉取（用于处理删除） */
export const EMBY_FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 分页大小 */
export const EMBY_PAGE_SIZE = 2000;
/** 超过该条目数放弃全量索引，改逐条 SearchTerm */
export const EMBY_INDEX_LIMIT = 30000;
/** 增量时间窗回退量（容忍客户端时钟超前服务器） */
export const EMBY_SYNC_OVERLAP_MS = 60 * 60 * 1000;
/** 逐条兜底查询的并发数 */
export const EMBY_SEARCH_CONCURRENCY = 4;
/** 逐条兜底查询的返回条数 */
export const EMBY_SEARCH_LIMIT = 5;
/** 候选番号长度上限（与 extract-codes.ts 的 MAX_CANDIDATE_LENGTH 一致） */
export const EMBY_MAX_CODE_LENGTH = 64;

export interface EmbyItemLike {
	Name?: string | null;
	FileName?: string | null;
	Path?: string | null;
	Type?: string | null;
}

/** 主机名（含可选端口）合法性：IPv4/域名或 IPv6 字面量 */
const HOST_PATTERN = /^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::\d+)?$/i;

/**
 * 把用户填写的地址规范成 origin：去空白、补 http://、丢弃路径与查询串。
 * 非 http(s)、非法主机或空值返回空串（调用方据此判定"未配置"）。
 */
export function normalizeEmbyBaseUrl(raw: string): string {
	const trimmed = (raw || "").trim();
	if (!trimmed) return "";
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
		return "";
	}
	const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
	try {
		const url = new URL(withScheme);
		if (!HOST_PATTERN.test(url.host)) return "";
		return `${url.protocol}//${url.host}`;
	} catch {
		return "";
	}
}

export interface EmbyItemsQuery {
	startIndex?: number;
	limit?: number;
	/** ISO 时间串；给定时走增量查询 */
	minDateLastSaved?: string | null;
}

/** 构造条目查询 URL；地址或 Key 缺失返回空串 */
export function buildEmbyItemsUrl(
	baseUrl: string,
	apiKey: string,
	query: EmbyItemsQuery = {},
): string {
	const base = normalizeEmbyBaseUrl(baseUrl);
	const key = (apiKey || "").trim();
	if (!base || !key) return "";
	const params = new URLSearchParams({
		api_key: key,
		Recursive: "true",
		IncludeItemTypes: "Movie,Folder",
		Fields: "Path",
		EnableImages: "false",
		EnableUserData: "false",
		Limit: String(query.limit ?? EMBY_PAGE_SIZE),
		StartIndex: String(query.startIndex ?? 0),
	});
	if (query.minDateLastSaved) {
		params.set("MinDateLastSaved", query.minDateLastSaved);
	}
	return `${base}/emby/Items?${params.toString()}`;
}

/** 构造逐条兜底查询 URL（只在索引超过 EMBY_INDEX_LIMIT 时使用） */
export function buildEmbySearchUrl(
	baseUrl: string,
	apiKey: string,
	code: string,
): string {
	const base = normalizeEmbyBaseUrl(baseUrl);
	const key = (apiKey || "").trim();
	const term = (code || "").trim();
	if (!base || !key || !term) return "";
	const params = new URLSearchParams({
		api_key: key,
		Recursive: "true",
		IncludeItemTypes: "Movie,Folder",
		Fields: "Path",
		EnableImages: "false",
		EnableUserData: "false",
		SearchTerm: term,
		Limit: String(EMBY_SEARCH_LIMIT),
	});
	return `${base}/emby/Items?${params.toString()}`;
}

/** 解析条目响应；结构非法返回 null（调用方据此保留旧索引） */
export function parseEmbyItems(
	payload: unknown,
): { items: EmbyItemLike[]; total: number } | null {
	if (!payload || typeof payload !== "object") return null;
	const raw = payload as { Items?: unknown; TotalRecordCount?: unknown };
	if (!Array.isArray(raw.Items)) return null;
	const items = raw.Items.filter(
		(item): item is EmbyItemLike => Boolean(item) && typeof item === "object",
	);
	const total =
		typeof raw.TotalRecordCount === "number"
			? raw.TotalRecordCount
			: items.length;
	return { items, total };
}
