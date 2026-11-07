/**
 * 番号收藏的数据层：本地 localStorage、云端 JSON 序列化、WebDAV 请求构造。
 * 全部为纯函数，便于测试；网络请求在 background 执行。
 */

import { matchEmbyCodes } from "./emby";
import { normalizeCode } from "./normalize-code";

/** localStorage 中收藏列表的 key（与设置同源存储，保证所有扩展页面可读） */
export const FAVORITES_STORAGE_KEY = "favorites";

/** 云端收藏文件名 */
export const FAVORITES_FILE_NAME = "favorites.json";

/** 云端配置文件名（与收藏分文件存放：两类数据写入节奏与体积完全不同） */
export const SETTINGS_FILE_NAME = "settings.json";

/**
 * 解析本地存储的收藏 JSON（纯 string[] 数组）。
 * null、非法 JSON、非数组一律返回空列表。
 */
export function parseStoredFavorites(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((c): c is string => typeof c === "string")
			: [];
	} catch {
		return [];
	}
}

/** 从 localStorage 读取收藏；存储不可用返回空列表 */
export function loadFavorites(storage: Storage | null): string[] {
	if (!storage) return [];
	return parseStoredFavorites(storage.getItem(FAVORITES_STORAGE_KEY));
}

/**
 * 保存收藏到 localStorage。
 * 失败（存储不可用/配额）返回 false，调用方仅保留内存状态。
 */
export function saveFavorites(storage: Storage | null, codes: string[]): boolean {
	if (!storage) return false;
	try {
		storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(codes));
		return true;
	} catch {
		return false;
	}
}

/**
 * 切换收藏状态：已存在则移除，不存在则追加。
 */
export function toggleFavorite(codes: string[], code: string): string[] {
	return codes.includes(code)
		? codes.filter((c) => c !== code)
		: [...codes, code];
}

/** 是否已收藏 */
export function isFavorite(codes: string[], code: string): boolean {
	return codes.includes(code);
}

/**
 * 按「是否已在 Emby 库中」把收藏拆成两份：保留 / 删除。
 *
 * 命中判定完全交给 `matchEmbyCodes`（与徽标同一套键口径），绝不在这里另写一套比较，
 * 否则日期型番号的精确键容易再次漂移（`103126_01` vs `103126-001`，见 CHANGELOG 2.4.1）。
 *
 * ⚠️ 安全闸：`libraryKeys` 为空集合时一律视为「没有可用索引」，全部保留。
 * 空索引可能来自未同步 / 同步失败 / 换服务器后的失效索引，若照常匹配，
 * 调用方会把整份收藏删光且不可恢复 —— 宁可什么都不删。
 *
 * @param favorites 本地收藏（原样顺序，未归一化，可能含大写/分隔符差异）
 * @param libraryKeys Emby 索引键集合（`EmbyIndex.keys`）
 * @returns kept 保持入参顺序；removed 为命中的归一化番号（去重、按首次命中顺序）
 */
export function splitFavoritesByLibrary(
	favorites: string[],
	libraryKeys: Iterable<string>,
): { kept: string[]; removed: string[] } {
	const keys = libraryKeys instanceof Set ? libraryKeys : new Set(libraryKeys);
	if (keys.size === 0) {
		return { kept: [...favorites], removed: [] };
	}
	const matched = matchEmbyCodes(keys, favorites);
	const kept: string[] = [];
	const removed: string[] = [];
	const removedSeen = new Set<string>();
	for (const code of favorites) {
		const normalized = normalizeCode(code);
		if (normalized && matched.has(normalized)) {
			// 同一番号可能以不同写法重复收藏，删除清单只报一次
			if (!removedSeen.has(normalized)) {
				removedSeen.add(normalized);
				removed.push(normalized);
			}
			continue;
		}
		kept.push(code);
	}
	return { kept, removed };
}

/**
 * 收藏夹视图的展示顺序：存储是追加顺序（旧 → 新），视图取倒序（新 → 旧）。
 * 返回新数组，不改动入参，便于在 React 中稳定使用。
 */
export function orderFavoritesForView(codes: string[]): string[] {
	return [...codes].reverse();
}

/**
 * 序列化为云端文件内容：{ version: 1, codes: [...] }。
 * version 用于将来格式变更时的迁移判断。
 */
export function serializeFavorites(codes: string[]): string {
	return JSON.stringify({ version: 1, codes });
}

/**
 * 解析云端文件内容，非法结构返回空列表（视为云端无数据）。
 */
export function parseFavorites(data: unknown): string[] {
	try {
		const codes = (data as { codes?: unknown } | null)?.codes;
		if (!Array.isArray(codes)) return [];
		return codes.filter((c): c is string => typeof c === "string");
	} catch {
		return [];
	}
}

/**
 * 拼接云端文件完整 URL：目录末尾统一补单个 "/" 再拼文件名，
 * 避免用户填地址时斜杠多少不一致导致 404。
 * fileName 省略时取收藏文件名，保持原有调用点的语义不变。
 */
export function joinWebdavUrl(
	baseUrl: string,
	fileName: string = FAVORITES_FILE_NAME,
): string {
	return `${baseUrl.replace(/\/+$/, "")}/${fileName}`;
}

/**
 * 构造 HTTP Basic Auth 头：凭据按 UTF-8 编码后 base64，
 * 用户名/密码含非 ASCII 字符时不会产生乱码。
 */
export function buildBasicAuth(user: string, pass: string): string {
	const bytes = new TextEncoder().encode(`${user}:${pass}`);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return `Basic ${btoa(binary)}`;
}

export type WebdavVerifyResult =
	| "ok"
	| "auth"
	| "not_found"
	| "rate_limited"
	| "failed";

/**
 * 云端连接验证（PROPFIND Depth:0）的 HTTP 状态分类。
 * status 为 0 表示网络错误（fetch 抛异常）。
 */
export function classifyWebdavVerify(status: number): WebdavVerifyResult {
	if (status === 207) return "ok";
	if (status === 401) return "auth";
	if (status === 404) return "not_found";
	if (status === 403 || status === 429) return "rate_limited";
	return "failed";
}
