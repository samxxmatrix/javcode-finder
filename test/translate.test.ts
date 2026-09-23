import { describe, expect, it } from "vitest";
import { buildTranslateUrl, parseTranslateResponse } from "../src/lib/translate";

describe("buildTranslateUrl", () => {
	it("builds URL with zh-CN target for simplified Chinese", () => {
		expect(buildTranslateUrl("Hello world", "zh-CN")).toBe(
			"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=Hello%20world",
		);
	});

	it("builds URL with zh-TW target for traditional Chinese", () => {
		expect(buildTranslateUrl("Hello world", "zh-TW")).toBe(
			"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=Hello%20world",
		);
	});
});

describe("parseTranslateResponse", () => {
	it("joins translated segments", () => {
		expect(
			parseTranslateResponse([
				[
					["你好，", "Hello,", null, null, 10],
					["世界", "world", null, null, 10],
				],
				null,
				"en",
			]),
		).toBe("你好，世界");
	});

	it("returns empty string for malformed responses", () => {
		expect(parseTranslateResponse(null)).toBe("");
		expect(parseTranslateResponse({})).toBe("");
		expect(parseTranslateResponse([null, null])).toBe("");
	});
});
