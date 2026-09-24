import { describe, expect, it } from "vitest";
import {
	buildDeepLBody,
	parseDeepLResponse,
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
