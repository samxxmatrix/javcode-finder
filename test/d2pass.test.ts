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
		// 判据：意图断言「不产出 actress/class」，而不是逐字段比对键集合。
		// 逐字段比对（Object.keys 精确 7 项）的独有价值只有"抓值被显式赋成 undefined
		// 的多余字段"，代价却是给 D2passLookupData 加任何合法字段都会误报红；
		// not.toHaveProperty 对 { actress: undefined } 这种显式赋 undefined 仍会失败，
		// 独有价值不丢，对不存在的键正常通过。
		const parsed = parseD2passLookupResponse(full);
		expect(parsed).not.toBeNull();
		expect(parsed).not.toHaveProperty("actress");
		expect(parsed).not.toHaveProperty("class");
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

	it("矛盾组合（404 + 50301 SOURCE_UNAVAILABLE）取 fail-safe 方向：api 而非 not_found", () => {
		// 守 d2pass.ts:82-84 的不变量：api（故障）优先于 not_found（查无）。
		// 判成 not_found 会让上游不写 errors、不置 failed，落进"此号无预告片"终态并负缓存，
		// 源站恢复也不重查；还会诱导路由退到分隔符兄弟番号。
		const result = parseD2passLookupError(404, {
			code: 50301,
			error: "SOURCE_UNAVAILABLE",
			message: "Upstream unavailable.",
		});
		expect(result.kind).toBe("api");
		expect(result.kind).not.toBe("not_found");
	});

	it("矛盾组合（503 + 40401 ITEM_NOT_FOUND）取 fail-safe 方向：api 而非 not_found", () => {
		// 反方向同样必须钉住：变异实验显示"只留 code === 40401"这类改法在单向下仍全绿，
		// 只测一个方向不足以守住判定顺序。
		const result = parseD2passLookupError(503, {
			code: 40401,
			error: "ITEM_NOT_FOUND",
			message: "Item not found.",
		});
		expect(result.kind).toBe("api");
		expect(result.kind).not.toBe("not_found");
	});

	it("响应体不是 JSON（body = null）时只能靠状态码分类", () => {
		// 生产承重：Task 12 的 lookupD2pass 在 body 解析失败时传 data = null，
		// 此时分类只能靠状态码，这三条是唯一防线。
		expect(parseD2passLookupError(404, null).kind).toBe("not_found");
		expect(parseD2passLookupError(403, null).kind).toBe("api");
		expect(parseD2passLookupError(503, null).kind).toBe("api");
	});

	it("状态码不在表里但 error 字符串命中接口错误表时仍是 api", () => {
		// 零覆盖补网：例如代理把 503 的响应体配成 502 时，error 字符串是唯一防线。
		const result = parseD2passLookupError(502, {
			error: "SOURCE_UNAVAILABLE",
		});
		expect(result.kind).toBe("api");
	});

	it("code 的 number 与 string 两种写法都识别为接口错误", () => {
		// 接口契约里 code 恒为 number，但实现同时收字符串形式；
		// 既然收两种写法就把它钉住（50001 的字符串形式原先无覆盖）。
		for (const code of [40101, 40301, 42901, 50301, 50001]) {
			expect(parseD2passLookupError(500, { code }).kind).toBe("api");
			expect(parseD2passLookupError(500, { code: `${code}` }).kind).toBe("api");
		}
	});

	it("status 0 最优先：网络错误不能被响应体里的 code 伪装成查无", () => {
		// 判定顺序里 status === 0 排在 apiLike / notFound 之前，这条钉住该优先级。
		expect(parseD2passLookupError(0, { code: 40401 }).kind).toBe("network");
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

	it("200 + 40401 ITEM_NOT_FOUND 的早退响应体按查无返回 null（不抛错）", async () => {
		// 守读取层的 not_found 守卫（`if (apiError.kind !== "not_found")`）：
		// 把它改成 `if (true)` 时只有这条会变红。同时是分类顺序改动的安全网 ——
		// 40401 命中 notFound 但不命中 apiLike，改成 api 优先后仍应返回 null。
		await expect(
			readD2passLookupResponse({
				status: 200,
				json: async () => ({
					code: 40401,
					error: "ITEM_NOT_FOUND",
					message: "Item not found.",
				}),
			}),
		).resolves.toBeNull();
	});
});
