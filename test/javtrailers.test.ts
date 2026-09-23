import { describe, expect, it } from "vitest";
import {
	buildCoverUrlFromContentId,
	buildTrailerUrlFromContentId,
	parseSearchPageHtml,
} from "../src/lib/javtrailers";

// 截取自 javtrailers.com 搜索页真实 SSR HTML 的卡片结构
const CARD = (
	contentId: string,
	alt: string,
) => `<div class="card-container"><a href="/video/${contentId}" class="video-link" title="some title"><div class="card video-card"><div class="card-img-container"><img data-src="https://images.javtrailers.com/digital/video/${contentId}/${contentId}ps.w360.webp" alt="${alt}" class="card-img-top video-image"><span class="badge duration-badge">2:58:00</span></div></div></a></div>`;

describe("parseSearchPageHtml", () => {
	it("returns the detail URL and contentId when the first card matches the code", () => {
		const html = CARD("1dldss00529", "DLDSS-529 jav");
		expect(parseSearchPageHtml(html, "DLDSS-529")).toEqual({
			detailUrl: "https://javtrailers.com/video/1dldss00529",
			contentId: "1dldss00529",
		});
	});

	it("tolerates case, hyphen, and space differences in the code", () => {
		const html = CARD("1dldss00529", "DLDSS-529 jav");
		expect(parseSearchPageHtml(html, "dldss 529")).toEqual({
			detailUrl: "https://javtrailers.com/video/1dldss00529",
			contentId: "1dldss00529",
		});
	});

	it("returns null when the first card does not match the code", () => {
		const html = CARD("sone00846", "SONE-846 jav");
		expect(parseSearchPageHtml(html, "DLDSS-529")).toBeNull();
	});

	it("returns null when the matching card is not the first one", () => {
		const html =
			`<div class="card-container"><a href="/video/xxx00001"><img alt="XXX-001 jav"></a></div>` +
			CARD("1dldss00529", "DLDSS-529 jav");
		expect(parseSearchPageHtml(html, "DLDSS-529")).toBeNull();
	});

	it("returns null when the page has no card-container", () => {
		expect(parseSearchPageHtml("<html><body>no results</body></html>", "ABP-123")).toBeNull();
	});

	it("ignores the CSS rule .card-container that precedes the cards (real page quirk)", () => {
		// 真实搜索页 <style> 块先出现 .card-container{margin-bottom:2rem}，
		// 解析必须以 class="card-container" 为锚点，否则会落在 CSS 上（实测踩坑）
		const html =
			`<style>a{text-decoration:none}.card-container{margin-bottom:2rem}</style>` +
			CARD("1dldss00529", "DLDSS-529 jav");
		expect(parseSearchPageHtml(html, "DLDSS-529")).toEqual({
			detailUrl: "https://javtrailers.com/video/1dldss00529",
			contentId: "1dldss00529",
		});
	});

	it("returns null when a card lacks href or alt", () => {
		expect(
			parseSearchPageHtml(
				`<div class="card-container"><a href="/video/abc00001"><img></a></div>`,
				"ABC-001",
			),
		).toBeNull();
	});

	it("returns null for empty input", () => {
		expect(parseSearchPageHtml("", "ABP-123")).toBeNull();
		expect(parseSearchPageHtml(CARD("1dldss00529", "DLDSS-529 jav"), "")).toBeNull();
	});
});

describe("buildCoverUrlFromContentId", () => {
	it("builds cover URL from a prefixed contentId", () => {
		expect(buildCoverUrlFromContentId("1dldss00547")).toBe(
			"https://images.javtrailers.com/digital/video/1dldss00547/1dldss00547pl.w800.webp",
		);
	});

	it("returns empty string for empty contentId", () => {
		expect(buildCoverUrlFromContentId("")).toBe("");
	});
});

describe("buildTrailerUrlFromContentId", () => {
	it("builds HLS URL from a prefixed contentId (first char / first 3 chars)", () => {
		expect(buildTrailerUrlFromContentId("1dldss00547")).toBe(
			"https://media.javtrailers.com/hlsvideo/freepv/1/1dl/1dldss00547/playlist.m3u8",
		);
	});

	it("returns empty string for too-short contentId", () => {
		expect(buildTrailerUrlFromContentId("ab")).toBe("");
		expect(buildTrailerUrlFromContentId("")).toBe("");
	});
});
