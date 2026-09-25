import { describe, expect, it } from "vitest";
import {
	buildGoogleUrl,
	buildWorkerTranslateBody,
	buildWorkerUrl,
	formatUsage,
	parseGoogleResponse,
	parseWorkerHealth,
	parseWorkerTranslation,
	parseWorkerUsage,
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

describe("parseWorkerUsage", () => {
	it("extracts count and limit from the wrapped usage object", () => {
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

describe("buildGoogleUrl", () => {
	it("builds the gtx URL with target language and text", () => {
		const url = buildGoogleUrl("Hello world", "zh-CN");
		expect(url).toContain("client=gtx");
		expect(url).toContain("sl=auto");
		expect(url).toContain("tl=zh-CN");
		expect(url).toContain("dt=t");
		expect(url).toContain("Hello+world");
	});

	it("uses zh-TW for traditional Chinese", () => {
		expect(buildGoogleUrl("Hello", "zh-TW")).toContain("tl=zh-TW");
	});
});

describe("parseGoogleResponse", () => {
	it("joins translated segments", () => {
		// translate_a/single 的真实响应：首层数组的 [0] 是分段译文数组
		expect(
			parseGoogleResponse([
				[["你好", "Hello", null, null, 10]],
				null,
				"en",
			]),
		).toBe("你好");
	});

	it("returns empty string for malformed responses", () => {
		expect(parseGoogleResponse(null)).toBe("");
		expect(parseGoogleResponse({})).toBe("");
		expect(parseGoogleResponse(["nope"])).toBe("");
	});
});
