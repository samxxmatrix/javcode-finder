import { describe, expect, it } from "vitest";
import {
	buildBingBody,
	buildBingUrl,
	buildGoogleBody,
	buildGooglePostUrl,
	buildGoogleVerifyUrl,
	buildMergedTranslateText,
	buildOpenAIRequestBody,
	buildOpenAIUrl,
	formatBingError,
	formatBingFetchError,
	formatGoogleError,
	formatGoogleFetchError,
	formatFetchErrorMessage,
	formatOpenAIError,
	formatOpenAIFetchError,
	parseBingResponse,
	parseGoogleResponse,
	parseOpenAIHealth,
	parseOpenAIModels,
	parseOpenAITranslation,
	splitMergedTranslation,
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
	it("includes the model when provided, with temperature 0 and system+user messages", () => {
		const body = JSON.parse(
			buildOpenAIRequestBody("<code>短标题</code>\n长标题", "zh-CN", "gpt-4o-mini"),
		);
		expect(body.model).toBe("gpt-4o-mini");
		expect(body.temperature).toBe(0);
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].role).toBe("system");
		expect(body.messages[1].role).toBe("user");
		expect(body.messages[1].content).toBe("<code>短标题</code>\n长标题");
	});

	it("omits the model field when empty (backend default)", () => {
		const body = JSON.parse(buildOpenAIRequestBody("text", "zh-CN", ""));
		expect(body.model).toBeUndefined();
		expect(body.temperature).toBe(0);
	});

	it("uses a Simplified-Chinese system prompt for zh-CN", () => {
		const body = JSON.parse(buildOpenAIRequestBody("x", "zh-CN", "m"));
		expect(body.messages[0].content).toContain("简体");
	});

	it("uses a Traditional-Chinese system prompt for zh-TW", () => {
		const body = JSON.parse(buildOpenAIRequestBody("x", "zh-TW", "m"));
		expect(body.messages[0].content).toContain("繁體");
	});

	it("uses an English system prompt for en", () => {
		const body = JSON.parse(buildOpenAIRequestBody("x", "en", "m"));
		expect(body.messages[0].content).toContain("English");
	});
});

describe("translation system prompt (OpenAI mode)", () => {
	// 三语提示词必须锁定同一套 <code> 拆分契约，任一语言漏规则都会导致标题串进介绍
	const prompts = (["zh-CN", "zh-TW", "en"] as const).map(
		(target) =>
			JSON.parse(buildOpenAIRequestBody("x", target, "m")).messages[0]
				.content as string,
	);

	it("locks the <code> contract in every locale", () => {
		for (const p of prompts) {
			expect(p).toContain("<code>");
			expect(p).toContain("</code>");
			expect(p).toMatch(/必须翻译|必須翻譯|NOT code/);
			expect(p).toMatch(/不得移动|不得移動|Do not move/);
		}
	});

	it("forbids translation prefixes and extra commentary in every locale", () => {
		for (const p of prompts) {
			expect(p).toContain("Here's the translation:");
			expect(p).toMatch(/只输出译文|只輸出譯文|Output only the translation/);
		}
	});

	it("keeps the newline contract without introducing %% separators", () => {
		for (const p of prompts) {
			expect(p).not.toContain("%%");
			expect(p).toMatch(/换行|換行|newline/);
		}
	});

	it("keeps performer names untranslated in every locale", () => {
		for (const p of prompts) {
			expect(p).toMatch(
				/出演者姓名|出演者／女優姓名|Never translate a person's name/,
			);
		}
	});
});

describe("parseOpenAITranslation", () => {
	it("extracts content from the first choice message", () => {
		expect(
			parseOpenAITranslation({
				choices: [{ message: { role: "assistant", content: "你好世界" } }],
			}),
		).toBe("你好世界");
	});

	it("keeps the code tag marker unchanged", () => {
		expect(
			parseOpenAITranslation({
				choices: [
					{ message: { role: "assistant", content: "<code>短标题译文</code>\n长标题译文" } },
				],
			}),
		).toBe("<code>短标题译文</code>\n长标题译文");
	});

	it("returns empty string for malformed or missing content", () => {
		expect(parseOpenAITranslation(null)).toBe("");
		expect(parseOpenAITranslation({})).toBe("");
		expect(parseOpenAITranslation({ choices: [] })).toBe("");
		expect(
			parseOpenAITranslation({ choices: [{ message: { role: "assistant" } }] }),
		).toBe("");
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

describe("buildMergedTranslateText", () => {
	it("wraps short title in code tags and separates long title with newline", () => {
		expect(
			buildMergedTranslateText("緊縛哀犬夫人 宮西ひかる", "背徳の変態願望を胸に秘め…"),
		).toBe("<code>緊縛哀犬夫人 宮西ひかる</code>\n背徳の変態願望を胸に秘め…");
	});
});

describe("splitMergedTranslation", () => {
	it("splits code-tagged short title and long title", () => {
		const result = splitMergedTranslation(
			"<code>Tied Dog Wife Hikaru Miyanishi</code>\nHidden in her heart was a perverted desire...",
		);
		expect(result.short).toBe("Tied Dog Wife Hikaru Miyanishi");
		expect(result.long).toBe("Hidden in her heart was a perverted desire...");
	});

	it("handles tags without newline separator", () => {
		const result = splitMergedTranslation("<code>短标题</code>长标题内容");
		expect(result.short).toBe("短标题");
		expect(result.long).toBe("长标题内容");
	});

	it("trims the space inserted after the tag by translators", () => {
		// 谷歌实测会在 <code> 后插空格
		const result = splitMergedTranslation(
			"<code> 搭讪旅店工作的熟女</code>\n长标题译文",
		);
		expect(result.short).toBe("搭讪旅店工作的熟女");
		expect(result.long).toBe("长标题译文");
	});

	it("handles escaped code tags", () => {
		const result = splitMergedTranslation(
			"&lt;code&gt;标题&lt;/code&gt;\n描述",
		);
		expect(result.short).toBe("标题");
		expect(result.long).toBe("描述");
	});

	it("keeps brace compatibility as fallback when the marker is rewritten", () => {
		// 翻译器改写标记为花括号时的兜底
		const result = splitMergedTranslation("{短标题}\n长标题内容");
		expect(result.short).toBe("短标题");
		expect(result.long).toBe("长标题内容");
		expect(
			splitMergedTranslation("｛緊縛哀犬夫人｝\n背徳の変態願望…").short,
		).toBe("緊縛哀犬夫人");
	});

	it("falls back to whole text as long title when the marker is lost", () => {
		const result = splitMergedTranslation("翻译器吃掉了标记的整段译文内容");
		expect(result.short).toBeNull();
		expect(result.long).toBe("翻译器吃掉了标记的整段译文内容");
	});

	it("falls back when the marker exists but no long title follows", () => {
		const result = splitMergedTranslation("<code>只有短标题</code>");
		expect(result.short).toBeNull();
		expect(result.long).toBe("<code>只有短标题</code>");
	});

	it("merges leading text moved outside the marker into the short title", () => {
		// 微软翻译会把量词提到 <code> 标记外（MCSR-642 实测）
		const result = splitMergedTranslation(
			"一位<code>在旅馆工作的成熟美人</code>\n一位我一年一次的奖励旅行中遇到的女仆",
		);
		expect(result.short).toBe("一位在旅馆工作的成熟美人");
		expect(result.long).toBe("一位我一年一次的奖励旅行中遇到的女仆");
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
	it("carries the text in the q form field", () => {
		expect(buildGoogleBody("Hello world").get("q")).toBe("Hello world");
	});
});

describe("buildGoogleVerifyUrl", () => {
	it("builds a GET URL with the text for the verify window", () => {
		const url = buildGoogleVerifyUrl("Hello world", "zh-CN");
		expect(url).toContain("translate_a/t");
		expect(url).toContain("client=gtx");
		expect(url).toContain("tl=zh-CN");
		expect(url).toContain("q=Hello%20world");
	});

	it("uses zh-TW for traditional Chinese", () => {
		expect(buildGoogleVerifyUrl("Hello", "zh-TW")).toContain("tl=zh-TW");
	});
});

describe("parseGoogleResponse", () => {
	it("joins translated entries from the flat response", () => {
		// translate_a/t 的真实响应：扁平 [译文, 检测语言] 对数组
		expect(
			parseGoogleResponse([
				["你好世界", "en"],
				["早上好", "en"],
			]),
		).toBe("你好世界早上好");
	});

	it("keeps the code tag marker unchanged", () => {
		expect(
			parseGoogleResponse([["<code>短标题译文</code>\n长标题译文", "ja"]]),
		).toBe("<code>短标题译文</code>\n长标题译文");
	});

	it("returns empty string for malformed responses", () => {
		expect(parseGoogleResponse(null)).toBe("");
		expect(parseGoogleResponse({})).toBe("");
		expect(parseGoogleResponse(["nope"])).toBe("");
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
	it("wraps the text in a single-element JSON array", () => {
		expect(JSON.parse(buildBingBody("Hello world"))).toEqual(["Hello world"]);
	});

	it("wraps marked text unchanged (marker handled by buildMergedTranslateText)", () => {
		expect(JSON.parse(buildBingBody("<code>短标题</code>\n长标题"))).toEqual([
			"<code>短标题</code>\n长标题",
		]);
	});
});

describe("parseBingResponse", () => {
	it("extracts the first translation", () => {
		expect(
			parseBingResponse([
				{
					detectedLanguage: { language: "en", score: 1 },
					translations: [{ text: "你好世界", to: "zh-Hans" }],
				},
			]),
		).toBe("你好世界");
	});

	it("keeps the code tag marker unchanged", () => {
		expect(
			parseBingResponse([
				{
					translations: [
						{ text: "<code>在旅馆工作的成熟美人</code>\n一段长文描述" },
					],
				},
			]),
		).toBe("<code>在旅馆工作的成熟美人</code>\n一段长文描述");
	});

	it("returns empty string for malformed responses", () => {
		expect(parseBingResponse(null)).toBe("");
		expect(parseBingResponse({})).toBe("");
		expect(parseBingResponse([])).toBe("");
		expect(parseBingResponse([{}])).toBe("");
		expect(parseBingResponse([{ translations: [] }])).toBe("");
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
