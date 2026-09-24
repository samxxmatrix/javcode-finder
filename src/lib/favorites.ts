/**
 * 番号收藏的数据层：本地存储、云端 JSON 序列化、WebDAV 请求构造。
 * 全部为纯函数，便于测试；网络请求在 background 执行。
 */

/** browser.storage.local 中收藏列表的 key */
export const FAVORITES_STORAGE_KEY = "favorites";

/** 云端收藏文件名 */
export const FAVORITES_FILE_NAME = "favorites.json";

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
 */
export function joinWebdavUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/${FAVORITES_FILE_NAME}`;
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
