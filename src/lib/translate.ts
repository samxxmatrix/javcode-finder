/**
 * 谷歌翻译非官方公开端点（client=gtx）的 URL 构造与响应解析。
 * 该端点无官方 SLA，失败时调用方回退原文。
 */

export type TranslateTarget = "zh-CN" | "zh-TW";

/**
 * 构造翻译请求 URL。tl 按界面语言区分：简体 → zh-CN，繁体 → zh-TW。
 */
export function buildTranslateUrl(text: string, target: TranslateTarget): string {
	return (
		"https://translate.googleapis.com/translate_a/single" +
		`?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`
	);
}

/**
 * 解析 translate_a/single 响应：拼接所有译文片段。
 * 响应结构：[[["译文片段","原文",...], ...], ...]
 * 解析失败返回空字符串（调用方回退原文）。
 */
export function parseTranslateResponse(data: unknown): string {
	try {
		const segments = (data as unknown[])?.[0];
		if (!Array.isArray(segments)) return "";
		return segments
			.map((seg) => (Array.isArray(seg) ? String(seg[0] ?? "") : ""))
			.join("");
	} catch {
		return "";
	}
}
