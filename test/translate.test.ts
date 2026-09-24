import { describe, expect, it } from "vitest";
import {
	buildDeepLBody,
	buildGoogleUrl,
	formatUsage,
	parseDeepLResponse,
	parseDeepLUsage,
	parseGoogleResponse,
} from "../src/lib/translate";

describe("buildDeepLBody", () => {
	it("uses ZH target for simplified Chinese", () => {
		const body = buildDeepLBody("Hello world", "zh-CN");
		expect(body.get("text")).toBe("Hello world");
		expect(body.get("target_lang")).toBe("ZH");
	});

	it("uses ZH-HANT target for traditional Chinese", () => {
		const body = buildDeepLBody("Hello world", "zh-TW");
		expect(body.get("target_lang")).toBe("ZH-HANT");
	});
});

describe("parseDeepLResponse", () => {
	it("extracts the translated text", () => {
		expect(
			parseDeepLResponse({
				translations: [
					{
						detected_source_language: "EN",
						text: "你好世界",
					},
				],
			}),
		).toBe("你好世界");
	});

	it("returns empty string for malformed responses", () => {
		expect(parseDeepLResponse(null)).toBe("");
		expect(parseDeepLResponse({})).toBe("");
		expect(parseDeepLResponse({ translations: [] })).toBe("");
	});
});

describe("parseDeepLUsage", () => {
	it("extracts the character count", () => {
		expect(
			parseDeepLUsage({ character_count: 4239, character_limit: 1000000 }),
		).toBe(4239);
	});

	it("returns null for malformed responses", () => {
		expect(parseDeepLUsage(null)).toBeNull();
		expect(parseDeepLUsage({})).toBeNull();
		expect(parseDeepLUsage({ character_count: "4239" })).toBeNull();
		expect(parseDeepLUsage({ character_count: -1 })).toBeNull();
	});
});

describe("formatUsage", () => {
	it("formats the count in ten-thousands against a fixed 1M limit", () => {
		expect(formatUsage(4239)).toBe("0.4239/100万");
		expect(formatUsage(0)).toBe("0.0000/100万");
		expect(formatUsage(1000000)).toBe("100.0000/100万");
	});

	it("returns --/100万 for missing counts", () => {
		expect(formatUsage(null)).toBe("--/100万");
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
