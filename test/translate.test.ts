import { describe, expect, it } from "vitest";
import {
	buildBingBody,
	buildBingUrl,
	buildGoogleBody,
	buildGooglePostUrl,
	buildGoogleVerifyUrl,
	buildMergedTranslateText,
	buildWorkerTranslateBody,
	buildWorkerUrl,
	formatUsage,
	formatWorkerError,
	formatWorkerFetchError,
	formatBingError,
	formatBingFetchError,
	formatGoogleError,
	formatGoogleFetchError,
	formatFetchErrorMessage,
	parseBingResponse,
	parseGoogleResponse,
	parseWorkerHealth,
	parseWorkerTranslation,
	parseWorkerUsage,
	splitMergedTranslation,
	targetToBingLang,
} from "../src/lib/translate";

describe("buildWorkerUrl", () => {
	it("joins base URL with path, normalizing trailing slash", () => {
		expect(buildWorkerUrl("https://deepl.samwu00.de5.net/", "translate")).toBe(
			"https://deepl.samwu00.de5.net/translate",
		);
		expect(buildWorkerUrl("https://deepl.samwu00.de5.net", "health")).toBe(
			"https://deepl.samwu00.de5.net/health",
		);
	});
});

describe("buildWorkerTranslateBody", () => {
	it("uses ZH target for simplified Chinese", () => {
		const body = JSON.parse(buildWorkerTranslateBody("Hello world", "zh-CN"));
		expect(body).toEqual({ text: "Hello world", target_lang: "ZH" });
	});

	it("uses ZH-HANT target for traditional Chinese", () => {
		const body = JSON.parse(buildWorkerTranslateBody("Hello world", "zh-TW"));
		expect(body).toEqual({ text: "Hello world", target_lang: "ZH-HANT" });
	});
});

describe("parseWorkerTranslation", () => {
	it("extracts the translated text", () => {
		expect(
			parseWorkerTranslation({
				success: true,
				translation: "你好世界",
			}),
		).toBe("你好世界");
	});

	it("keeps the code tag marker unchanged", () => {
		expect(
			parseWorkerTranslation({
				success: true,
				translation: "<code>短标题译文</code>\n长标题译文",
			}),
		).toBe("<code>短标题译文</code>\n长标题译文");
	});

	it("returns empty string for malformed or failed responses", () => {
		expect(parseWorkerTranslation(null)).toBe("");
		expect(parseWorkerTranslation({})).toBe("");
		expect(parseWorkerTranslation({ success: true })).toBe("");
		expect(parseWorkerTranslation({ success: false, translation: "x" })).toBe("");
	});
});

describe("parseWorkerHealth", () => {
	it("returns true only for success with ok status", () => {
		expect(parseWorkerHealth({ success: true, status: "ok" })).toBe(true);
		expect(parseWorkerHealth({ success: false })).toBe(false);
		expect(parseWorkerHealth(null)).toBe(false);
		expect(parseWorkerHealth({})).toBe(false);
	});
});

describe("formatWorkerError", () => {
	it("formats error code and message from the response body", () => {
		expect(
			formatWorkerError(
				401,
				{
					success: false,
					code: "AUTH_INVALID",
					error: "访问密钥无效",
				},
				"zh-CN",
			),
		).toBe("翻译服务错误 [AUTH_INVALID]：访问密钥无效");
		expect(
			formatWorkerError(
				413,
				{
					success: false,
					code: "INPUT_TOO_LONG",
					error: "输入文本过长",
				},
				"zh-CN",
			),
		).toBe("翻译服务错误 [INPUT_TOO_LONG]：输入文本过长");
	});

	it("falls back to HTTP status when body has no error message", () => {
		expect(formatWorkerError(502, null, "zh-CN")).toBe("翻译服务错误：HTTP 502");
		expect(formatWorkerError(500, {}, "zh-CN")).toBe("翻译服务错误：HTTP 500");
	});

	it("keeps the code when error message is missing", () => {
		expect(
			formatWorkerError(200, { success: false, code: "EMPTY_TEXT" }, "zh-CN"),
		).toBe("翻译服务错误 [EMPTY_TEXT]：HTTP 200");
	});

	it("uses traditional Chinese phrases for zh-TW", () => {
		expect(formatWorkerError(500, {}, "zh-TW")).toBe("翻譯服務錯誤：HTTP 500");
		expect(formatWorkerError(0, null, "zh-TW")).toBe("翻譯服務錯誤：未知錯誤");
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

describe("parseWorkerUsage", () => {	it("extracts count and limit from the wrapped usage object", () => {
		expect(
			parseWorkerUsage({
				success: true,
				usage: { character_count: 4239, character_limit: 1000000 },
			}),
		).toEqual({ count: 4239, limit: 1000000 });
	});

	it("returns null for malformed responses", () => {
		expect(parseWorkerUsage(null)).toBeNull();
		expect(parseWorkerUsage({})).toBeNull();
		expect(parseWorkerUsage({ success: true })).toBeNull();
		expect(
			parseWorkerUsage({
				success: true,
				usage: { character_count: "4239", character_limit: 1000000 },
			}),
		).toBeNull();
		expect(
			parseWorkerUsage({
				success: true,
				usage: { character_count: -1, character_limit: 1000000 },
			}),
		).toBeNull();
	});
});

describe("formatUsage", () => {
	it("formats count and limit in ten-thousands with interface-provided base", () => {
		expect(formatUsage(4239, 1000000)).toBe("0.4239/100万");
		expect(formatUsage(0, 1000000)).toBe("0.0000/100万");
		expect(formatUsage(1000000, 1000000)).toBe("100.0000/100万");
	});

	it("returns --/--万 when count or limit is missing", () => {
		expect(formatUsage(null, 1000000)).toBe("--/--万");
		expect(formatUsage(4239, null)).toBe("--/--万");
		expect(formatUsage(null, null)).toBe("--/--万");
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

describe("formatWorkerFetchError", () => {
	it("uses service prefix with localized failure phrase", () => {
		const timeout = new Error("timeout");
		timeout.name = "TimeoutError";
		expect(formatWorkerFetchError(timeout, "zh-CN")).toBe("翻译服务错误：请求超时");
		expect(formatWorkerFetchError(new Error("Failed to fetch"), "zh-CN")).toBe(
			"翻译服务错误：网络连接失败",
		);
		expect(formatWorkerFetchError(new Error("Failed to fetch"), "zh-TW")).toBe(
			"翻譯服務錯誤：網路連線失敗",
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
	});
});
