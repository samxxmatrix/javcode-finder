import { describe, expect, it } from "vitest";
import {
	buildFc2CoverThumbUrl,
	buildFc2DetailUrl,
	buildFc2EmbedUrl,
	buildFc2SampleUrl,
	fc2ArticleId,
	parseFc2EmbedHtml,
	parseFc2SampleResponse,
} from "../src/lib/fc2";

describe("fc2ArticleId", () => {
	it("extracts the article id from every supported FC2 spelling", () => {
		expect(fc2ArticleId("FC2-4942266")).toBe("4942266");
		expect(fc2ArticleId("FC2-PPV-4942266")).toBe("4942266");
		expect(fc2ArticleId("FC2 PPV 4942266")).toBe("4942266");
		expect(fc2ArticleId("FC2_PPV_4942266")).toBe("4942266");
		expect(fc2ArticleId("fc2ppv4942266")).toBe("4942266");
		expect(fc2ArticleId("ＦＣ２－４９４２２６６")).toBe("4942266");
	});

	it("returns null for non-FC2 codes and out-of-range digit counts", () => {
		expect(fc2ArticleId("ABP-123")).toBeNull();
		expect(fc2ArticleId("FC2-12")).toBeNull();
		expect(fc2ArticleId("FC2-123456789")).toBeNull();
		expect(fc2ArticleId("FC2PPV")).toBeNull();
		expect(fc2ArticleId("")).toBeNull();
		expect(fc2ArticleId(null)).toBeNull();
		expect(fc2ArticleId(undefined)).toBeNull();
	});
});

describe("FC2 url builders", () => {
	it("builds the public sample API url", () => {
		expect(buildFc2SampleUrl("4942266")).toBe(
			"https://adult.contents.fc2.com/api/v2/videos/4942266/sample",
		);
	});

	it("builds the embed and detail urls", () => {
		expect(buildFc2EmbedUrl("4942266")).toBe(
			"https://adult.contents.fc2.com/embed/4942266/",
		);
		expect(buildFc2DetailUrl("4942266")).toBe(
			"https://adult.contents.fc2.com/article/4942266/",
		);
	});
});

describe("buildFc2CoverThumbUrl", () => {
	const png =
		"https://storage201000.contents.fc2.com/file/381/38031442/1787814402.31.png";

	it("rewrites an FC2 storage url through the thumbnail proxy at w480", () => {
		expect(buildFc2CoverThumbUrl(png)).toBe(
			"https://contents-thumbnail2.fc2.com/w480/storage201000.contents.fc2.com/file/381/38031442/1787814402.31.png",
		);
		expect(
			buildFc2CoverThumbUrl(
				"https://storage201000.contents.fc2.com/file/394/39375031/1784532659.2.jpg",
			),
		).toBe(
			"https://contents-thumbnail2.fc2.com/w480/storage201000.contents.fc2.com/file/394/39375031/1784532659.2.jpg",
		);
	});

	it("honours an explicit width", () => {
		expect(buildFc2CoverThumbUrl(png, 640)).toContain("/w640/");
		expect(buildFc2CoverThumbUrl(png, 320)).toContain("/w320/");
	});

	it("leaves non-storage hosts and empty input untouched", () => {
		expect(
			buildFc2CoverThumbUrl("https://adult.contents.fc2.com/api/v2/videos/1"),
		).toBe("https://adult.contents.fc2.com/api/v2/videos/1");
		expect(buildFc2CoverThumbUrl("https://example.com/a.png")).toBe(
			"https://example.com/a.png",
		);
		expect(buildFc2CoverThumbUrl("")).toBe("");
	});
});

describe("parseFc2SampleResponse", () => {
	const ok = {
		path: "https://vip-videoprem44000.fc2.com/up/202607/08/V/z/11e4d0d9e0975ad0.mp4?mid=abc",
		poster_image_path: "https://storage201000.contents.fc2.com/file/a.jpg",
		code: 200,
	};

	it("accepts a code=200 payload and returns the cover via the thumbnail proxy", () => {
		expect(parseFc2SampleResponse(ok)).toEqual({
			previewUrl: ok.path,
			coverUrl:
				"https://contents-thumbnail2.fc2.com/w480/storage201000.contents.fc2.com/file/a.jpg",
		});
	});

	it("keeps the preview but drops a non-https or malformed cover", () => {
		expect(
			parseFc2SampleResponse({ ...ok, poster_image_path: "http://x/y.jpg" }),
		).toEqual({ previewUrl: ok.path, coverUrl: null });
		expect(
			parseFc2SampleResponse({ ...ok, poster_image_path: 42 }),
		).toEqual({ previewUrl: ok.path, coverUrl: null });
		expect(parseFc2SampleResponse({ ...ok, poster_image_path: null })).toEqual({
			previewUrl: ok.path,
			coverUrl: null,
		});
	});

	it("fails closed when the payload is not a usable sample", () => {
		expect(parseFc2SampleResponse({ code: 400 })).toBeNull();
		// 实测"无此片"有两种信号：HTTP 400 + {code:400}，以及 HTTP 200 + {path:501}
		// （后者 path 是数字哨兵值而非 URL，必须被 isHttpsUrl 挡下，不能交给 <video>）
		expect(parseFc2SampleResponse({ path: 501, code: 200 })).toBeNull();
		expect(parseFc2SampleResponse({ path: 0, code: 200 })).toBeNull();
		expect(parseFc2SampleResponse({ ...ok, code: 500 })).toBeNull();
		expect(parseFc2SampleResponse({ ...ok, path: undefined })).toBeNull();
		expect(parseFc2SampleResponse({ ...ok, path: "" })).toBeNull();
		expect(parseFc2SampleResponse({ ...ok, path: 123 })).toBeNull();
		expect(
			parseFc2SampleResponse({
				...ok,
				path: "http://vip-videoprem44000.fc2.com/cut.mp4",
			}),
		).toBeNull();
		expect(parseFc2SampleResponse(null)).toBeNull();
		expect(parseFc2SampleResponse(undefined)).toBeNull();
		expect(parseFc2SampleResponse("nope")).toBeNull();
	});
});

describe("parseFc2EmbedHtml", () => {
	it("reads data-vid and decodes the title entities", () => {
		expect(
			parseFc2EmbedHtml(
				'<div data-vid="20260928auRttRRS" data-title="A&amp;B &#39;C&#39; &quot;D&quot;"></div>',
			),
		).toEqual({
			contentId: "20260928auRttRRS",
			title: 'A&B \'C\' "D"',
		});
	});

	it("keeps whichever attribute is present", () => {
		expect(parseFc2EmbedHtml('<div data-vid="v1"></div>')).toEqual({
			contentId: "v1",
			title: null,
		});
		expect(parseFc2EmbedHtml('<div data-title="T"></div>')).toEqual({
			contentId: null,
			title: "T",
		});
	});

	it("returns null when neither attribute exists (FC2 not-found page)", () => {
		expect(parseFc2EmbedHtml("<html><body>not found</body></html>")).toBeNull();
		expect(parseFc2EmbedHtml("")).toBeNull();
	});
});
