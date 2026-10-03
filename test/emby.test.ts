import { describe, expect, it } from "vitest";
import {
	EMBY_PAGE_SIZE,
	buildEmbyItemsUrl,
	buildEmbySearchUrl,
	normalizeEmbyBaseUrl,
	parseEmbyItems,
} from "../src/lib/emby";

describe("normalizeEmbyBaseUrl", () => {
	it("去掉尾斜杠与路径，只保留 origin", () => {
		expect(normalizeEmbyBaseUrl("http://192.168.0.50:8096/")).toBe(
			"http://192.168.0.50:8096",
		);
		expect(
			normalizeEmbyBaseUrl("  http://192.168.0.50:8096/web/index.html  "),
		).toBe("http://192.168.0.50:8096");
		expect(normalizeEmbyBaseUrl("https://emby.example.com")).toBe(
			"https://emby.example.com",
		);
	});

	it("缺少协议时按 http 补全", () => {
		expect(normalizeEmbyBaseUrl("192.168.0.50:8096")).toBe(
			"http://192.168.0.50:8096",
		);
	});

	it("非 http(s)、非法主机或空值返回空串", () => {
		expect(normalizeEmbyBaseUrl("")).toBe("");
		expect(normalizeEmbyBaseUrl("ftp://x")).toBe("");
		expect(normalizeEmbyBaseUrl("not a url")).toBe("");
	});
});

describe("buildEmbyItemsUrl", () => {
	it("构造分页查询 URL", () => {
		const url = buildEmbyItemsUrl("http://192.168.0.50:8096", "KEY", {
			startIndex: 2000,
		});
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/emby/Items");
		expect(parsed.searchParams.get("api_key")).toBe("KEY");
		expect(parsed.searchParams.get("Recursive")).toBe("true");
		expect(parsed.searchParams.get("IncludeItemTypes")).toBe("Movie,Folder");
		expect(parsed.searchParams.get("Fields")).toBe("Path");
		expect(parsed.searchParams.get("EnableImages")).toBe("false");
		expect(parsed.searchParams.get("EnableUserData")).toBe("false");
		expect(parsed.searchParams.get("Limit")).toBe(String(EMBY_PAGE_SIZE));
		expect(parsed.searchParams.get("StartIndex")).toBe("2000");
		expect(parsed.searchParams.get("MinDateLastSaved")).toBeNull();
	});

	it("增量查询带 MinDateLastSaved；缺地址或 Key 返回空串", () => {
		const url = buildEmbyItemsUrl("http://h:8096", "KEY", {
			minDateLastSaved: "2026-10-03T00:00:00.000Z",
		});
		expect(new URL(url).searchParams.get("MinDateLastSaved")).toBe(
			"2026-10-03T00:00:00.000Z",
		);
		expect(buildEmbyItemsUrl("", "KEY")).toBe("");
		expect(buildEmbyItemsUrl("http://h:8096", "")).toBe("");
	});
});

describe("buildEmbySearchUrl", () => {
	it("逐条兜底查询带 SearchTerm 与 Limit", () => {
		const url = buildEmbySearchUrl("http://h:8096", "KEY", "JUL-769");
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/emby/Items");
		expect(parsed.searchParams.get("SearchTerm")).toBe("JUL-769");
		expect(parsed.searchParams.get("IncludeItemTypes")).toBe("Movie,Folder");
		expect(parsed.searchParams.get("Limit")).toBe("5");
	});
});

describe("parseEmbyItems", () => {
	it("解析正常响应", () => {
		expect(
			parseEmbyItems({ Items: [{ Name: "JUL-769" }], TotalRecordCount: 1 }),
		).toEqual({ items: [{ Name: "JUL-769" }], total: 1 });
	});

	it("Items 缺失或非数组返回 null", () => {
		expect(parseEmbyItems(null)).toBeNull();
		expect(parseEmbyItems({ TotalRecordCount: 0 })).toBeNull();
		expect(parseEmbyItems({ Items: "x" })).toBeNull();
	});

	it("TotalRecordCount 缺失时回退为条目数", () => {
		expect(parseEmbyItems({ Items: [{}, {}] })).toEqual({
			items: [{}, {}],
			total: 2,
		});
	});
});
