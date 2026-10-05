import { describe, expect, it } from "vitest";
import {
	parseD2passLookupError,
	parseD2passLookupResponse,
	readD2passLookupResponse,
} from "../src/lib/d2pass";

const full = {
	code: "HEYZO-3953",
	class: "uncensored",
	title: "ダイナマイトボディとエロそうな顔立ち…",
	short_title: "ナイスバディな熟美女と濃密4P",
	cover_url: "https://images.d2pass.com/images/meta/movies/flash/226138.webp",
	cover_url_alt: "https://www.heyzo.com/contents/3000/3953/images/1.jpg",
	preview_url: "https://smovie.heyzo.com/contents/3000/3953/sample_low.mp4",
	preview_type: "mp4",
	preview_quality: "480p",
	actress: "黛カレン",
	d2pass_url: "https://www.d2pass.com/product/movies/226138",
	cached: false,
};

describe("parseD2passLookupResponse", () => {
	it("字段口径：short_title 是金色行的标题、title 是灰色行的剧情", () => {
		expect(parseD2passLookupResponse(full)).toEqual({
			code: "HEYZO-3953",
			title: "ダイナマイトボディとエロそうな顔立ち…",
			shortTitle: "ナイスバディな熟美女と濃密4P",
			coverUrl:
				"https://images.d2pass.com/images/meta/movies/flash/226138.webp",
			previewUrl: "https://smovie.heyzo.com/contents/3000/3953/sample_low.mp4",
			previewType: "mp4",
			detailUrl: "https://www.d2pass.com/product/movies/226138",
		});
	});

	it("封面次选 cover_url_alt；d2pass_url 缺失时为 null", () => {
		const parsed = parseD2passLookupResponse({
			...full,
			cover_url: null,
			d2pass_url: null,
		});
		expect(parsed?.coverUrl).toBe(
			"https://www.heyzo.com/contents/3000/3953/images/1.jpg",
		);
		expect(parsed?.detailUrl).toBeNull();
	});

	it("code 缺失或非字符串时返回 null（与 DMM 的 cid 口径一致）", () => {
		expect(parseD2passLookupResponse({ ...full, code: undefined })).toBeNull();
		expect(parseD2passLookupResponse({ ...full, code: 123 })).toBeNull();
		expect(parseD2passLookupResponse(null)).toBeNull();
		expect(parseD2passLookupResponse({})).toBeNull();
	});

	it("不映射 actress 与 class（面板不展示这两项）", () => {
		const parsed = parseD2passLookupResponse(full);
		expect(parsed).not.toBeNull();
		expect(Object.keys(parsed as object).sort()).toEqual([
			"code",
			"coverUrl",
			"detailUrl",
			"previewType",
			"previewUrl",
			"shortTitle",
			"title",
		]);
	});

	it("cover_url_alt 是协议相对地址时补 https:", () => {
		const parsed = parseD2passLookupResponse({
			...full,
			cover_url: null,
			cover_url_alt: "//www.heyzo.com/contents/3000/3953/images/1.jpg",
		});
		expect(parsed?.coverUrl).toBe(
			"https://www.heyzo.com/contents/3000/3953/images/1.jpg",
		);
	});

	it("preview_type 非 mp4/hls 时归一化成 null", () => {
		expect(
			parseD2passLookupResponse({ ...full, preview_type: "webm" })?.previewType,
		).toBeNull();
	});
});

describe("parseD2passLookupError", () => {
	it("404 ITEM_NOT_FOUND（含 class 早退）是查无，不进 errors", () => {
		expect(
			parseD2passLookupError(404, {
				code: 40401,
				error: "ITEM_NOT_FOUND",
				message: "Item not found.",
				class: "censored",
			}),
		).toEqual({
			kind: "not_found",
			status: 404,
			code: 40401,
			error: "ITEM_NOT_FOUND",
			message: "Item not found.",
		});
	});

	it("503 SOURCE_UNAVAILABLE 是接口错误，绝不降级成查无", () => {
		expect(
			parseD2passLookupError(503, {
				code: 50301,
				error: "SOURCE_UNAVAILABLE",
				message: "Upstream unavailable.",
			}),
		).toEqual({
			kind: "api",
			status: 503,
			code: 50301,
			error: "SOURCE_UNAVAILABLE",
			message: "Upstream unavailable.",
		});
	});

	it("401 / 403 / 429 都按接口错误并带上 code 与 message", () => {
		expect(
			parseD2passLookupError(403, {
				code: 40301,
				error: "INVALID_API_KEY",
				message: "API Key is invalid.",
			}),
		).toEqual({
			kind: "api",
			status: 403,
			code: 40301,
			error: "INVALID_API_KEY",
			message: "API Key is invalid.",
		});
		expect(parseD2passLookupError(429, { code: 42901 }).kind).toBe("api");
		expect(parseD2passLookupError(401, { code: 40101 }).kind).toBe("api");
	});

	it("状态码 0 = 网络层错误；其余非 2xx 沿用 DMM 的 http 口径", () => {
		expect(parseD2passLookupError(0, null)).toEqual({
			kind: "network",
			status: 0,
		});
		expect(parseD2passLookupError(502, null)).toEqual({
			kind: "http",
			status: 502,
		});
	});
});

describe("readD2passLookupResponse", () => {
	it("JSON 解析失败按接口错误处理（source 标成 d2pass）", async () => {
		await expect(
			readD2passLookupResponse({
				status: 200,
				json: async () => {
					throw new SyntaxError("Unexpected token");
				},
			}),
		).rejects.toEqual({ source: "d2pass", kind: "api", status: 200 });
	});

	it("没有 code 的合法 JSON 当查无（返回 null）", async () => {
		await expect(
			readD2passLookupResponse({
				status: 200,
				json: async () => ({ title: "no code here" }),
			}),
		).resolves.toBeNull();
	});

	it("错误形状的响应体（带 error/message）按接口错误抛出，不当查无", async () => {
		await expect(
			readD2passLookupResponse({
				status: 200,
				json: async () => ({ error: "INTERNAL_SERVER_ERROR", message: "boom" }),
			}),
		).rejects.toEqual({
			source: "d2pass",
			kind: "api",
			status: 200,
			error: "INTERNAL_SERVER_ERROR",
			message: "boom",
		});
	});

	it("50301 的响应体即使 HTTP 200 也按接口错误抛出", async () => {
		await expect(
			readD2passLookupResponse({
				status: 200,
				json: async () => ({
					code: 50301,
					error: "SOURCE_UNAVAILABLE",
					message: "Upstream unavailable.",
				}),
			}),
		).rejects.toEqual({
			source: "d2pass",
			kind: "api",
			status: 200,
			code: 50301,
			error: "SOURCE_UNAVAILABLE",
			message: "Upstream unavailable.",
		});
	});
});
