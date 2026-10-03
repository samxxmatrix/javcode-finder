import { MAX_CANDIDATE_LENGTH, extractCandidatesFromText } from "./extract-codes";
import { normalizeCode, toComparisonKey } from "./normalize-code";
import { DEFAULT_CODE_REGEX } from "./settings";

/**
 * Emby 媒体库「已在库」判定的纯逻辑层。
 * 本轮：地址规范化、条目查询 URL 构造、响应解析、索引键生成、
 * 候选匹配、TTL/增量/全量判定与指纹。
 * 判定同时校验服务器+Key 指纹：换地址或换 Key 后旧索引立即失效，
 * 不会拿旧库的键渲染已经在库徽标。
 * 后续任务在此模块之外实现：后台同步与面板消费。
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
 * 抽取单个条目上的全部键（keyA/keyB，跨字段去重后）。
 * 必须逐字段跑正则再合并：把多字段拼成一个大串会在边界造出伪键
 * （实测会产生 CARIB-091326、NIA-489155 等并不存在的番号）。
 * 抽取前把 "_" 归一为 "-"：面板正则的分隔符类不含下划线。
 * 注意该改写发生在跑正则之前，因此自定义正则里含 "_" 的写法永远匹配不到
 * （例如 `[A-Z]{3}_\d{3}` 对 "ABC_123" 返回 []）。
 * 非字符串/空字段直接跳过、null 条目返回空数组，
 * 避免响应里的异常类型把同步整个打断。
 */
export function extractKeysFromItem(
	item: EmbyItemLike,
	regex?: string,
): string[] {
	if (!item) return [];
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

export interface EmbyIndex {
	v: 1;
	/** 服务器+Key 指纹：变化即索引失效 */
	serverKey: string;
	/** 生效正则的指纹：变化即重建，避免键口径漂移 */
	regexKey: string;
	/** 最近一次成功同步时间 */
	syncedAt: number;
	/** 参与索引的条目数 */
	total: number;
	/** keyA + keyB 合并去重 */
	keys: string[];
}

/** FNV-1a 32 位哈希（仅用于指纹，不做加密用途） */
export function fingerprint(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/**
 * 服务器+Key 指纹（地址先规范化，尾斜杠/路径不影响）。
 * 地址或 Key 为空返回空串（fail closed）：未配置时不得产出可用指纹，
 * 否则空指纹会与空索引互相"匹配"。
 */
export function embyServerKey(baseUrl: string, apiKey: string): string {
	const base = normalizeEmbyBaseUrl(baseUrl);
	const key = (apiKey || "").trim();
	if (!base || !key) return "";
	return fingerprint(`${base}\n${key}`);
}

/**
 * 生效正则指纹：与抽取层保持同一回退口径，
 * 空值/纯空白或语法非法都回退默认正则，避免把无效模式当成生效模式。
 */
export function embyRegexKey(pattern: string): string {
	let active = (pattern || "").trim() || DEFAULT_CODE_REGEX;
	try {
		new RegExp(active);
	} catch {
		active = DEFAULT_CODE_REGEX;
	}
	return fingerprint(active);
}

/**
 * 候选匹配：任一候选键（keyA/keyB）命中索引即视为在库。
 * 返回命中番号的归一化形式（与 CodeList 的 uniqueCodes 一致）。
 */
export function matchEmbyCodes(
	keys: Iterable<string>,
	codes: string[],
): Set<string> {
	const index = keys instanceof Set ? keys : new Set(keys);
	const matched = new Set<string>();
	for (const code of codes) {
		const normalized = normalizeCode(code);
		if (!normalized) continue;
		for (const key of keysForCode(normalized)) {
			if (index.has(key)) {
				matched.add(normalized);
				break;
			}
		}
	}
	return matched;
}

/**
 * 索引是否可直接复用：存在、服务器+Key 指纹一致、正则指纹一致、
 * 年龄合法（非负有限）且未超过 TTL。
 * 年龄为 NaN/Infinity 或为负（时钟回拨/未来时间戳）一律判为不新鲜。
 */
export function isEmbyIndexFresh(
	index: EmbyIndex | null,
	now: number,
	serverKey: string,
	regexKey: string,
): boolean {
	if (!index) return false;
	if (index.serverKey !== serverKey) return false;
	if (index.regexKey !== regexKey) return false;
	const age = now - index.syncedAt;
	if (!Number.isFinite(age) || age < 0) return false;
	return age < EMBY_INDEX_TTL_MS;
}

/**
 * 是否需要全量重建索引：缺失、服务器+Key 或正则指纹变化、
 * 年龄非法（NaN/Infinity/负数）或超过 24 小时校准周期。
 */
export function needsEmbyFullSync(
	index: EmbyIndex | null,
	now: number,
	serverKey: string,
	regexKey: string,
): boolean {
	if (!index) return true;
	if (index.serverKey !== serverKey) return true;
	if (index.regexKey !== regexKey) return true;
	const age = now - index.syncedAt;
	if (!Number.isFinite(age) || age < 0) return true;
	return age >= EMBY_FULL_SYNC_INTERVAL_MS;
}

/**
 * 增量查询起点：上次同步时间 − 重叠窗（容忍客户端时钟超前服务器）。
 * 时间非有限值（NaN/Infinity）或落在 Date 可表示范围之外时返回空串，
 * 让 URL 省略 MinDateLastSaved，退化为一次全量拉取以修复索引，
 * 而不是在增量路径上反复抛 RangeError。
 */
export function incrementalSince(syncedAt: number): string {
	const since = syncedAt - EMBY_SYNC_OVERLAP_MS;
	if (!Number.isFinite(since)) return "";
	const date = new Date(since);
	if (Number.isNaN(date.getTime())) return "";
	return date.toISOString();
}

/** 逐条兜底命中的复核：条目上抽出的键必须与候选键相交 */
export function verifyEmbySearchItems(
	items: EmbyItemLike[],
	code: string,
	regex?: string,
): boolean {
	const wanted = new Set(keysForCode(code));
	if (wanted.size === 0) return false;
	for (const item of items) {
		for (const key of extractKeysFromItem(item, regex)) {
			if (wanted.has(key)) return true;
		}
	}
	return false;
}
