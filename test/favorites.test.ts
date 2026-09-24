import { describe, expect, it } from "vitest";
import {
	buildBasicAuth,
	classifyWebdavVerify,
	isFavorite,
	joinWebdavUrl,
	parseFavorites,
	serializeFavorites,
	toggleFavorite,
} from "../src/lib/favorites";

describe("toggleFavorite", () => {
	it("adds a code that is not in the list", () => {
		expect(toggleFavorite(["ABC-001"], "XYZ-002")).toEqual([
			"ABC-001",
			"XYZ-002",
		]);
	});

	it("removes a code that is already in the list", () => {
		expect(toggleFavorite(["ABC-001", "XYZ-002"], "ABC-001")).toEqual([
			"XYZ-002",
		]);
	});
});

describe("isFavorite", () => {
	it("checks membership", () => {
		expect(isFavorite(["ABC-001"], "ABC-001")).toBe(true);
		expect(isFavorite(["ABC-001"], "XYZ-002")).toBe(false);
	});
});

describe("serializeFavorites", () => {
	it("wraps codes in a versioned object", () => {
		expect(JSON.parse(serializeFavorites(["ABC-001", "XYZ-002"]))).toEqual({
			version: 1,
			codes: ["ABC-001", "XYZ-002"],
		});
	});
});

describe("parseFavorites", () => {
	it("extracts codes from a valid payload", () => {
		expect(
			parseFavorites({ version: 1, codes: ["ABC-001", "XYZ-002"] }),
		).toEqual(["ABC-001", "XYZ-002"]);
	});

	it("returns empty list for malformed payloads", () => {
		expect(parseFavorites(null)).toEqual([]);
		expect(parseFavorites({})).toEqual([]);
		expect(parseFavorites({ version: 1, codes: "nope" })).toEqual([]);
	});
});

describe("joinWebdavUrl", () => {
	it("appends favorites.json with a single slash", () => {
		expect(
			joinWebdavUrl("https://dav.jianguoyun.com/dav/javcodefinder"),
		).toBe("https://dav.jianguoyun.com/dav/javcodefinder/favorites.json");
		expect(
			joinWebdavUrl("https://dav.jianguoyun.com/dav/javcodefinder/"),
		).toBe("https://dav.jianguoyun.com/dav/javcodefinder/favorites.json");
		expect(
			joinWebdavUrl("https://dav.jianguoyun.com/dav/javcodefinder//"),
		).toBe("https://dav.jianguoyun.com/dav/javcodefinder/favorites.json");
	});
});

describe("buildBasicAuth", () => {
	it("encodes ASCII credentials", () => {
		expect(buildBasicAuth("user", "pass")).toBe(`Basic ${btoa("user:pass")}`);
	});

	it("encodes non-ASCII credentials as UTF-8", () => {
		const header = buildBasicAuth("用户", "密码");
		const decoded = new TextDecoder().decode(
			Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)),
		);
		expect(decoded).toBe("用户:密码");
	});
});

describe("classifyWebdavVerify", () => {
	it("maps Multi-Status to ok", () => {
		expect(classifyWebdavVerify(207)).toBe("ok");
	});

	it("maps auth failure", () => {
		expect(classifyWebdavVerify(401)).toBe("auth");
	});

	it("maps missing path", () => {
		expect(classifyWebdavVerify(404)).toBe("not_found");
	});

	it("maps rate limiting", () => {
		expect(classifyWebdavVerify(403)).toBe("rate_limited");
		expect(classifyWebdavVerify(429)).toBe("rate_limited");
	});

	it("maps anything else (including network errors) to failed", () => {
		expect(classifyWebdavVerify(0)).toBe("failed");
		expect(classifyWebdavVerify(500)).toBe("failed");
	});
});
