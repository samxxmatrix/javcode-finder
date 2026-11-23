import { describe, expect, it } from "vitest";
import {
	buildBingBody,
	buildBingUrl,
	buildGoogleBody,
	buildGooglePostUrl,
	buildOpenAIRequestBody,
	buildOpenAIUrl,
	formatBingError,
	formatBingFetchError,
	formatGoogleError,
	formatGoogleFetchError,
	formatFetchErrorMessage,
	formatOpenAIError,
	formatOpenAIFetchError,
	formatRefusalError,
	isRefusalContent,
	parseBingResponse,
	parseGoogleResponse,
	parseOpenAIHealth,
	parseOpenAIModels,
	parseOpenAITranslation,
	targetToBingLang,
} from "../src/lib/translate";

describe("buildOpenAIUrl", () => {
	it("joins base URL with /v1/chat/completions, normalizing trailing slash", () => {
		expect(buildOpenAIUrl("https://api.example.com/", "chat")).toBe(
			"https://api.example.com/v1/chat/completions",
		);
		expect(buildOpenAIUrl("https://api.example.com", "chat")).toBe(
			"https://api.example.com/v1/chat/completions",
		);
	});

	it("joins base URL with /v1/models for the health/models endpoint", () => {
		expect(buildOpenAIUrl("https://api.example.com/", "models")).toBe(
			"https://api.example.com/v1/models",
		);
	});

	it("does not duplicate /v1 when the base already ends with it", () => {
		expect(buildOpenAIUrl("http://localhost:11434/v1", "chat")).toBe(
			"http://localhost:11434/v1/chat/completions",
		);
		expect(buildOpenAIUrl("https://api.example.com/v1/", "models")).toBe(
			"https://api.example.com/v1/models",
		);
		expect(buildOpenAIUrl("https://api.example.com/V1", "chat")).toBe(
			"https://api.example.com/V1/chat/completions",
		);
	});

	it("still appends /v1 when it only appears as a path segment earlier", () => {
		expect(buildOpenAIUrl("https://api.example.com/v1beta", "chat")).toBe(
			"https://api.example.com/v1beta/v1/chat/completions",
		);
	});
});

describe("buildOpenAIRequestBody", () => {
	it("puts the text segments in a JSON array as user content, with model and temperature 0", () => {
		const body = JSON.parse(
			buildOpenAIRequestBody(["短标题", "长标题"], "zh-CN", "gpt-4o-mini"),
		);
		expect(body.model).toBe("gpt-4o-mini");
		expect(body.temperature).toBe(0);
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].role).toBe("system");
		expect(body.messages[1].role).toBe("user");
		expect(JSON.parse(body.messages[1].content)).toEqual(["短标题", "长标题"]);
		expect(body.messages[1].content).not.toContain("<code>");
		expect(body.messages[1].content).not.toContain("<span>");
	});

	it("supports a single segment for javtrailers source", () => {
		const body = JSON.parse(buildOpenAIRequestBody(["仅标题"], "zh-CN", "m"));
		expect(JSON.parse(body.messages[1].content)).toEqual(["仅标题"]);
	});

	it("omits the model field when empty (backend default)", () => {
		const body = JSON.parse(buildOpenAIRequestBody(["text"], "zh-CN", ""));
		expect(body.model).toBeUndefined();
		expect(body.temperature).toBe(0);
	});

	it("uses a Simplified-Chinese system prompt for zh-CN", () => {
		const body = JSON.parse(buildOpenAIRequestBody(["x"], "zh-CN", "m"));
		expect(body.messages[0].content).toContain("简体");
	});

	it("uses a Traditional-Chinese system prompt for zh-TW", () => {
		const body = JSON.parse(buildOpenAIRequestBody(["x"], "zh-TW", "m"));
		expect(body.messages[0].content).toContain("繁體");
	});

	it("uses an English system prompt for en", () => {
		const body = JSON.parse(buildOpenAIRequestBody(["x"], "en", "m"));
		expect(body.messages[0].content).toContain("English");
	});
});

describe("translation system prompt (OpenAI mode)", () => {
	// 三语提示词必须锁定同一套 JSON 数组契约，任一语言漏规则都会导致段数/顺序错位
	const prompts = (["zh-CN", "zh-TW", "en"] as const).map(
		(target) =>
			JSON.parse(buildOpenAIRequestBody(["x"], target, "m")).messages[0]
				.content as string,
	);

	it("locks the JSON array contract in every locale", () => {
		for (const p of prompts) {
			expect(p).toContain("JSON");
			expect(p).toMatch(/same order|順序與數量|顺序与数量/);
			expect(p).not.toContain("<code>");
			expect(p).not.toContain("<span>");
		}
	});

	it("forbids markdown code fence and extra commentary in every locale", () => {
		for (const p of prompts) {
			expect(p).toMatch(/code fence|程式碼區塊|代码块/);
			expect(p).toMatch(/不得有任何文字|No text outside/);
		}
	});

	it("keeps the newline contract without introducing %% separators", () => {
		for (const p of prompts) {
			expect(p).not.toContain("%%");
			expect(p).toMatch(/换行|換行|line breaks/);
		}
	});

	it("keeps performer names untranslated in every locale", () => {
		for (const p of prompts) {
			expect(p).toMatch(
				/出演者姓名|出演者／女優姓名|Never translate a person's name/,
			);
		}
	});

	it("describes the single-item case as a full work title in every locale", () => {
		for (const p of prompts) {
			// 单项场景（javtrailers 源）那一项是完整标题，不是短标题/介绍
			expect(p).toMatch(/1 项|1 項|1 item/);
			expect(p).toMatch(/完整标题|完整標題|full work title/);
		}
	});
});

describe("parseOpenAITranslation", () => {
	it("parses the JSON array in choices[0].message.content, preserving order", () => {
		expect(
			parseOpenAITranslation({
				choices: [
					{
						message: {
							role: "assistant",
							content: '["短标题译文","这是作品的介绍文。"]',
						},
					},
				],
			}),
		).toEqual(["短标题译文", "这是作品的介绍文。"]);
	});

	it("keeps a single-segment array as one item", () => {
		expect(
			parseOpenAITranslation({
				choices: [{ message: { role: "assistant", content: '["标题译文"]' } }],
			}),
		).toEqual(["标题译文"]);
	});

	it("extracts array from a markdown ```json code fence", () => {
		expect(
			parseOpenAITranslation({
				choices: [
					{
						message: {
							role: "assistant",
							content: '```json\n["短标题译文", "介绍译文"]\n```',
						},
					},
				],
			}),
		).toEqual(["短标题译文", "介绍译文"]);
	});

	it("extracts the first [..] block when the model adds surrounding text", () => {
		expect(
			parseOpenAITranslation({
				choices: [
					{
						message: {
							role: "assistant",
							content: 'Sure! Here is the translation:\n["短标题译文","介绍译文"]\nHope this helps.',
						},
					},
				],
			}),
		).toEqual(["短标题译文", "介绍译文"]);
	});

	it("rejects arrays with non-string elements", () => {
		expect(
			parseOpenAITranslation({
				choices: [{ message: { content: '["标题译文", null]' } }],
			}),
		).toEqual([]);
	});

	it("returns empty array for malformed or missing content", () => {
		expect(parseOpenAITranslation(null)).toEqual([]);
		expect(parseOpenAITranslation({})).toEqual([]);
		expect(parseOpenAITranslation({ choices: [] })).toEqual([]);
		expect(
			parseOpenAITranslation({ choices: [{ message: { role: "assistant" } }] }),
		).toEqual([]);
		expect(
			parseOpenAITranslation({ choices: [{ message: { content: "没有数组的纯文本" } }] }),
		).toEqual([]);
	});
});

describe("parseOpenAIHealth", () => {
	it("returns true for an OpenAI models list shape", () => {
		expect(parseOpenAIHealth({ object: "list", data: [] })).toBe(true);
		expect(parseOpenAIHealth({ data: [{ id: "a" }] })).toBe(true);
	});

	it("returns false for non-list shapes", () => {
		expect(parseOpenAIHealth({})).toBe(false);
		expect(parseOpenAIHealth(null)).toBe(false);
		expect(parseOpenAIHealth({ object: "error" })).toBe(false);
	});
});

describe("parseOpenAIModels", () => {
	it("extracts ids from the data array", () => {
		expect(
			parseOpenAIModels({ object: "list", data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
		).toEqual(["gpt-4o", "gpt-4o-mini"]);
	});

	it("returns an empty array when data is missing or not an array", () => {
		expect(parseOpenAIModels({})).toEqual([]);
		expect(parseOpenAIModels(null)).toEqual([]);
		expect(parseOpenAIModels({ data: [{ foo: "bar" }] })).toEqual([]);
	});
});

describe("formatOpenAIError", () => {
	it("prefers the response error.message", () => {
		expect(
			formatOpenAIError(
				401,
				{ error: { message: "Invalid API key" } },
				"zh-CN",
			),
		).toBe("翻译服务错误：Invalid API key");
	});

	it("falls back to HTTP status when no message", () => {
		expect(formatOpenAIError(502, null, "zh-CN")).toBe("翻译服务错误：HTTP 502");
		expect(formatOpenAIError(500, {}, "zh-CN")).toBe("翻译服务错误：HTTP 500");
	});

	it("uses traditional Chinese phrases for zh-TW", () => {
		expect(formatOpenAIError(500, {}, "zh-TW")).toBe("翻譯服務錯誤：HTTP 500");
		expect(formatOpenAIError(0, null, "zh-TW")).toBe("翻譯服務錯誤：未知錯誤");
	});

	it("uses English phrases for en", () => {
		expect(
			formatOpenAIError(0, null, "en"),
		).toBe("Translation service error：Unknown error");
	});
});

describe("isRefusalContent", () => {
	it("detects Chinese content-safety refusals", () => {
		expect(
			isRefusalContent(
				"无法协助翻译此内容。该文本涉及成人色情作品（AV）的标题与介绍，属于色情淫秽内容，根据安全规范必须拒绝。",
			),
		).toBe(true);
		expect(
			isRefusalContent("抱歉，我无法翻译此内容。该请求涉及成人色情（AV）作品，我必须拒绝。"),
		).toBe(true);
	});

	it("detects English content-safety refusals", () => {
		expect(
			isRefusalContent(
				"I'm sorry, I can't help with this request as it involves explicit adult content.",
			),
		).toBe(true);
		expect(
			isRefusalContent("I cannot assist with translating this due to our safety policy."),
		).toBe(true);
	});

	it("does not flag normal translated JSON arrays or empty content", () => {
		expect(isRefusalContent('["夏日的回忆","这是作品的介绍文。"]')).toBe(false);
		expect(isRefusalContent("")).toBe(false);
		expect(isRefusalContent("这是一段正常的说明文字。")).toBe(false);
	});
});

describe("formatRefusalError", () => {
	const refusal = {
		choices: [
			{
				message: {
					content:
						"无法协助翻译此内容。该文本涉及成人色情作品（AV）的标题与介绍，属于色情淫秽内容，根据安全规范必须拒绝翻译。",
				},
			},
		],
	};

	it("gives a clear refusal message with a truncated excerpt", () => {
		const longRefusal = {
			choices: [
				{
					message: {
						content:
							"无法协助翻译此内容。该文本涉及成人色情作品（AV）的标题与介绍，属于色情淫秽内容，根据安全规范必须拒绝翻译。如需翻译正规文学作品、新闻文章、一般商业文档或其他非成人内容，我可以提供帮助。",
					},
				},
			],
		};
		const result = formatRefusalError(longRefusal, "zh-CN");
		expect(result).toContain("模型拒绝翻译该内容");
		expect(result).toContain("无法协助翻译此内容");
		expect(result).toContain("…");
		expect(result.length).toBeLessThan(120);
	});

	it("uses the target language phrases", () => {
		expect(formatRefusalError(refusal, "zh-TW")).toContain("模型拒絕翻譯該內容");
		expect(formatRefusalError(refusal, "en")).toContain("Model refused to translate");
	});

	it("falls back to the phrase alone when no content", () => {
		expect(formatRefusalError({}, "zh-CN")).toBe("模型拒绝翻译该内容（内容安全策略）");
	});
});

describe("buildGooglePostUrl", () => {
	it("builds the gtx POST URL without the q parameter", () => {
		const url = buildGooglePostUrl("zh-CN");
		expect(url).toContain("translate_a/t");
		expect(url).toContain("client=gtx");
		expect(url).toContain("sl=auto");
		expect(url).toContain("tl=zh-CN");
		expect(url).toContain("dt=t");
		expect(url).not.toContain("q=");
	});

	it("uses zh-TW for traditional Chinese", () => {
		expect(buildGooglePostUrl("zh-TW")).toContain("tl=zh-TW");
	});

	it("uses en for the English target", () => {
		expect(buildGooglePostUrl("en")).toContain("tl=en");
	});
});

describe("buildGoogleBody", () => {
	it("puts each text in its own q form field (batch)", () => {
		const body = buildGoogleBody(["短标题", "介绍正文"]);
		expect(body.getAll("q")).toEqual(["短标题", "介绍正文"]);
	});

	it("supports a single text", () => {
		expect(buildGoogleBody(["Hello world"]).getAll("q")).toEqual([
			"Hello world",
		]);
	});
});

describe("parseGoogleResponse", () => {
	it("returns one translation per q, in order", () => {
		// translate_a/t 批量响应：每个 q 一项 [译文, 检测语言]
		expect(
			parseGoogleResponse([
				["短标题译文", "ja"],
				["介绍译文", "ja"],
			]),
		).toEqual(["短标题译文", "介绍译文"]);
	});

	it("keeps a single-text response as a one-element array", () => {
		expect(parseGoogleResponse([["标题译文", "ja"]])).toEqual(["标题译文"]);
	});

	it("returns empty array for malformed responses", () => {
		expect(parseGoogleResponse(null)).toEqual([]);
		expect(parseGoogleResponse({})).toEqual([]);
		expect(parseGoogleResponse(["nope"])).toEqual([""]);
	});
});

describe("targetToBingLang", () => {
	it("maps zh-CN to zh-Hans", () => {
		expect(targetToBingLang("zh-CN")).toBe("zh-Hans");
	});

	it("maps zh-TW to zh-Hant", () => {
		expect(targetToBingLang("zh-TW")).toBe("zh-Hant");
	});

	it("maps en to en", () => {
		expect(targetToBingLang("en")).toBe("en");
	});
});

describe("buildBingUrl", () => {
	it("builds the Edge translate URL with auto source detection", () => {
		const url = buildBingUrl("zh-CN");
		expect(url).toContain("edge.microsoft.com/translate/translatetext");
		expect(url).toContain("from=");
		expect(url).toContain("to=zh-Hans");
		expect(url).toContain("isEnterpriseClient=false");
	});

	it("uses zh-Hant for traditional Chinese", () => {
		expect(buildBingUrl("zh-TW")).toContain("to=zh-Hant");
	});

	it("uses en for the English target", () => {
		expect(buildBingUrl("en")).toContain("to=en");
	});
});

describe("buildBingBody", () => {
	it("serializes texts as a JSON array (batch)", () => {
		expect(JSON.parse(buildBingBody(["短标题", "介绍正文"]))).toEqual([
			"短标题",
			"介绍正文",
		]);
	});

	it("supports a single text", () => {
		expect(JSON.parse(buildBingBody(["Hello world"]))).toEqual([
			"Hello world",
		]);
	});
});

describe("parseBingResponse", () => {
	it("returns one translation per batch item, in order", () => {
		expect(
			parseBingResponse([
				{
					detectedLanguage: { language: "ja", score: 1 },
					translations: [{ text: "短标题译文", to: "zh-Hans" }],
				},
				{
					detectedLanguage: { language: "ja", score: 1 },
					translations: [{ text: "介绍译文", to: "zh-Hans" }],
				},
			]),
		).toEqual(["短标题译文", "介绍译文"]);
	});

	it("keeps a single-text response as a one-element array", () => {
		expect(
			parseBingResponse([{ translations: [{ text: "标题译文" }] }]),
		).toEqual(["标题译文"]);
	});

	it("returns empty array for malformed responses", () => {
		expect(parseBingResponse(null)).toEqual([]);
		expect(parseBingResponse({})).toEqual([]);
		expect(parseBingResponse([])).toEqual([]);
		expect(parseBingResponse([{}])).toEqual([""]);
		expect(parseBingResponse([{ translations: [] }])).toEqual([""]);
	});
});

describe("formatBingError", () => {
	it("formats HTTP status with the bing prefix", () => {
		expect(formatBingError(403, "zh-CN")).toBe("微软翻译错误：HTTP 403");
	});

	it("uses traditional Chinese phrases for zh-TW", () => {
		expect(formatBingError(403, "zh-TW")).toBe("微軟翻譯錯誤：HTTP 403");
	});
});

describe("formatBingFetchError", () => {
	it("formats timeout separately", () => {
		const error = new Error("timeout");
		error.name = "TimeoutError";
		expect(formatBingFetchError(error, "zh-CN")).toBe("微软翻译错误：请求超时");
	});

	it("replaces browser system messages with localized phrase", () => {
		expect(formatBingFetchError(new Error("Failed to fetch"), "zh-CN")).toBe(
			"微软翻译错误：网络连接失败",
		);
		expect(formatBingFetchError(new Error("Failed to fetch"), "zh-TW")).toBe(
			"微軟翻譯錯誤：網路連線失敗",
		);
	});
});

describe("formatGoogleError", () => {
	it("formats HTTP status with the google prefix", () => {
		expect(formatGoogleError(500, "zh-CN")).toBe("谷歌翻译错误：HTTP 500");
		expect(formatGoogleError(500, "zh-TW")).toBe("谷歌翻譯錯誤：HTTP 500");
	});
});

describe("formatGoogleFetchError", () => {
	it("replaces browser system messages with localized phrase", () => {
		expect(formatGoogleFetchError(new Error("Failed to fetch"), "zh-CN")).toBe(
			"谷歌翻译错误：网络连接失败",
		);
		expect(formatGoogleFetchError(new Error("Failed to fetch"), "zh-TW")).toBe(
			"谷歌翻譯錯誤：網路連線失敗",
		);
	});
});

describe("formatOpenAIFetchError", () => {
	it("uses service prefix with localized failure phrase", () => {
		const timeout = new Error("timeout");
		timeout.name = "TimeoutError";
		expect(formatOpenAIFetchError(timeout, "zh-CN")).toBe("翻译服务错误：请求超时");
		expect(formatOpenAIFetchError(new Error("Failed to fetch"), "zh-CN")).toBe(
			"翻译服务错误：网络连接失败",
		);
		expect(formatOpenAIFetchError(new Error("Failed to fetch"), "zh-TW")).toBe(
			"翻譯服務錯誤：網路連線失敗",
		);
		expect(formatOpenAIFetchError(new Error("Failed to fetch"), "en")).toBe(
			"Translation service error：Network connection failed",
		);
	});
});

describe("formatFetchErrorMessage", () => {
	it("distinguishes timeout from generic network failure", () => {
		const timeout = new Error("timeout");
		timeout.name = "TimeoutError";
		expect(formatFetchErrorMessage(timeout, "zh-CN")).toBe("请求超时");
		expect(formatFetchErrorMessage(new Error("Failed to fetch"), "zh-CN")).toBe(
			"网络连接失败",
		);
		expect(formatFetchErrorMessage(new Error("Failed to fetch"), "zh-TW")).toBe(
			"網路連線失敗",
		);
		expect(formatFetchErrorMessage(new Error("Failed to fetch"), "en")).toBe(
			"Network connection failed",
		);
	});
});
