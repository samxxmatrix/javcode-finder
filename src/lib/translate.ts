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
 * 与 splitMergedTranslation 的 <code> 拆分契约强绑定：模型若移动/删改标签，或把标签内
 * 当作代码原样保留，标题就会串进介绍，故用显式规则 + 示例锁定输出结构。
 * 借鉴通用翻译提示词的「禁止前缀」「保持段落」规则，但不引入 %% 等其它分隔符协议。
 */
function buildTranslateSystemPrompt(target: TranslateTarget): string {
	switch (target) {
		case "en":
			return `You are a professional Japanese-to-English translator. Translate the user's Japanese input into English.

## Tag rules (strict)
The first line is a short title wrapped in <code>…</code>, followed by a newline and the description text.
- The text inside <code> is a Japanese title to be translated. It is NOT code or a proper noun; never leave it untranslated.
- Keep <code> and </code> exactly as they are, in the same position. Do not move, remove, rewrite, escape, or translate the tags themselves.
- Keep the newline after the tag. Never merge the translated title and description into one paragraph.

## Content rules
- Preserve the original paragraph count and line breaks; do not add or merge paragraphs.
- Keep alphanumeric product codes (e.g. IPX-118), studio names, and performer/actress names in their original form. Never translate a person's name.
- Do not add any extra markers or separators.

## Output
Output only the translation. No prefixes such as "Translation:" or "Here's the translation:", no explanations, notes, or any extra text.

Example input:
<code>夏の思い出</code>
これは作品の紹介文です。
Example output:
<code>Memories of Summer</code>
This is the description of the work.`;
		case "zh-TW":
			return `你是一個專業的日譯繁體中文翻譯，將使用者輸入的日文翻譯為繁體中文。

## 標記規則（必須嚴格遵守）
輸入首行是 <code>短標題</code>，換行後是介紹文字。
- <code> 內是待翻譯的日文標題，必須翻譯；它不是程式碼，也不是專有名詞，不得原樣保留。
- <code> 與 </code> 必須原樣保留且位置不變，不得移動、刪除、改寫、跳脫或翻譯標籤本身。
- 保留標籤後的換行，標題譯文與介紹譯文不得合併成一段。

## 內容規則
- 保持原文的段落數與換行結構，不新增、不合併段落。
- 番號（如 IPX-118）、片商名、出演者／女優姓名等專有名詞保留原文寫法，人名一律不翻譯。
- 不加入任何額外標記或分隔符號。

## 輸出
只輸出譯文。不要輸出「譯文：」「Here's the translation:」等前綴，也不要解釋、註解或任何額外文字。

範例輸入：
<code>夏の思い出</code>
これは作品の紹介文です。
範例輸出：
<code>夏日的回憶</code>
這是作品的介紹文。`;
		case "zh-CN":
		default:
			return `你是一个专业的日译简体中文翻译，将用户输入的日文翻译为简体中文。

## 标记规则（必须严格遵守）
输入首行是 <code>短标题</code>，换行后是介绍文本。
- <code> 内是待翻译的日文标题，必须翻译；它不是代码，也不是专有名词，不得原样保留。
- <code> 与 </code> 必须原样保留且位置不变，不得移动、删除、改写、转义或翻译标签本身。
- 保留标签后的换行，标题译文与介绍译文不得合并成一段。

## 内容规则
- 保持原文的段落数与换行结构，不新增、不合并段落。
- 番号（如 IPX-118）、片商名、出演者姓名等专有名词保留原文写法，人名一律不翻译。
- 不添加任何额外标记或分隔符。

## 输出
只输出译文。不要输出「译文：」「Here's the translation:」等前缀，也不要解释、注释或任何额外文字。

示例输入：
<code>夏の思い出</code>
これは作品の紹介文です。
示例输出：
<code>夏日的回忆</code>
这是作品的介绍文。`;
	}
}

/**
 * 构造 OpenAI 兼容翻译请求体（JSON 字符串）。
 * 一级提示词（system）按目标语言给出翻译指令；用户文本含 <code> 保护标记。
 * model 留空时整字段省略，交由后端使用默认模型。
 */
export function buildOpenAIRequestBody(
	text: string,
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
			{ role: "user", content: text },
		],
	};
	const trimmedModel = (model || "").trim();
	if (trimmedModel) body.model = trimmedModel;
	return JSON.stringify(body);
}

/**
 * 解析 OpenAI 兼容翻译响应：choices[0].message.content。
 * 失败或结构不符返回空字符串（调用方回退原文/降级）。
 * <code> 保护标记保留原样，由 splitMergedTranslation 直接拆分。
 */
export function parseOpenAITranslation(data: unknown): string {
	try {
		const parsed = data as {
			choices?: { message?: { content?: string } }[];
		};
		const content = parsed?.choices?.[0]?.message?.content;
		return typeof content === "string" ? content : "";
	} catch {
		return "";
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
 * 拼装"标题+介绍"一次翻译：标题用 <code> 标签包裹置于首行。
 * 不用花括号的原因：微软翻译对标题与介绍会吃掉结尾 "}"（MCSR-642 实测），
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
	// 标题译文；标记被翻译器改写导致拆不出时为 null
	short: string | null;
	// 介绍译文（拆不出时即整段译文）
	long: string;
}

/**
 * 拆分拼装翻译结果：<code>标题</code>\n介绍 → 标题译文 + 介绍译文。
 * 标记不一定在行首：翻译器可能把修饰词移到标签外（微软实测把量词提到
 * <code> 前，谷歌实测在 <code> 后插空格），前导文本并入标题、译文 trim。
 * 兼容实体化标签与花括号（翻译器改写标记时的兜底）；
 * 拆不出（标记被吃掉/只有标题无后续）时整体视为介绍。
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
