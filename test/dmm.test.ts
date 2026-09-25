import { describe, expect, it } from "vitest";
import {
	buildDmmHealthUrl,
	buildDmmLookupUrl,
	formatDmmError,
	parseDmmLookupResponse,
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
