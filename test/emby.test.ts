import { describe, expect, it } from "vitest";
import {
	EMBY_FULL_SYNC_INTERVAL_MS,
	EMBY_INDEX_LIMIT,
	EMBY_INDEX_TTL_MS,
	EMBY_PAGE_SIZE,
	buildEmbyIndexKeys,
	buildEmbyItemsUrl,
	buildEmbySearchUrl,
	codeKeyA,
	codeKeyB,
	embyRegexKey,
	embyServerKey,
	extractKeysFromItem,
	fingerprint,
	incrementalSince,
	isEmbyIndexFresh,
	keysForCode,
	matchEmbyCodes,
	needsEmbyFullSync,
	normalizeEmbyBaseUrl,
	parseEmbyItems,
	verifyEmbySearchItems,
	type EmbyIndex,
	type EmbyItemLike,
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

	it("键只用于比较、不得回灌：前缀自带 0 时去零结果不再等价", () => {
		expect(codeKeyB("A0-123")).toBe("A0123");
	});

	it("keyA 与 keyB 相同时只返回一个键", () => {
		expect(keysForCode("JUL-769")).toEqual(["JUL769"]);
		expect(keysForCode("HEYZO-0406").sort()).toEqual(["HEYZO0406", "HEYZO406"]);
	});

	it("超过 64 字符或空值的候选不生成键", () => {
		expect(keysForCode("A".repeat(70))).toEqual([]);
		expect(keysForCode("   ")).toEqual([]);
		// 归一后为空串（纯分隔符）也不生成键
		expect(keysForCode("-")).toEqual([]);
	});
});

describe("extractKeysFromItem", () => {
	it("逐字段抽取：三个字段各自的番号都能取到", () => {
		const keys = extractKeysFromItem({
			Name: "AAA-100 甲",
			FileName: "bbb-200.mp4",
			Path: "/mnt/media/TV/ccc-300.mp4",
		});
		expect(keys).toContain("AAA100");
		expect(keys).toContain("BBB200");
		expect(keys).toContain("CCC300");
	});

	it("非字符串字段（数字/数组）直接跳过，不抛异常", () => {
		expect(extractKeysFromItem({ Name: 123 as unknown as string })).toEqual(
			[],
		);
		expect(
			extractKeysFromItem({ Path: ["/x"] as unknown as string }),
		).toEqual([]);
	});

	it("null/undefined 条目直接返回空数组（响应里的异常条目不得打断同步）", () => {
		expect(extractKeysFromItem(null as unknown as EmbyItemLike)).toEqual([]);
		expect(extractKeysFromItem(undefined as unknown as EmbyItemLike)).toEqual(
			[],
		);
	});

	it("自定义正则生效：默认正则抽不到的短数字段也能命中", () => {
		const pattern = String.raw`\b[A-Z]{3}-\d{2}\b`;
		expect(extractKeysFromItem({ Name: "ABC-12" }, pattern)).toEqual([
			"ABC12",
		]);
		expect(extractKeysFromItem({ Name: "ABC-12" })).toEqual([]);
	});

	it("空白正则回退默认正则", () => {
		expect(extractKeysFromItem({ Name: "JUL-769" }, "   ")).toEqual(
			extractKeysFromItem({ Name: "JUL-769" }),
		);
	});

	it("非法正则回退默认正则", () => {
		expect(extractKeysFromItem({ Name: "JUL-769" }, "([unclosed")).toEqual(
			extractKeysFromItem({ Name: "JUL-769" }),
		);
	});

	it("同一番号在多个字段重复出现时只返回一次（去重）", () => {
		expect(
			extractKeysFromItem({
				Name: "JUL-769 甲",
				FileName: "jul-769-C.mp4",
				Path: "/mnt/media/TV/jul_769-C.mp4",
			}),
		).toEqual(["JUL769"]);
	});

	it("下划线先归一为连字符才可被正则命中", () => {
		expect(extractKeysFromItem({ Name: "ABC_123" })).toContain("ABC123");
	});

	it("路径中的下划线目录名也能命中（含短伪键的已知代价）", () => {
		expect(
			extractKeysFromItem({ Path: "/mnt/media/TV/abc_123/x.mp4" }),
		).toContain("ABC123");
		// 注意：这套改写也可能从 "Season_01/ep_005/…" 造出 EP005 这类短伪键，
		// 规格 §七.4 把这类低概率假键当作已知代价接受。
		// 这里钉住实际结果：keyA=EP005，keyB 把 005 去零成 5 => EP5。
		expect(
			extractKeysFromItem({ Path: "/mnt/media/TV/Season_01/ep_005/x.mp4" }),
		).toEqual(["EP005", "EP5"]);
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

describe("matchEmbyCodes", () => {
	const keys = buildEmbyIndexKeys([
		{ Name: "JUL-769 甲" },
		{ Name: "HEYZO-0406 乙" },
	]);

	it("大小写/下划线/去零写法都能命中", () => {
		expect(matchEmbyCodes(keys, ["JUL-769"])).toEqual(new Set(["JUL-769"]));
		expect(matchEmbyCodes(keys, ["jul_769"])).toEqual(new Set(["JUL-769"]));
		expect(matchEmbyCodes(keys, ["HEYZO-406"])).toEqual(new Set(["HEYZO-406"]));
	});

	it("前缀近似不误命中", () => {
		expect(matchEmbyCodes(keys, ["JUL-76"])).toEqual(new Set());
		expect(matchEmbyCodes(keys, ["SSIS-001"])).toEqual(new Set());
	});

	it("返回的是归一化番号（与列表显示一致）", () => {
		expect(matchEmbyCodes(keys, [" jul-769 "])).toEqual(new Set(["JUL-769"]));
	});

	it("索引键以 Set 直接传入时结果一致（面板侧免去重复建集合）", () => {
		expect(matchEmbyCodes(new Set(keys), ["JUL-769"])).toEqual(
			new Set(["JUL-769"]),
		);
	});

	it("空值、纯分隔符与超长候选被忽略，也不影响其他命中", () => {
		expect(matchEmbyCodes(keys, ["   ", "-", "A".repeat(70)])).toEqual(
			new Set(),
		);
		expect(matchEmbyCodes(keys, ["   ", "JUL-769"])).toEqual(
			new Set(["JUL-769"]),
		);
	});
});

describe("同步策略判定", () => {
	const base: EmbyIndex = {
		v: 1,
		serverKey: "aaa",
		regexKey: "bbb",
		syncedAt: 1_000_000,
		total: 282,
		keys: ["JUL769"],
	};

	it("TTL 内且指纹一致 => 索引新鲜", () => {
		expect(
			isEmbyIndexFresh(base, 1_000_000 + EMBY_INDEX_TTL_MS - 1, "aaa", "bbb"),
		).toBe(true);
		expect(
			isEmbyIndexFresh(base, 1_000_000 + EMBY_INDEX_TTL_MS, "aaa", "bbb"),
		).toBe(false);
	});

	it("无索引、服务器指纹或正则指纹变化 => 不新鲜", () => {
		expect(isEmbyIndexFresh(null, 1_000_000, "aaa", "bbb")).toBe(false);
		expect(isEmbyIndexFresh(base, 1_000_000, "other", "bbb")).toBe(false);
		expect(isEmbyIndexFresh(base, 1_000_000, "aaa", "other")).toBe(false);
	});

	it("换地址或换 Key 后旧索引既不算新鲜也必须全量重建", () => {
		// 面板侧传入的是当前配置算出的 serverKey，索引里存的是旧服务器的
		expect(isEmbyIndexFresh(base, 1_000_000, "foreign", "bbb")).toBe(false);
		expect(needsEmbyFullSync(base, 1_000_000, "foreign", "bbb")).toBe(true);
	});

	it("年龄为 NaN 或未来时间 => 不新鲜且必须全量重建（不得走增量路径）", () => {
		const nanIndex: EmbyIndex = { ...base, syncedAt: Number.NaN };
		expect(isEmbyIndexFresh(nanIndex, 1_000_000, "aaa", "bbb")).toBe(false);
		expect(needsEmbyFullSync(nanIndex, 1_000_000, "aaa", "bbb")).toBe(true);

		// 时钟回拨 / NTP：syncedAt 在未来一年
		const futureIndex: EmbyIndex = {
			...base,
			syncedAt: 1_000_000 + 365 * 24 * 60 * 60 * 1000,
		};
		expect(isEmbyIndexFresh(futureIndex, 1_000_000, "aaa", "bbb")).toBe(false);
		expect(needsEmbyFullSync(futureIndex, 1_000_000, "aaa", "bbb")).toBe(true);
	});

	it("超过 24 小时、无索引或指纹变化 => 需要全量", () => {
		expect(
			needsEmbyFullSync(
				base,
				1_000_000 + EMBY_FULL_SYNC_INTERVAL_MS - 1,
				"aaa",
				"bbb",
			),
		).toBe(false);
		expect(
			needsEmbyFullSync(base, 1_000_000 + EMBY_FULL_SYNC_INTERVAL_MS, "aaa", "bbb"),
		).toBe(true);
		expect(needsEmbyFullSync(null, 1_000_000, "aaa", "bbb")).toBe(true);
		expect(needsEmbyFullSync(base, 1_000_000, "aaa", "other")).toBe(true);
	});
});

describe("指纹", () => {
	it("同输入同值、不同输入不同值", () => {
		expect(fingerprint("abc")).toBe(fingerprint("abc"));
		expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
		expect(fingerprint("abc")).toMatch(/^[0-9a-f]{8}$/);
	});

	it("serverKey 对地址规范敏感：尾斜杠与路径不影响", () => {
		expect(embyServerKey("http://h:8096/", "K")).toBe(embyServerKey("http://h:8096/web", "K"));
		expect(embyServerKey("http://h:8096", "K")).not.toBe(embyServerKey("http://h:8096", "K2"));
		// Key 两侧空白不参与指纹，避免粘贴时多出的空格把索引判成失效
		expect(embyServerKey("http://h:8096", " K ")).toBe(
			embyServerKey("http://h:8096", "K"),
		);
	});

	it("serverKey 在地址或 Key 为空时返回空串（fail closed）", () => {
		expect(embyServerKey("", "K")).toBe("");
		expect(embyServerKey("http://h:8096", "  ")).toBe("");
		expect(embyServerKey("   ", "K")).toBe("");
		expect(embyServerKey("not a url", "K")).toBe("");
	});

	it("regexKey 对空值与非法模式都回退默认正则", () => {
		expect(embyRegexKey("")).toBe(embyRegexKey("   "));
		expect(embyRegexKey("x")).not.toBe(embyRegexKey(""));
		// 抽取层把语法非法模式静默回退默认正则，指纹必须与之一致
		expect(embyRegexKey("[")).toBe(embyRegexKey(""));
		expect(embyRegexKey("([unclosed")).toBe(embyRegexKey(""));
	});
});

describe("增量起点与逐条兜底复核", () => {
	it("增量起点 = 同步时间 − 60 分钟", () => {
		const syncedAt = Date.parse("2026-10-03T12:00:00.000Z");
		expect(incrementalSince(syncedAt)).toBe("2026-10-03T11:00:00.000Z");
	});

	it("同步时间非有限值返回空串（退化为全量拉取，不抛 RangeError）", () => {
		expect(incrementalSince(Number.NaN)).toBe("");
		expect(incrementalSince(Number.POSITIVE_INFINITY)).toBe("");
		expect(incrementalSince(Number.NEGATIVE_INFINITY)).toBe("");
		// 有限但超出 Date 表示范围的值同样不得抛 RangeError
		expect(incrementalSince(9e15)).toBe("");
	});

	it("逐条兜底结果必须本地复核后才算命中", () => {
		const items = [{ Name: "JUL-769 甲乙" }];
		expect(verifyEmbySearchItems(items, "JUL-769")).toBe(true);
		expect(verifyEmbySearchItems(items, "jul_769")).toBe(true);
		expect(verifyEmbySearchItems(items, "JUL-76")).toBe(false);
		expect(verifyEmbySearchItems([], "JUL-769")).toBe(false);
	});

	it("复核使用传入的自定义正则：默认正则抽不到的短数字段也能命中", () => {
		const items = [{ Name: "ABC-12" }];
		const pattern = String.raw`\b[A-Z]{3}-\d{2}\b`;
		expect(verifyEmbySearchItems(items, "ABC-12", pattern)).toBe(true);
		expect(verifyEmbySearchItems(items, "ABC-12")).toBe(false);
	});
});
