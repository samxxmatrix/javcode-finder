/**
 * 标题翻译的数据层：DeepL API（Free 计划端点 api-free.deepl.com）。
 * URL/请求构造与响应解析均为纯函数，便于测试。
 */

export type TranslateTarget = "zh-CN" | "zh-TW";

/** DeepL Free 计划端点 */
export const DEEPL_API_URL = "https://api-free.deepl.com/v2/translate";

/** DeepL 用量查询端点（仅 GET，与翻译接口同主机） */
export const DEEPL_USAGE_URL = "https://api-free.deepl.com/v2/usage";

/** 谷歌翻译无 key 公开端点（client=gtx） */
export const GOOGLE_TRANSLATE_URL =
	"https://translate.googleapis.com/translate_a/single";

/**
 * 构造谷歌翻译 gtx 请求 URL。
 * 目标语言：简体 zh-CN、繁体 zh-TW（与 DeepL 的 ZH/ZH-HANT 映射不同）。
 */
export function buildGoogleUrl(text: string, target: TranslateTarget): string {
	const params = new URLSearchParams();
	params.set("client", "gtx");
	params.set("sl", "auto");
	params.set("tl", target);
	params.set("dt", "t");
	params.set("q", text);
	return `${GOOGLE_TRANSLATE_URL}?${params.toString()}`;
}

/**
 * 解析谷歌翻译响应：[[["译文", ...], ...], null, "en", ...]。
 * 拼接所有分段译文；失败返回空字符串（调用方回退原文）。
 */
export function parseGoogleResponse(data: unknown): string {
	try {
		const root = data as unknown[];
		const segments = root?.[0];
		if (!Array.isArray(segments)) return "";
		return segments
			.map((seg) =>
				Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : "",
			)
			.join("");
	} catch {
		return "";
	}
}

/**
 * DeepL 请求体（application/x-www-form-urlencoded）。
 * 目标语言：简体 ZH、繁体 ZH-HANT。
 */
export function buildDeepLBody(
	text: string,
	target: TranslateTarget,
): URLSearchParams {
	const body = new URLSearchParams();
	body.set("text", text);
	body.set("target_lang", target === "zh-TW" ? "ZH-HANT" : "ZH");
	return body;
}

/**
 * 解析 DeepL 响应：{ translations: [{ text }] }
 * 失败返回空字符串（调用方回退原文）。
 */
export function parseDeepLResponse(data: unknown): string {
	try {
		const translations = (data as { translations?: Array<{ text?: string }> })
			?.translations;
		return translations?.[0]?.text ?? "";
	} catch {
		return "";
	}
}

/**
 * 解析用量响应：{ character_count: number }。
 * 字段缺失、非数字或负数返回 null（调用方显示 "--"）。
 */
export function parseDeepLUsage(data: unknown): number | null {
	try {
		const count = (data as { character_count?: unknown } | null)
			?.character_count;
		return typeof count === "number" && Number.isFinite(count) && count >= 0
			? count
			: null;
	} catch {
		return null;
	}
}

/**
 * 格式化用量为 "x.xxxx/100万"：字符数换算成万（÷10000）保留 4 位小数。
 * count 为 null 或非有限数时返回 "--/100万"。
 */
export function formatUsage(count: number | null): string {
	if (count === null || !Number.isFinite(count)) return "--/100万";
	return `${(count / 10000).toFixed(4)}/100万`;
}
