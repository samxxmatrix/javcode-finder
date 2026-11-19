/**
 * 标题翻译的数据层：
 * 一级：任意 OpenAI 兼容 AI 服务（/v1/chat/completions，/v1/models 验活与拉模型）；
 * 二级：谷歌 / 微软公开翻译端点兜底。
 * URL/请求构造与响应解析均为纯函数，便于测试。
 */

export type TranslateTarget = "zh-CN" | "zh-TW" | "en";

/** 备用翻译服务：谷歌（默认）或微软 Edge 内置接口 */
export type FallbackService = "google" | "bing";

/** 错误文案短语表：按目标语言（界面为英文时翻译目标也为英文，故需英文文案） */
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
	en: {
		serviceError: "Translation service error",
		googleError: "Google Translate error",
		bingError: "Microsoft Translate error",
		timeout: "Request timed out",
		network: "Network connection failed",
		unknown: "Unknown error",
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
 * 拼接 OpenAI 兼容接口地址：base 尾斜杠归一化后接 /v1/... 路径。
 * 仅翻译（chat/completions）与健康（models）两类端点；AI 模式无字符配额，无用量端点。
 */
export function buildOpenAIUrl(
	base: string,
	path: "chat" | "models",
): string {
	const trimmed = (base || "").trim().replace(/\/+$/, "");
	const sub = path === "chat" ? "chat/completions" : "models";
	// 不少兼容服务（Ollama / LM Studio / 各类网关）要求地址填到 /v1；
	// 此时不再追加，避免拼出 /v1/v1/... 的无效路径。
	const prefix = /\/v1$/i.test(trimmed) ? "" : "/v1";
	return `${trimmed}${prefix}/${sub}`;
}

/**
 * 按目标语言生成翻译指令（system 提示词）。
 * 与 parseOpenAITranslation 的 JSON 数组契约强绑定：输入是 [短标题, 介绍] 的 JSON 数组，
 * 输出必须是等长、同序的 JSON 数组。两段各自独立成项，从根上杜绝"标题尾巴被并进介绍"。
 * 模型偶发会包 markdown 代码块或加前后缀，解析侧做兜底提取（见 parseJsonStringArray）。
 */
function buildTranslateSystemPrompt(target: TranslateTarget): string {
	switch (target) {
		case "en":
			return `You are a professional Japanese-to-English translator.

## Input
The user message is a JSON array of 1 or 2 Japanese text segments:
- 2 items: item 1 is a short title, item 2 is a longer description.
- 1 item: it is the full work title — translate it as a single segment (there is no separate title/description split).

## Output
Output ONLY a JSON array, one translated string per input item, in the same order and with exactly the same number of items.
- Never merge items or add new ones; translate each item independently.
- With a single input item, output an array with a single item.
- No text outside the JSON array: no "Translation:" prefix, no markdown code fence, no explanations.

## Content rules
- Keep line breaks inside each item (escape them as \\n in JSON); do not add or merge paragraphs.
- Keep alphanumeric product codes (e.g. IPX-118), studio names, and performer/actress names as-is. Never translate a person's name.
- Titles (short or full) are Japanese text to be translated, not code or proper nouns — never leave them untranslated.

Example input:
["夏の思い出", "これは作品の紹介文です。"]
Example output:
["Memories of Summer", "This is the description of the work."]`;
		case "zh-TW":
			return `你是一個專業的日譯繁體中文翻譯。

## 輸入
使用者訊息是一個 JSON 陣列，含 1 或 2 段日文文字：
- 2 項：第 1 項是短標題，第 2 項是介紹正文。
- 1 項：該項是作品完整標題，作為單段翻譯即可（沒有獨立的標題／介紹拆分）。

## 輸出
只輸出一個 JSON 陣列，每一項是對應輸入項的譯文，順序與數量必須與輸入完全一致。
- 不得合併項目或新增項目；每段獨立翻譯。
- 只有一項輸入時，輸出也只包含一項。
- JSON 陣列外不得有任何文字：不要「譯文：」前綴、不要 markdown 程式碼區塊、不要解釋。

## 內容規則
- 保留每段內部的換行（在 JSON 中以 \\n 轉義），不新增、不合併段落。
- 番號（如 IPX-118）、片商名、出演者／女優姓名保留原文，人名一律不翻譯。
- 標題（短標題或完整標題）是待翻譯的日文，不是程式碼或專有名詞，不得原樣保留。

範例輸入：
["夏の思い出", "これは作品の紹介文です。"]
範例輸出：
["夏日的回憶", "這是作品的介紹文。"]`;
		case "zh-CN":
		default:
			return `你是一个专业的日译简体中文翻译。

## 输入
用户消息是一个 JSON 数组，含 1 或 2 段日文文本：
- 2 项：第 1 项是短标题，第 2 项是介绍正文。
- 1 项：该项是作品完整标题，作为单段翻译即可（没有独立的标题／介绍拆分）。

## 输出
只输出一个 JSON 数组，每一项是对应输入项的译文，顺序与数量必须与输入严格一致。
- 不得合并项目或新增项目；每段独立翻译。
- 只有一项输入时，输出也只包含一项。
- JSON 数组外不得有任何文字：不要「译文：」前缀、不要 markdown 代码块、不要解释。

## 内容规则
- 保留每段内部的换行（在 JSON 中以 \\n 转义），不新增、不合并段落。
- 番号（如 IPX-118）、片商名、出演者姓名保留原文，人名一律不翻译。
- 标题（短标题或完整标题）是待翻译的日文，不是代码也不是专有名词，不得原样保留。

示例输入：
["夏の思い出", "これは作品の紹介文です。"]
示例输出：
["夏日的回忆", "这是作品的介绍文。"]`;
	}
}

/**
 * 构造 OpenAI 兼容翻译请求体（JSON 字符串）。
 * user content 是 [短标题, 介绍] 的 JSON 数组（单段时为一项），与兜底服务的数组协议统一；
 * system 提示词按目标语言要求模型回等长 JSON 数组。model 留空时省略，交由后端默认。
 */
export function buildOpenAIRequestBody(
	texts: string[],
	target: TranslateTarget,
	model: string,
): string {
	const body: {
		model?: string;
		temperature: number;
		messages: { role: "system" | "user"; content: string }[];
	} = {
		temperature: 0,
		messages: [
			{ role: "system", content: buildTranslateSystemPrompt(target) },
			{ role: "user", content: JSON.stringify(texts) },
		],
	};
	const trimmedModel = (model || "").trim();
	if (trimmedModel) body.model = trimmedModel;
	return JSON.stringify(body);
}

/**
 * 从模型输出里提取 JSON 字符串数组。
 * 模型偶发会包 ```json 代码块或在数组前后加说明文字，按「整体直解 → 代码块 → 首个 [..] 片段」
 * 逐级兜底；只有全部元素都是字符串时才接受（混入 null/对象说明协议没遵守，宁可降级）。
 */
function parseJsonStringArray(content: string): string[] {
	const candidates = [content.trim()];
	const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence?.[1]) candidates.push(fence[1].trim());
	const bracket = content.match(/\[[\s\S]*\]/);
	if (bracket?.[0]) candidates.push(bracket[0]);

	for (const candidate of candidates) {
		try {
			const parsed: unknown = JSON.parse(candidate);
			if (!Array.isArray(parsed)) continue;
			if (!parsed.every((item) => typeof item === "string")) continue;
			return parsed as string[];
		} catch {
			// 该候选不是合法 JSON，试下一个
		}
	}
	return [];
}

/**
 * 解析 OpenAI 兼容翻译响应：choices[0].message.content 里的 JSON 数组，按序返回逐段译文。
 * 失败或元素非字符串返回空数组（调用方按长度对齐后回退原文/降级）。
 */
export function parseOpenAITranslation(data: unknown): string[] {
	try {
		const parsed = data as {
			choices?: { message?: { content?: string } }[];
		};
		const content = parsed?.choices?.[0]?.message?.content;
		return typeof content === "string" ? parseJsonStringArray(content) : [];
	} catch {
		return [];
	}
}

/**
 * 解析 OpenAI 兼容 /v1/models 健康响应：{ object: "list" } 或含 data 数组即视为健康。
 */
export function parseOpenAIHealth(data: unknown): boolean {
	try {
		const parsed = data as { object?: string; data?: unknown };
		return parsed?.object === "list" || Array.isArray(parsed?.data);
	} catch {
		return false;
	}
}

/**
 * 解析 OpenAI 兼容 /v1/models 列表：取 data[].id。
 * 结构不符或非数组返回空数组（界面退回手填）。
 */
export function parseOpenAIModels(data: unknown): string[] {
	try {
		const parsed = data as { data?: { id?: string }[] };
		if (!Array.isArray(parsed?.data)) return [];
		return parsed.data
			.map((m) => (typeof m?.id === "string" ? m.id : ""))
			.filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * 格式化 OpenAI 兼容错误信息：优先取响应体的 error.message（OpenAI 标准结构，
 * 按原样显示），缺失时回退 HTTP 状态码。前缀与兜底短语按目标语言。
 */
export function formatOpenAIError(
	status: number,
	data: unknown,
	target: TranslateTarget,
): string {
	const phrases = ERROR_PHRASES[target];
	const parsed = (data ?? {}) as { error?: { message?: string } };
	let message: string;
	if (typeof parsed.error?.message === "string" && parsed.error.message) {
		message = parsed.error.message;
	} else if (status) {
		message = `HTTP ${status}`;
	} else {
		message = phrases.unknown;
	}
	return `${phrases.serviceError}：${message}`;
}

/**
 * 格式化 Worker 网络层错误（fetch 抛异常）：超时与一般网络失败区分文案，
 * 按目标语言生成；浏览器原始英文消息不直接展示。
 */
export function formatOpenAIFetchError(
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
 * 构造谷歌翻译 POST 表单体：每段文本各占一个 q 字段（q=短标题&q=介绍）。
 * 多 q 是 translate_a/t 的原生批量能力：两段独立翻译、返回顺序与 q 一致，
 * 从根上避免"标题尾巴被并进介绍"（单段拼接时谷歌/微软会跨段合并相似文本）。
 */
export function buildGoogleBody(texts: string[]): URLSearchParams {
	const body = new URLSearchParams();
	for (const text of texts) body.append("q", text);
	return body;
}

/**
 * 解析谷歌翻译响应：translate_a/t 对每个 q 返回一项 [译文, 检测语言]。
 * 逐项按序返回译文数组（与提交的多段一一对应），失败返回空数组。
 */
export function parseGoogleResponse(data: unknown): string[] {
	try {
		const root = data as unknown[];
		if (!Array.isArray(root)) return [];
		return root.map((seg) =>
			Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : "",
		);
	} catch {
		return [];
	}
}

/** 目标语言 → 微软 BCP-47 码：简体 zh-Hans、繁体 zh-Hant、英文 en */
export function targetToBingLang(target: TranslateTarget): string {
	if (target === "en") return "en";
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
 * 构造微软翻译请求体：字符串数组即批量翻译，每段独立、返回顺序一一对应。
 * 两段分开发（短标题 + 介绍）避免跨段合并；无需 <code>/<span> 标记。
 */
export function buildBingBody(texts: string[]): string {
	return JSON.stringify(texts);
}

/**
 * 解析微软翻译响应：[{translations:[{text}]}, ...] 按段取译文。
 * 逐项按序返回译文数组（与提交的多段一一对应），失败返回空数组。
 */
export function parseBingResponse(data: unknown): string[] {
	try {
		const root = data as unknown[];
		if (!Array.isArray(root)) return [];
		return root.map((item) => {
			const entry = item as { translations?: { text?: unknown }[] } | undefined;
			const text = entry?.translations?.[0]?.text;
			return typeof text === "string" ? text : "";
		});
	} catch {
		return [];
	}
}

/** 格式化微软翻译 HTTP 错误：与 formatOpenAIError 的前缀区分，按目标语言 */
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
