/**
 * 标题翻译的数据层：
 * 一级：自建 DeepL Worker（Bearer + JSON，见 docs/deepl-translate-api接口文档.txt）；
 * 二级：谷歌翻译 gtx 公开端点兜底。
 * URL/请求构造与响应解析均为纯函数，便于测试。
 */

export type TranslateTarget = "zh-CN" | "zh-TW";

/** 谷歌翻译无 key 公开端点（client=gtx） */
export const GOOGLE_TRANSLATE_URL =
	"https://translate.googleapis.com/translate_a/single";

/**
 * 拼接 Worker 接口地址：base 尾斜杠归一化后接路径。
 */
export function buildWorkerUrl(
	base: string,
	path: "translate" | "health" | "usage",
): string {
	const trimmed = (base || "").trim().replace(/\/+$/, "");
	return `${trimmed}/${path}`;
}

/**
 * 构造 Worker 翻译请求体（JSON 字符串）。
 * 目标语言：简体 ZH、繁体 ZH-HANT。
 */
export function buildWorkerTranslateBody(
	text: string,
	target: TranslateTarget,
): string {
	return JSON.stringify({
		text,
		target_lang: target === "zh-TW" ? "ZH-HANT" : "ZH",
	});
}

/**
 * 解析 Worker 翻译响应：{ success: true, translation: "..." }
 * 失败或结构不符返回空字符串（调用方回退原文/降级）。
 */
export function parseWorkerTranslation(data: unknown): string {
	try {
		const parsed = data as { success?: boolean; translation?: string };
		if (!parsed?.success) return "";
		return typeof parsed.translation === "string" ? parsed.translation : "";
	} catch {
		return "";
	}
}

/**
 * 解析 Worker 健康检查响应：{ success: true, status: "ok" }
 */
export function parseWorkerHealth(data: unknown): boolean {
	try {
		const parsed = data as { success?: boolean; status?: string };
		return parsed?.success === true && parsed.status === "ok";
	} catch {
		return false;
	}
}

/**
 * 解析 Worker 用量响应：{ success, usage: { character_count, character_limit } }
 * 字段缺失、非数字或负数返回 null（调用方显示 "--/--万"）。
 */
export function parseWorkerUsage(
	data: unknown,
): { count: number; limit: number } | null {
	try {
		const usage = (data as { success?: boolean; usage?: unknown })?.usage as
			| { character_count?: unknown; character_limit?: unknown }
			| undefined;
		const count = usage?.character_count;
		const limit = usage?.character_limit;
		if (
			typeof count !== "number" ||
			!Number.isFinite(count) ||
			count < 0 ||
			typeof limit !== "number" ||
			!Number.isFinite(limit) ||
			limit <= 0
		) {
			return null;
		}
		return { count, limit };
	} catch {
		return null;
	}
}

/**
 * 格式化用量为 "x.xxxx/yy万"：字符数换算成万（÷10000）。
 * 基数由接口提供；count/limit 缺失或非法时返回 "--/--万"。
 */
export function formatUsage(
	count: number | null,
	limit: number | null,
): string {
	if (
		count === null ||
		limit === null ||
		!Number.isFinite(count) ||
		!Number.isFinite(limit) ||
		limit <= 0
	) {
		return "--/--万";
	}
	return `${(count / 10000).toFixed(4)}/${(limit / 10000).toFixed(0)}万`;
}

/**
 * 构造谷歌翻译 gtx 请求 URL。
 * 目标语言：简体 zh-CN、繁体 zh-TW（与 Worker 的 ZH/ZH-HANT 映射不同）。
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
