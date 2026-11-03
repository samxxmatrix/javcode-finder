import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	buildCoverUrlFromContentId,
	buildTrailerUrlFromContentId,
	parseDetailPageFallback,
	parseDetailPageMeta,
	parseSearchPageHtml,
} from "../../src/lib/javtrailers";

// 真实日语详情页固件（2026-10-10 浏览器 Copy response 产出）。
// 用 readFileSync 而不是 `?raw`：这样同一份测试在 vitest 与纯 Node（类型擦除）下都能跑。
const detailFixture = readFileSync(
	new URL("../fixtures/javtrailers-ja-video-1dldss00529.html", import.meta.url),
	"utf8",
);

// 截取自 javtrailers.com 日语搜索页真实 SSR HTML 的卡片结构（/ja/search 的链接带语言前缀）
const CARD = (
	contentId: string,
	alt: string,
) => `<div class="card-container"><a href="/ja/video/${contentId}" class="video-link" title="Some movie title with &amp; symbols"><div class="card video-card"><div class="card-img-container"><img data-src="https://images.javtrailers.com/digital/video/${contentId}/${contentId}ps.w360.webp" alt="${alt}" class="card-img-top video-image"><span class="badge duration-badge">2:58:00</span></div></div></a></div>`;

describe("parseSearchPageHtml", () => {
	it("returns the detail URL and contentId when the first card matches the code", () => {
		const html = CARD("1dldss00529", "DLDSS-529 jav");
		expect(parseSearchPageHtml(html, "DLDSS-529")).toEqual({
			detailUrl: "https://javtrailers.com/ja/video/1dldss00529",
			contentId: "1dldss00529",
			title: "Some movie title with & symbols",
		});
	});

	it("tolerates case, hyphen, and space differences in the code", () => {
		const html = CARD("1dldss00529", "DLDSS-529 jav");
		expect(parseSearchPageHtml(html, "dldss 529")).toEqual({
			detailUrl: "https://javtrailers.com/ja/video/1dldss00529",
			contentId: "1dldss00529",
			title: "Some movie title with & symbols",
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
			detailUrl: "https://javtrailers.com/ja/video/1dldss00529",
			contentId: "1dldss00529",
			title: "Some movie title with & symbols",
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

describe("parseDetailPageFallback", () => {
	// 截取自详情页真实 HTML：og:image 的背封图（pb_e）先于封面（pf_o1）出现，
	// NUXT 数据含 sample MP4；兜底取第一张 mgstage 图即可
	it("extracts the first mgstage image and sample trailer URLs", () => {
		const html =
			'<meta property="og:image" content="https://image.mgstage.com/images/prestige/abf/387/pb_e_abf-387.jpg">' +
			'<div id="thumbnailContainer"><img src="https://image.mgstage.com/images/prestige/abf/387/pf_o1_abf-387.jpg" alt="img"></div>' +
			'<script type="application/json" id="__NUXT_DATA__">["Reactive",1,{"video":5},"https://image.mgstage.com/images/prestige/abf/387/cap_t1_0_abf-387.jpg","https://sample.mgstage.com/sample/prestige/abf/387/abf-387_20260902T162004.mp4"]</script>';
		expect(parseDetailPageFallback(html)).toEqual({
			coverUrl: "https://image.mgstage.com/images/prestige/abf/387/pb_e_abf-387.jpg",
			trailerUrl:
				"https://sample.mgstage.com/sample/prestige/abf/387/abf-387_20260902T162004.mp4",
		});
	});

	// VR 系列（如 SIVR）详情页无 mgstage 媒体，预览为 media.javtrailers.com 的 vrsample MP4
	it("extracts media.javtrailers.com mp4 as trailer fallback when mgstage absent", () => {
		const html =
			'<video id="trailerVideo" controls><source src="https://media.javtrailers.com/vrsample/s/siv/sivr00513/sivr00513vrlite.mp4" type="video/mp4"></video>';
		expect(parseDetailPageFallback(html)).toEqual({
			coverUrl: null,
			trailerUrl:
				"https://media.javtrailers.com/vrsample/s/siv/sivr00513/sivr00513vrlite.mp4",
		});
	});

	it("returns nulls when the page has no fallback media", () => {
		expect(parseDetailPageFallback("<html>no media here</html>")).toEqual({
			coverUrl: null,
			trailerUrl: null,
		});
		expect(parseDetailPageFallback("")).toEqual({
			coverUrl: null,
			trailerUrl: null,
		});
	});
});

describe("parseSearchPageHtml 的语言前缀", () => {
	it("无前缀的 /video/ 卡片仍能解析，且 detailUrl 一律指向 /ja/", () => {
		// 兼容性：只看卡片结构，不依赖页面语言；输出统一是日语站地址
		const html = `<div class="card-container"><a href="/video/1dldss00529" title="T"><img alt="DLDSS-529 jav"></a></div>`;
		expect(parseSearchPageHtml(html, "DLDSS-529")).toEqual({
			detailUrl: "https://javtrailers.com/ja/video/1dldss00529",
			contentId: "1dldss00529",
			title: "T",
		});
	});
});

describe("parseDetailPageMeta", () => {
	it("从真实日语详情页固件取出演者与商品発売日", () => {
		expect(parseDetailPageMeta(detailFixture)).toEqual({
			performers: ["小泉玖美"],
			releaseDate: "2026-10-01",
		});
	});

	it("出演者段落被移除后不再产出名字（不误抓関連動画区的卡片）", () => {
		const withoutCast = detailFixture.replace(/出演者：[\s\S]*?<\/p>/, "");
		// 前提：固件里関連動画区仍有 card-container 与 alt="MKCK-396 jav"
		expect(withoutCast).toContain('class="card-container"');
		expect(parseDetailPageMeta(withoutCast).performers).toEqual([]);
	});

	it("空输入与无标签页面 → 空值与 null", () => {
		expect(parseDetailPageMeta("")).toEqual({ performers: [], releaseDate: null });
		expect(parseDetailPageMeta("<html><body>empty</body></html>")).toEqual({
			performers: [],
			releaseDate: null,
		});
	});
});
