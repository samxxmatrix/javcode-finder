import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildBasicAuth,
	classifyWebdavVerify,
	FAVORITES_STORAGE_KEY,
	isFavorite,
	joinWebdavUrl,
	loadFavorites,
	orderFavoritesForView,
	parseFavorites,
	parseStoredFavorites,
	saveFavorites,
	serializeFavorites,
	splitFavoritesByLibrary,
	toggleFavorite,
} from "../src/lib/favorites";
import { keysForCode } from "../src/lib/emby";

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

describe("local storage favorites", () => {
	let storageMock: Record<string, string> = {};

	beforeEach(() => {
		storageMock = {};
		vi.stubGlobal("localStorage", {
			getItem: vi.fn((key: string) => storageMock[key] ?? null),
			setItem: vi.fn((key: string, val: string) => {
				storageMock[key] = val;
			}),
		});
	});

	it("saves and loads favorites through localStorage", () => {
		expect(saveFavorites(localStorage, ["ABC-001", "XYZ-002"])).toBe(true);
		expect(storageMock[FAVORITES_STORAGE_KEY]).toBe(
			JSON.stringify(["ABC-001", "XYZ-002"]),
		);
		expect(loadFavorites(localStorage)).toEqual(["ABC-001", "XYZ-002"]);
	});

	it("returns empty list when localStorage has nothing", () => {
		expect(loadFavorites(localStorage)).toEqual([]);
	});

	it("returns empty list when storage is unavailable", () => {
		expect(loadFavorites(null)).toEqual([]);
		expect(saveFavorites(null, ["ABC-001"])).toBe(false);
	});

	it("tolerates malformed JSON in storage", () => {
		storageMock[FAVORITES_STORAGE_KEY] = "not-json{{";
		expect(loadFavorites(localStorage)).toEqual([]);
	});
});

describe("orderFavoritesForView", () => {
	it("returns a reversed copy (newest first) without mutating input", () => {
		const stored = ["ABC-001", "XYZ-002", "QWE-003"];
		expect(orderFavoritesForView(stored)).toEqual([
			"QWE-003",
			"XYZ-002",
			"ABC-001",
		]);
		expect(stored).toEqual(["ABC-001", "XYZ-002", "QWE-003"]);
	});

	it("returns an empty array for an empty list", () => {
		expect(orderFavoritesForView([])).toEqual([]);
	});
});

describe("parseStoredFavorites", () => {
	it("parses a stored array", () => {
		expect(parseStoredFavorites(JSON.stringify(["ABC-001"]))).toEqual([
			"ABC-001",
		]);
	});

	it("rejects null and non-array payloads", () => {
		expect(parseStoredFavorites(null)).toEqual([]);
		expect(parseStoredFavorites(JSON.stringify({ codes: ["ABC-001"] }))).toEqual([]);
		expect(parseStoredFavorites("garbage")).toEqual([]);
	});
});

describe("splitFavoritesByLibrary", () => {
	/** 用真实索引键口径造库键：splitFavoritesByLibrary 消费的是 EmbyIndex.keys */
	const libraryKeys = (codes: string[]): string[] =>
		codes.flatMap((code) => keysForCode(code));

	it("剔除命中的收藏，未命中的按原顺序保留", () => {
		const { kept, removed } = splitFavoritesByLibrary(
			["ABC-123", "XYZ-999", "QWE-456"],
			libraryKeys(["ABC-123", "QWE-456"]),
		);
		expect(removed).toEqual(["ABC-123", "QWE-456"]);
		expect(kept).toEqual(["XYZ-999"]);
	});

	it("番号先收藏、之后才入库：旧索引保留，新索引比对时剔除", () => {
		// 「删除收藏」是持续规则：同一份收藏在两个时刻对同一库比对，结果必须随索引变化。
		// App 在每次拿到新索引（开面板 / 扫描 / 立即同步）后都重跑这一步。
		const favorites = ["ABC-123", "XYZ-999"];
		// 入库前：两条都不在库，收藏完整保留
		expect(splitFavoritesByLibrary(favorites, libraryKeys(["QQQ-111"]))).toEqual({
			kept: ["ABC-123", "XYZ-999"],
			removed: [],
		});
		// XYZ-999 后来入库：下一次用新索引比对时它被剔除
		expect(
			splitFavoritesByLibrary(favorites, libraryKeys(["QQQ-111", "XYZ-999"])),
		).toEqual({ kept: ["ABC-123"], removed: ["XYZ-999"] });
	});

	it("removed 用归一化番号（收藏里的小写/空白写法也认得）", () => {
		const { kept, removed } = splitFavoritesByLibrary(
			["  abc-123  "],
			libraryKeys(["ABC-123"]),
		);
		expect(removed).toEqual(["ABC-123"]);
		expect(kept).toEqual([]);
	});

	it("同一番号重复收藏时 removed 只报一次", () => {
		const { kept, removed } = splitFavoritesByLibrary(
			["ABC-123", "abc-123"],
			libraryKeys(["ABC-123"]),
		);
		expect(removed).toEqual(["ABC-123"]);
		expect(kept).toEqual([]);
	});

	it("空库（空数组 / 空 Set）时全部保留，一条都不删", () => {
		// 空键集可能来自「未同步 / 同步失败 / 换服务器后的失效索引」，
		// 照常匹配会把整份收藏删光且不可恢复，所以必须有这道安全闸
		expect(splitFavoritesByLibrary(["ABC-123"], [])).toEqual({
			kept: ["ABC-123"],
			removed: [],
		});
		expect(splitFavoritesByLibrary(["ABC-123"], new Set<string>())).toEqual({
			kept: ["ABC-123"],
			removed: [],
		});
	});

	it("日期型番号用精确键：库里只有 103126-001 时 103126_01 必须保留", () => {
		// 回归点（见 CHANGELOG 2.4.1）：`_` 与 `-` 是不同片商，去零/抹分隔符会造成误删
		const { kept, removed } = splitFavoritesByLibrary(
			["103126_01", "103126-001"],
			libraryKeys(["103126-001"]),
		);
		expect(removed).toEqual(["103126-001"]);
		expect(kept).toEqual(["103126_01"]);
	});

	it("接受任意 Iterable（索引键常以 Set 传入）", () => {
		const { kept, removed } = splitFavoritesByLibrary(
			["ABC-123"],
			new Set(libraryKeys(["ABC-123"])),
		);
		expect(removed).toEqual(["ABC-123"]);
		expect(kept).toEqual([]);
	});

	// ---- 以下为 QA 补充：覆盖「N=0 直接打开」「原写法保留」「反向日期型」「脏键」----

	it("库非空但零命中：removed 为空、kept 全量（对应 N=0 直接打开不写盘）", () => {
		const { kept, removed } = splitFavoritesByLibrary(
			["ABC-123", "XYZ-999"],
			libraryKeys(["QWE-456", "RTY-789"]),
		);
		expect(removed).toEqual([]);
		expect(kept).toEqual(["ABC-123", "XYZ-999"]);
	});

	it("空收藏一律返回空结果（不因库非空而报错）", () => {
		expect(splitFavoritesByLibrary([], libraryKeys(["ABC-123"]))).toEqual({
			kept: [],
			removed: [],
		});
		expect(splitFavoritesByLibrary([], [])).toEqual({ kept: [], removed: [] });
	});

	it("kept 保留入参原写法与原顺序（未命中的小写/空白不被改写）", () => {
		const { kept, removed } = splitFavoritesByLibrary(
			["  xyz-999  ", "abc-123", "QWE-456"],
			libraryKeys(["ABC-123"]),
		);
		expect(removed).toEqual(["ABC-123"]);
		expect(kept).toEqual(["  xyz-999  ", "QWE-456"]);
	});

	it("日期型反向：库里只有 103126_01 时 103126-001 也必须保留", () => {
		const { kept, removed } = splitFavoritesByLibrary(
			["103126-001"],
			libraryKeys(["103126_01"]),
		);
		expect(removed).toEqual([]);
		expect(kept).toEqual(["103126-001"]);
	});

	it("库键里的脏值（空串/超长串）不会凭空命中任何收藏", () => {
		const dirty = ["", "   ", "X".repeat(200)];
		const { kept, removed } = splitFavoritesByLibrary(
			["ABC-123", "-"],
			dirty,
		);
		expect(removed).toEqual([]);
		expect(kept).toEqual(["ABC-123", "-"]);
	});

	// QA 补充：设置页的确认条数用的是「原始条数 − 保留条数」，不是 removed.length。
	// 这条用例把两种口径的差异钉死，避免以后有人把计数改回 removed.length。
	it("原始条数 − kept 条数 = 实际删除的原始条目数（去重口径会少报）", () => {
		const favorites = ["ABC-123", "abc-123", "XYZ-999", "ABC-123"];
		const { kept, removed } = splitFavoritesByLibrary(
			favorites,
			libraryKeys(["ABC-123"]),
		);
		// 归一化去重口径：同一个番号的多种写法只报一次
		expect(removed).toEqual(["ABC-123"]);
		// 实际删除的原始条目数：三种 ABC-123 写法都删掉，只剩 XYZ-999
		expect(favorites.length - kept.length).toBe(3);
		expect(kept).toEqual(["XYZ-999"]);
	});
});
