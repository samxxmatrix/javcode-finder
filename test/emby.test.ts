import { describe, expect, it } from "vitest";
import {
	EMBY_INDEX_LIMIT,
	EMBY_PAGE_SIZE,
	buildEmbyIndexKeys,
	buildEmbyItemsUrl,
	buildEmbySearchUrl,
	codeKeyA,
	codeKeyB,
	extractKeysFromItem,
	keysForCode,
	normalizeEmbyBaseUrl,
	parseEmbyItems,
} from "../src/lib/emby";
import { extractCandidatesFromText } from "../src/lib/extract-codes";
import { DEFAULT_CODE_REGEX } from "../src/lib/settings";

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

	it("去掉主机名尾点，保证带点与不带点是同一个 origin", () => {
		expect(normalizeEmbyBaseUrl("emby.local.")).toBe("http://emby.local");
		expect(normalizeEmbyBaseUrl("http://emby.local.:8096/")).toBe(
			"http://emby.local:8096",
		);
		expect(normalizeEmbyBaseUrl("emby.local.")).toBe(
			normalizeEmbyBaseUrl("emby.local"),
		);
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

	it("limit 超过索引上限视为非法并回退分页大小", () => {
		const withQuery = (query: { limit?: number }): URL =>
			new URL(buildEmbyItemsUrl("http://h:8096", "K", query));
		expect(
			withQuery({ limit: EMBY_INDEX_LIMIT }).searchParams.get("Limit"),
		).toBe(String(EMBY_INDEX_LIMIT));
		expect(
			withQuery({ limit: EMBY_INDEX_LIMIT + 1 }).searchParams.get("Limit"),
		).toBe(String(EMBY_PAGE_SIZE));
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

	it("TotalRecordCount 为负数或非整数时记为 null（只有非负整数才采用）", () => {
		expect(parseEmbyItems({ Items: [], TotalRecordCount: -5 })).toEqual({
			items: [],
			total: null,
		});
		expect(parseEmbyItems({ Items: [], TotalRecordCount: 1.5 })).toEqual({
			items: [],
			total: null,
		});
	});
});

describe("番号键", () => {
	it("keyA 去分隔符，keyB 按数字串去前导零", () => {
		expect(codeKeyA("jul_769")).toBe("JUL769");
		expect(codeKeyB("jul_769")).toBe("JUL769");

		expect(codeKeyA("HEYZO-0406")).toBe("HEYZO0406");
		expect(codeKeyB("HEYZO-0406")).toBe("HEYZO406");
		expect(codeKeyB("HEYZO-406")).toBe("HEYZO406");

		// 前缀自带数字：S2M-033
		expect(codeKeyA("S2M-033")).toBe("S2M033");
		expect(codeKeyB("S2M-033")).toBe("S2M33");
		expect(codeKeyB("S2M-33")).toBe("S2M33");

		// 多数字段：T38-072
		expect(codeKeyA("T38-072")).toBe("T38072");
		expect(codeKeyB("T38-072")).toBe("T3872");
		expect(codeKeyB("T38-72")).toBe("T3872");

		// 无分隔符写法
		expect(codeKeyB("JUL00769")).toBe("JUL769");
	});

	it("keyA 与 keyB 相同时只返回一个键", () => {
		expect(keysForCode("JUL-769")).toEqual(["JUL769"]);
		expect(keysForCode("HEYZO-0406").sort()).toEqual(["HEYZO0406", "HEYZO406"]);
	});

	it("超过 64 字符或空值的候选不生成键", () => {
		expect(keysForCode("A".repeat(70))).toEqual([]);
		expect(keysForCode("   ")).toEqual([]);
	});
});

describe("extractKeysFromItem", () => {
	it("逐字段抽取：Name/FileName/Path 上的号都能取到", () => {
		const keys = extractKeysFromItem({
			Name: "JUL-769 意志坚强…",
			FileName: "jul-769-C.mp4",
			Path: "/mnt/media/TV/_pikpak/jul-769-C.mp4",
		});
		expect(keys).toContain("JUL769");
	});

	it("下划线先归一为连字符才可被正则命中", () => {
		expect(extractKeysFromItem({ Name: "ABC_123" })).toContain("ABC123");
	});

	it("多字段不得产生跨字段伪键（正反对照）", () => {
		// 真实条目形态：Folder 的 Name 与 FileName 同为 "091326-001-CARIB"
		const folder = { Name: "091326-001-CARIB", FileName: "091326-001-CARIB" };

		// 逐字段：数字开头，抽取层抽不到 → 无键（这是实现必须保持的行为）
		expect(extractKeysFromItem(folder)).toEqual([]);

		// 反向对照：把同一批字段拼成一个大串，边界处会造出并不存在的番号
		const joined = extractCandidatesFromText(
			`${folder.Name} ${folder.FileName}`.replace(/_/g, "-"),
			DEFAULT_CODE_REGEX,
		).candidates;
		expect(joined.map(codeKeyA)).toContain("CARIB091326");
	});

	it("数字开头 / 数字段不足 3 位 / 含字母的番号抽不到（已知限制）", () => {
		expect(extractKeysFromItem({ Name: "091926-001-CARIB" })).toEqual([]);
		expect(extractKeysFromItem({ Name: "SHD-13 小峰由衣" })).toEqual([]);
		expect(extractKeysFromItem({ Name: "MK-S89 KIRARI 89" })).toEqual([]);
	});
});

describe("buildEmbyIndexKeys", () => {
	it("合并去重", () => {
		const keys = buildEmbyIndexKeys([
			{ Name: "JUL-769 甲" },
			{ Name: "jul-769 乙" },
			{ Name: "HEYZO-0406 丙" },
		]);
		expect(keys).toContain("JUL769");
		expect(keys).toContain("HEYZO0406");
		expect(keys).toContain("HEYZO406");
		expect(new Set(keys).size).toBe(keys.length);
	});
});
