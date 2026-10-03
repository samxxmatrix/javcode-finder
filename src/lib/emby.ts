import { MAX_CANDIDATE_LENGTH, extractCandidatesFromText } from "./extract-codes";
import { normalizeCode, toComparisonKey } from "./normalize-code";

/**
 * Emby 媒体库「已在库」判定的纯逻辑层。
 * 本轮：地址规范化、条目查询 URL 构造、响应解析、索引键生成。
 * 后续任务在此模块补充：候选匹配、同步策略判定。
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
/** 候选番号长度上限（与抽取层保持一致，避免边界漂移） */
export const EMBY_MAX_CODE_LENGTH = MAX_CANDIDATE_LENGTH;

export interface EmbyItemLike {
	Name?: string | null;
	FileName?: string | null;
	Path?: string | null;
	Type?: string | null;
}

/** 主机名合法性：IPv6 字面量，或由 . 分隔的标签（允许下划线，不允许空标签/首尾连字符） */
const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-_]*[a-z0-9])?$/i;

function isHostValid(hostname: string): boolean {
	if (hostname.startsWith("[")) return true; // IPv6 字面量，URL 已校验
	const labels = hostname.replace(/\.$/, "").split(".");
	return labels.length > 0 && labels.every((label) => HOST_LABEL_PATTERN.test(label));
}

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
		if (!isHostValid(url.hostname)) return "";
		// 输出规范化后的主机名：去掉一个尾点，保证 "emby.local." 与 "emby.local" 同一 origin
		const hostname = url.hostname.replace(/\.$/, "");
		const host = url.port ? `${hostname}:${url.port}` : hostname;
		return `${url.protocol}//${host}`;
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
	// 请求的 limit 必须是正整数且不超过 EMBY_INDEX_LIMIT，否则回退 EMBY_PAGE_SIZE。
	// 上限的意义：单次响应绝不把整个媒体库拉下来（Emby 里 Limit=0 表示「不限量」）。
	const limit =
		typeof query.limit === "number" &&
		Number.isInteger(query.limit) &&
		query.limit > 0 &&
		query.limit <= EMBY_INDEX_LIMIT
			? query.limit
			: EMBY_PAGE_SIZE;
	const startIndex =
		typeof query.startIndex === "number" &&
		Number.isInteger(query.startIndex) &&
		query.startIndex >= 0
			? query.startIndex
			: 0;
	const params = new URLSearchParams({
		api_key: key,
		Recursive: "true",
		IncludeItemTypes: "Movie,Folder",
		Fields: "Path",
		EnableImages: "false",
		EnableUserData: "false",
		Limit: String(limit),
		StartIndex: String(startIndex),
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

export interface EmbyItemsPage {
	items: EmbyItemLike[];
	/** 服务端总数；缺失或非法时为 null（未知），调用方需继续翻页而不是当作页长 */
	total: number | null;
}

/** 解析条目响应；结构非法返回 null（调用方据此保留旧索引） */
export function parseEmbyItems(payload: unknown): EmbyItemsPage | null {
	if (!payload || typeof payload !== "object") return null;
	const raw = payload as { Items?: unknown; TotalRecordCount?: unknown };
	if (!Array.isArray(raw.Items)) return null;
	const items = raw.Items.filter(
		(item): item is EmbyItemLike =>
			typeof item === "object" && item !== null && !Array.isArray(item),
	);
	// 只有非负整数才可用；其余（含缺失/负数/小数/NaN）记为未知
	const total =
		typeof raw.TotalRecordCount === "number" &&
		Number.isInteger(raw.TotalRecordCount) &&
		raw.TotalRecordCount >= 0
			? raw.TotalRecordCount
			: null;
	return { items, total };
}

/** 每个数字串去掉前导零（保留分隔符形态）——必须在去分隔符之前做 */
export function stripNumericLeadingZeros(code: string): string {
	return code.replace(/(?<!\d)0+(?=\d)/g, "");
}

/** 主键：归一化后去掉分隔符（JUL-769 → JUL769）；与 toComparisonKey 同规则 */
export function codeKeyA(code: string): string {
	return toComparisonKey(code);
}

/**
 * 副键：归一化后按数字串去前导零，再去分隔符（HEYZO-0406 → HEYZO406）。
 * 键只用于比较，不得回灌（例如 codeKeyB("A0-123") === "A0123"，
 * 但 codeKeyB("A0123") === "A123"）。
 */
export function codeKeyB(code: string): string {
	return stripNumericLeadingZeros(normalizeCode(code)).replace(
		/[\s_—–-]+/g,
		"",
	);
}

/**
 * 一个写法的全部键（keyB 与 keyA 相同则只返回一个）；超长/空值返回空数组。
 * 归一后为空串（如 "-"）返回 []；键只用于比较，不得把键再喂回本函数。
 */
export function keysForCode(code: string): string[] {
	const normalized = normalizeCode(code);
	if (!normalized || normalized.length > EMBY_MAX_CODE_LENGTH) return [];
	const a = codeKeyA(normalized);
	if (!a) return [];
	const b = codeKeyB(normalized);
	return a === b ? [a] : [a, b];
}

/**
 * 抽取单个条目上的全部键（去重后）。
 * 必须逐字段跑正则再合并：把多字段拼成一个大串会在边界造出伪键
 * （实测会产生 CARIB-091326、NIA-489155 等并不存在的番号）。
 * 抽取前把 "_" 归一为 "-"：面板正则的分隔符类不含下划线。
 * 非字符串/空字段直接跳过，避免响应里的异常类型把同步整个打断。
 */
export function extractKeysFromItem(
	item: EmbyItemLike,
	regex?: string,
): string[] {
	const keys = new Set<string>();
	for (const field of [item.Name, item.FileName, item.Path]) {
		if (typeof field !== "string" || !field) continue;
		// regex 原样透传：抽取层已负责 trim，空白与非法模式都回退默认正则
		const { candidates } = extractCandidatesFromText(
			field.replace(/_/g, "-"),
			regex,
		);
		for (const candidate of candidates) {
			for (const key of keysForCode(candidate)) keys.add(key);
		}
	}
	return [...keys];
}

/** 把条目数组汇总成去重后的键集合 */
export function buildEmbyIndexKeys(
	items: EmbyItemLike[],
	regex?: string,
): string[] {
	const keys = new Set<string>();
	for (const item of items) {
		for (const key of extractKeysFromItem(item, regex)) keys.add(key);
	}
	return [...keys];
}
