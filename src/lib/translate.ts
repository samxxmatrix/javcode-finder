/**
 * 标题翻译的数据层：DeepL API（Free 计划端点 api-free.deepl.com）。
 * URL/请求构造与响应解析均为纯函数，便于测试。
 */

export type TranslateTarget = "zh-CN" | "zh-TW";

/** DeepL Free 计划端点 */
export const DEEPL_API_URL = "https://api-free.deepl.com/v2/translate";

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
