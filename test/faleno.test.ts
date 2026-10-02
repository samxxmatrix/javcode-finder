import { describe, expect, it } from "vitest";
import {
	buildFalenoWorksUrl,
	isFalenoNotFoundPage,
	matchesFalenoPrefix,
	normalizePrefix,
	parseFalenoWorksHtml,
	toFalenoCodeKey,
} from "../src/lib/faleno";
// 真实作品页保存的固件(2026-09 FNS-263),解析结果必须与页面内容逐字一致(?raw 由 Vite 在转换期内联,无需 Node 类型)
import fns263Fixture from "./fixtures/FNS263.html?raw";
// 不存在的作品页固件(2026-10 FNS-265):站点以该「404 Not Found」页面响应,必须判为查无
import fns265Fixture from "./fixtures/FNS265.html?raw";

describe("faleno", () => {
	it("converts a code to the FALENO lowercase key", () => {
		expect(toFalenoCodeKey("FNS-263")).toBe("fns263");
		expect(toFalenoCodeKey("fns 263")).toBe("fns263");
		expect(toFalenoCodeKey("")).toBe("");
	});

	it("builds the works page URL", () => {
		expect(buildFalenoWorksUrl("FNS-263")).toBe(
			"https://faleno.jp/top/works/fns263",
		);
		expect(buildFalenoWorksUrl("")).toBe("");
		expect(buildFalenoWorksUrl(" - ")).toBe("");
	});

	it("normalizes prefix entries", () => {
		expect(normalizePrefix(" fns ")).toBe("FNS");
		expect(normalizePrefix("")).toBe("");
		expect(normalizePrefix("fns-")).toBe("FNS");
	});

	it("matches prefixes case- and separator-insensitively", () => {
		expect(matchesFalenoPrefix("FNS-263", ["FNS"])).toBe(true);
		expect(matchesFalenoPrefix("fns263", ["fns"])).toBe(true);
		expect(matchesFalenoPrefix("FSDSS-001", ["FNS", "FSDSS"])).toBe(true);
		expect(matchesFalenoPrefix("ABP-123", ["FNS"])).toBe(false);
		expect(matchesFalenoPrefix("FNS-263", [])).toBe(false);
		expect(matchesFalenoPrefix("FNS-263", ["fns-"])).toBe(true);
		expect(matchesFalenoPrefix("FNS-263", ["--"])).toBe(false);
	});
});

describe("parseFalenoWorksHtml", () => {
	it("parses the real FNS-263 page fixture", () => {
		const data = parseFalenoWorksHtml(fns263Fixture);
		expect(data).not.toBeNull();
		expect(data!.previewUrl).toBe(
			"https://cdn.faleno.net/top/wp-content/uploads/2026/09/FNS-263_PR.mp4",
		);
		expect(data!.coverUrl).toBe(
			"https://cdn.faleno.net/top/wp-content/uploads/2026/09/FNS-263_1200.jpg?output-quality=60",
		);
		expect(data!.shortTitle).toBe(
			"【汗・潮・淫汁・お漏らし】柏木【雫】を搾り尽くす体液ダダ洩れアクメ覚醒SEX 柏木雫",
		);
		expect(data!.title).toBe(
			"撮影を重ねるごとにエロくなっていく柏木雫ちゃんの汗、潮、マ〇汁、更にはヨダレ、涙まで全てを搾り尽くして味わい尽くす1本！スレンダーなピュアボディがドロドロの体液まみれでイキ狂う姿をお楽しみください。",
		);
	});

	it("returns null for empty or unrelated HTML", () => {
		expect(parseFalenoWorksHtml("")).toBeNull();
		expect(parseFalenoWorksHtml("<html><body>404 Not Found</body></html>")).toBeNull();
	});

	it("treats the site's not-found page as no result", () => {
		expect(parseFalenoWorksHtml(fns265Fixture)).toBeNull();
	});
});

describe("isFalenoNotFoundPage", () => {
	it("detects the not-found page fixture", () => {
		expect(isFalenoNotFoundPage(fns265Fixture)).toBe(true);
	});

	it("does not flag a real works page", () => {
		expect(isFalenoNotFoundPage(fns263Fixture)).toBe(false);
	});
});
