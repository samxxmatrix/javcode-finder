import { describe, expect, it } from "vitest";
import {
	buildDmmHealthUrl,
	buildDmmLookupUrl,
	formatDmmError,
	parseDmmLookupError,
	parseDmmLookupResponse,
	readDmmLookupResponse,
} from "../src/lib/dmm";

describe("buildDmmLookupUrl", () => {
	it("joins base URL with code, normalizing trailing slash", () => {
		expect(
			buildDmmLookupUrl("https://dmm.0045.kdns.fr/", "my-key", "BDSM-091"),
		).toBe("https://dmm.0045.kdns.fr/BDSM-091?key=my-key");
		expect(
			buildDmmLookupUrl("https://dmm.0045.kdns.fr", "my-key", "IPX-118"),
		).toBe("https://dmm.0045.kdns.fr/IPX-118?key=my-key");
	});

	it("URL-encodes the code", () => {
		expect(
			buildDmmLookupUrl("https://dmm.0045.kdns.fr", "k", "ABP 123"),
		).toBe("https://dmm.0045.kdns.fr/ABP%20123?key=k");
	});

	it("returns empty string when base URL is empty", () => {
		expect(buildDmmLookupUrl("", "k", "BDSM-091")).toBe("");
	});
});

describe("buildDmmHealthUrl", () => {
	it("uses the cid-only endpoint", () => {
		expect(
			buildDmmHealthUrl("https://dmm.0045.kdns.fr/", "my-key", "BDSM-091"),
		).toBe("https://dmm.0045.kdns.fr/cid/BDSM-091?key=my-key");
	});
});

describe("parseDmmLookupResponse", () => {
	const full = {
		code: "BDSM-091",
		cid: "h_1096bdsm00091",
		channel: "digital",
		title: "背徳の変態願望…",
		short_title: "緊縛哀犬夫人 宮西ひかる",
		cover_url: "https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1096bdsm00091/h_1096bdsm00091pl.jpg",
		preview_url: "https://cc3001.dmm.co.jp/pv/xxx/h_1096bdsm091hhbs.mp4",
		detail_url: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=h_1096bdsm00091/",
		cached: false,
	};

	it("extracts all fields from a full response", () => {
		expect(parseDmmLookupResponse(full)).toEqual({
			cid: "h_1096bdsm00091",
			channel: "digital",
			title: "背徳の変態願望…",
			shortTitle: "緊縛哀犬夫人 宮西ひかる",
			coverUrl:
				"https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/h_1096bdsm00091/h_1096bdsm00091pl.jpg",
			previewUrl: "https://cc3001.dmm.co.jp/pv/xxx/h_1096bdsm091hhbs.mp4",
			detailUrl:
				"https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=h_1096bdsm00091/",
		});
	});

	it("accepts null title/preview/cover", () => {
		expect(
			parseDmmLookupResponse({
				code: "X-1",
				cid: "x00001",
				channel: "digital",
				title: null,
				short_title: null,
				cover_url: null,
				preview_url: null,
				detail_url: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=x00001/",
			})?.title,
		).toBeNull();
	});

	it("returns null when cid is missing or not a string", () => {
		expect(parseDmmLookupResponse({ ...full, cid: undefined })).toBeNull();
		expect(parseDmmLookupResponse({ ...full, cid: 123 })).toBeNull();
		expect(parseDmmLookupResponse(null)).toBeNull();
		expect(parseDmmLookupResponse({})).toBeNull();
	});
});

describe("formatDmmError", () => {
	it("formats error code and message from the response body", () => {
		expect(
			formatDmmError(401, {
				code: 40101,
				error: "MISSING_API_KEY",
				message: "API Key is missing.",
			}),
		).toBe("DMM 接口错误 [40101]：API Key is missing.");
	});

	it("falls back to HTTP status when body has no message", () => {
		expect(formatDmmError(500, null)).toBe("DMM 接口错误：HTTP 500");
		expect(formatDmmError(404, {})).toBe("DMM 接口错误：HTTP 404");
	});

	it("handles status 0 (network error) without HTTP prefix", () => {
		expect(formatDmmError(0, null)).toBe("DMM 接口错误：网络错误");
	});
});

describe("parseDmmLookupError", () => {
	it("preserves the documented 401 API error fields", () => {
		expect(
			parseDmmLookupError(401, {
				code: 40101,
				error: "MISSING_API_KEY",
				message: "API Key is missing.",
			}),
		).toEqual({
			kind: "http",
			status: 401,
			code: 40101,
			error: "MISSING_API_KEY",
			message: "API Key is missing.",
		});
	});

	it("classifies documented 404 responses as no-match", () => {
		expect(
			parseDmmLookupError(404, {
				code: 40401,
				error: "ITEM_NOT_FOUND",
				message: "Item not found.",
			}),
		).toEqual({
			kind: "not_found",
			status: 404,
			code: 40401,
			error: "ITEM_NOT_FOUND",
			message: "Item not found.",
		});
		expect(
			parseDmmLookupError(200, {
				code: 40401,
				error: "ITEM_NOT_FOUND",
				message: "Item not found.",
			}).kind,
		).toBe("not_found");
	});

	it("preserves the documented 500 API error fields", () => {
		expect(
			parseDmmLookupError(500, {
				code: 50001,
				error: "INTERNAL_ERROR",
				message: "Internal server error.",
			}),
		).toEqual({
			kind: "http",
			status: 500,
			code: 50001,
			error: "INTERNAL_ERROR",
			message: "Internal server error.",
		});
	});

	it("retains the HTTP status when the error body is not JSON", () => {
		expect(parseDmmLookupError(502, null)).toEqual({
			kind: "http",
			status: 502,
		});
	});

	it("classifies status 0 as a network error", () => {
		expect(parseDmmLookupError(0, null)).toEqual({
			kind: "network",
			status: 0,
		});
	});
});

describe("readDmmLookupResponse", () => {
	it("preserves HTTP 200 as a structured API error when JSON parsing fails", async () => {
		await expect(
			readDmmLookupResponse({
				status: 200,
				json: async () => {
					throw new SyntaxError("Unexpected token");
				},
			}),
		).rejects.toEqual({
			source: "dmm",
			kind: "api",
			status: 200,
		});
	});

	it("treats valid JSON without a cid as no-match", async () => {
		await expect(
			readDmmLookupResponse({
				status: 200,
				json: async () => ({ title: "No cid" }),
			}),
		).resolves.toBeNull();
	});
});
