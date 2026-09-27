/**
 * 标题翻译的数据层：
 * 一级：自建 DeepL Worker（Bearer + JSON，见 docs/deepl-translate-api接口文档.md）；
 * 二级：谷歌翻译 gtx 公开端点兜底。
 * URL/请求构造与响应解析均为纯函数，便于测试。
 */

export type TranslateTarget = "zh-CN" | "zh-TW";

/** 备用翻译服务：谷歌（默认）或微软 Edge 内置接口 */
export type FallbackService = "google" | "bing";

/** 错误文案短语表：按目标语言（英文界面不发起翻译请求，无需英文文案） */
const ERROR_PHRASES = {
	"zh-CN": {
		serviceError: "翻译服务错误",
		googleError: "谷歌翻译错误",
		bingError: "微软翻译错误",
		timeout: "请求超时",
		network: "网络连接失败",
		unknown: "未知错误",
	},
	"zh-TW": {
		serviceError: "翻譯服務錯誤",
		googleError: "谷歌翻譯錯誤",
		bingError: "微軟翻譯錯誤",
		timeout: "請求超時",
		network: "網路連線失敗",
		unknown: "未知錯誤",
	},
} as const;

/**
 * 网络层错误统一文案：浏览器原始 message（如 Failed to fetch）是英文系统
 * 消息，不直接展示给用户；超时与一般网络失败区分短语。
 */
export function formatFetchErrorMessage(
	error: unknown,
	target: TranslateTarget,
): string {
	const phrases = ERROR_PHRASES[target];
	if (error instanceof Error && error.name === "TimeoutError") {
		return phrases.timeout;
	}
	return phrases.network;
}

/** 谷歌翻译 gtx 公开端点（POST 表单；translate_a/single 已被风控封禁，t 端点仍可用） */
export const GOOGLE_TRANSLATE_URL =
	"https://translate.googleapis.com/translate_a/t";

/** 微软 Edge 内置翻译端点（无认证；参数校验严格，语言码需 BCP-47） */
export const BING_TRANSLATE_URL =
	"https://edge.microsoft.com/translate/translatetext";

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
 * <code> 保护标记保留原样，由 splitMergedTranslation 直接拆分。
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
 * 格式化 Worker 错误信息：优先取响应体的 code（错误码）与 error（服务端文案，
 * 按原样显示），缺失时回退 HTTP 状态码。前缀与兜底短语按目标语言。
 */
export function formatWorkerError(
	status: number,
	data: unknown,
	target: TranslateTarget,
): string {
	const phrases = ERROR_PHRASES[target];
	const parsed = (data ?? {}) as { code?: string; error?: string };
	const code =
		typeof parsed.code === "string" && parsed.code ? ` [${parsed.code}]` : "";
	let message: string;
	if (typeof parsed.error === "string" && parsed.error) {
		message = parsed.error;
	} else if (status) {
		message = `HTTP ${status}`;
	} else {
		message = phrases.unknown;
	}
	return `${phrases.serviceError}${code}：${message}`;
}

/**
 * 拼装"短标题+长标题"一次翻译：短标题用 <code> 标签包裹置于首行。
 * 不用花括号的原因：微软翻译对长短标题会吃掉结尾 "}"（MCSR-642 实测），
 * <code> 标签在三家服务（DeepL Worker/谷歌/微软）均实测原样保留，
 * 拆分直接按标签定位（splitMergedTranslation），不做还原转换。
 */
export function buildMergedTranslateText(
	shortTitle: string,
	longTitle: string,
): string {
	return `<code>${shortTitle}</code>\n${longTitle}`;
}

export interface SplitTranslation {
	// 短标题译文；标记被翻译器改写导致拆不出时为 null
	short: string | null;
	// 长标题译文（拆不出时即整段译文）
	long: string;
}

/**
 * 拆分拼装翻译结果：<code>短标题</code>\n长标题 → 短标题译文 + 长标题译文。
 * 标记不一定在行首：翻译器可能把修饰词移到标签外（微软实测把量词提到
 * <code> 前，谷歌实测在 <code> 后插空格），前导文本并入短标题、译文 trim。
 * 兼容实体化标签与花括号（翻译器改写标记时的兜底）；
 * 拆不出（标记被吃掉/只有短标题无后续）时整体视为长标题。
 */
export function splitMergedTranslation(text: string): SplitTranslation {
	const m = text.match(
		/^([\s\S]*?)(?:<code>|&lt;code&gt;|[{｛])([\s\S]*?)(?:<\/code>|&lt;\/code&gt;|[}｝])\s*\n?([\s\S]*)$/,
	);
	if (!m) return { short: null, long: text };
	const short = ((m[1] ?? "") + (m[2] ?? "")).trim();
	const long = m[3] || text;
	if (!short || long === text) {
		return { short: null, long: text };
	}
	return { short, long };
}

/**
 * 格式化 Worker 网络层错误（fetch 抛异常）：超时与一般网络失败区分文案，
 * 按目标语言生成；浏览器原始英文消息不直接展示。
 */
export function formatWorkerFetchError(
	error: unknown,
	target: TranslateTarget,
): string {
	return `${ERROR_PHRASES[target].serviceError}：${formatFetchErrorMessage(error, target)}`;
}

/**
 * 构造谷歌翻译 POST 请求 URL（q 由 buildGoogleBody 走表单体携带）。
 * 目标语言：简体 zh-CN、繁体 zh-TW（与 Worker 的 ZH/ZH-HANT 映射不同）。
 */
export function buildGooglePostUrl(target: TranslateTarget): string {
	const params = new URLSearchParams();
	params.set("client", "gtx");
	params.set("sl", "auto");
	params.set("tl", target);
	params.set("dt", "t");
	return `${GOOGLE_TRANSLATE_URL}?${params.toString()}`;
}

/**
 * 构造谷歌翻译 POST 表单体：文本放在 q 字段。
 */
export function buildGoogleBody(text: string): URLSearchParams {
	return new URLSearchParams({ q: text });
}

/**
 * 构造验证窗口用的 GET URL（带 q）：被谷歌风控（403/429）时在浏览器打开该
 * URL 会触发验证页，用户验证后关闭窗口自动重试翻译。
 */
export function buildGoogleVerifyUrl(
	text: string,
	target: TranslateTarget,
): string {
	return `${buildGooglePostUrl(target)}&q=${encodeURIComponent(text)}`;
}

/**
 * 解析谷歌翻译响应：translate_a/t 返回扁平 [译文, 检测语言] 对数组。
 * 拼接所有译文；失败返回空字符串（调用方回退原文）。
 * <code> 保护标记保留原样，由 splitMergedTranslation 直接拆分。
 */
export function parseGoogleResponse(data: unknown): string {
	try {
		const root = data as unknown[];
		if (!Array.isArray(root)) return "";
		return root
			.map((seg) =>
				Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : "",
			)
			.join("");
	} catch {
		return "";
	}
}

/** 目标语言 → 微软 BCP-47 码：简体 zh-Hans、繁体 zh-Hant */
export function targetToBingLang(target: TranslateTarget): string {
	return target === "zh-TW" ? "zh-Hant" : "zh-Hans";
}

/**
 * 构造微软翻译请求 URL：源语言留空走接口自带检测（响应带 detectedLanguage）。
 */
export function buildBingUrl(target: TranslateTarget): string {
	const params = new URLSearchParams();
	params.set("from", "");
	params.set("to", targetToBingLang(target));
	params.set("isEnterpriseClient", "false");
	return `${BING_TRANSLATE_URL}?${params.toString()}`;
}

/**
 * 构造微软翻译请求体：纯字符串数组（JSON.stringify 保证合法转义）。
 * 标记保护统一由 buildMergedTranslateText 用 <code> 标签完成，此函数无需再处理。
 */
export function buildBingBody(text: string): string {
	return JSON.stringify([text]);
}

/**
 * 解析微软翻译响应：[{translations:[{text}]}] 取第一条译文，
 * <code> 保护标记保留原样，由 splitMergedTranslation 直接拆分。
 */
export function parseBingResponse(data: unknown): string {
	try {
		const root = data as unknown[];
		const first = root?.[0] as
			| { translations?: { text?: unknown }[] }
			| undefined;
		const text = first?.translations?.[0]?.text;
		return typeof text === "string" ? text : "";
	} catch {
		return "";
	}
}

/** 格式化微软翻译 HTTP 错误：与 formatWorkerError 的前缀区分，按目标语言 */
export function formatBingError(status: number, target: TranslateTarget): string {
	return `${ERROR_PHRASES[target].bingError}：HTTP ${status}`;
}

/** 格式化微软翻译网络层错误（fetch 抛异常），按目标语言 */
export function formatBingFetchError(
	error: unknown,
	target: TranslateTarget,
): string {
	return `${ERROR_PHRASES[target].bingError}：${formatFetchErrorMessage(error, target)}`;
}

/** 格式化谷歌翻译 HTTP 错误（不含 403/429 验证场景），按目标语言 */
export function formatGoogleError(
	status: number,
	target: TranslateTarget,
): string {
	return `${ERROR_PHRASES[target].googleError}：HTTP ${status}`;
}

/** 格式化谷歌翻译网络层错误（fetch 抛异常），按目标语言 */
export function formatGoogleFetchError(
	error: unknown,
	target: TranslateTarget,
): string {
	return `${ERROR_PHRASES[target].googleError}：${formatFetchErrorMessage(error, target)}`;
}
