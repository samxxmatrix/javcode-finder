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

	it("主机名逐标签校验：空标签与首尾连字符非法，下划线与 IPv6 合法", () => {
		expect(normalizeEmbyBaseUrl(".")).toBe("");
		expect(normalizeEmbyBaseUrl("..")).toBe("");
		expect(normalizeEmbyBaseUrl(".emby.local")).toBe("");
		expect(normalizeEmbyBaseUrl("a..b.com")).toBe("");
		expect(normalizeEmbyBaseUrl("http://-bad-.com")).toBe("");
		expect(normalizeEmbyBaseUrl("emby_server:8096")).toBe(
			"http://emby_server:8096",
		);
		expect(normalizeEmbyBaseUrl("http://[::1]:8096/")).toBe(
			"http://[::1]:8096",
		);
	});

	it("丢弃路径、查询串与片段", () => {
		expect(
			normalizeEmbyBaseUrl("http://192.168.0.50:8096/web/index.html?x=1#y"),
		).toBe("http://192.168.0.50:8096");
	});

	it("主机名统一小写", () => {
		expect(normalizeEmbyBaseUrl("https://EMBY.Example.COM")).toBe(
			"https://emby.example.com",
		);
	});

	it("纯空白输入返回空串", () => {
		expect(normalizeEmbyBaseUrl("   ")).toBe("");
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

	it("api_key 做百分号转义（+ / = 不被误解析）", () => {
		const url = buildEmbyItemsUrl("http://h:8096", "k+y/=");
		expect(new URL(url).searchParams.get("api_key")).toBe("k+y/=");
		expect(url).toContain("api_key=k%2By%2F%3D");
	});

	it("限量参数越界时回退默认值", () => {
		const withQuery = (query: { limit?: number; startIndex?: number }): URL =>
			new URL(buildEmbyItemsUrl("http://h:8096", "K", query));
		expect(withQuery({ limit: 5 }).searchParams.get("Limit")).toBe("5");
		expect(withQuery({ limit: 0 }).searchParams.get("Limit")).toBe(
			String(EMBY_PAGE_SIZE),
		);
		expect(withQuery({ limit: -1 }).searchParams.get("Limit")).toBe(
			String(EMBY_PAGE_SIZE),
		);
		expect(withQuery({ startIndex: -5 }).searchParams.get("StartIndex")).toBe(
			"0",
		);
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

	it("SearchTerm 做百分号转义", () => {
		const url = buildEmbySearchUrl("http://h:8096", "KEY", "a&b=c");
		expect(new URL(url).searchParams.get("SearchTerm")).toBe("a&b=c");
		expect(url).toContain("SearchTerm=a%26b%3Dc");
	});

	it("缺地址、缺 Key 或空白番号返回空串", () => {
		expect(buildEmbySearchUrl("", "KEY", "JUL-769")).toBe("");
		expect(buildEmbySearchUrl("http://h:8096", "", "JUL-769")).toBe("");
		expect(buildEmbySearchUrl("http://h:8096", "KEY", "   ")).toBe("");
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

	it("TotalRecordCount 缺失时记为 null（未知）", () => {
		expect(parseEmbyItems({ Items: [{}, {}] })).toEqual({
			items: [{}, {}],
			total: null,
		});
	});

	it("过滤 null、字符串与数组条目", () => {
		expect(
			parseEmbyItems({ Items: [null, "x", [], { Name: "JUL-769" }] }),
		).toEqual({ items: [{ Name: "JUL-769" }], total: null });
	});

	it("TotalRecordCount 非数字时记为 null", () => {
		expect(parseEmbyItems({ Items: [], TotalRecordCount: "9" })).toEqual({
			items: [],
			total: null,
		});
	});
});
