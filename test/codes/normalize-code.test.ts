import { describe, expect, it } from "vitest";
import {
	dedupeDisplayCodes,
	normalizeCode,
	toComparisonKey,
	toExternalSearchCode,
} from "../../src/lib/normalize-code";

describe("normalizeCode", () => {
	it("normalizes case, whitespace, full-width, and dash separators", () => {
		expect(normalizeCode("abp 123")).toBe("ABP-123");
		expect(normalizeCode("ABP-123")).toBe("ABP-123");
		expect(normalizeCode("  abp   123  ")).toBe("ABP-123");
		expect(normalizeCode("ＦＣ２－３０６１６２５")).toBe("FC2-3061625");
	});

	// 用户实测报的症状：同一页面出现 `100826_001`（一本道）与 `100826-001`（カリビアンコム），
	// 是**两部不同作品**；把 `_` 折成 `-` 会让面板去重后只剩一条，另一部永远查不到。
	it("保留 `_`：它与 `-` 编码不同片商，绝不能互相折叠", () => {
		expect(normalizeCode("100826_001")).toBe("100826_001");
		expect(normalizeCode("100826-001")).toBe("100826-001");
		expect(normalizeCode("100826_001")).not.toBe(normalizeCode("100826-001"));
		// 首尾空白仍要清掉
		expect(normalizeCode("  100826_001  ")).toBe("100826_001");
		// FC2 PPV 的 `_` 写法照旧压平（那是同一部作品的变体写法，不是片商分隔符）
		expect(normalizeCode("FC2_PPV_1234567")).toBe("FC2-1234567");
	});

	it("空白与破折号变体仍折成 `-`（同一部作品的不同写法）", () => {
		expect(normalizeCode("ABP 123")).toBe("ABP-123");
		expect(normalizeCode("ABP—123")).toBe("ABP-123");
		expect(normalizeCode("ABP–123")).toBe("ABP-123");
		expect(normalizeCode("ABP   123")).toBe("ABP-123");
	});

	it("normalizes FC2 PPV prefix", () => {
		expect(normalizeCode("FC2 PPV 1234567")).toBe("FC2-1234567");
		expect(normalizeCode("FC2-PPV-1234567")).toBe("FC2-1234567");
	});

	it("handles dotted codes", () => {
		expect(normalizeCode("blacked.20.01.10")).toBe("BLACKED.20.01.10");
	});

	it("handles null and empty input safely", () => {
		expect(normalizeCode("")).toBe("");
		expect(normalizeCode(null)).toBe("");
		expect(normalizeCode(undefined)).toBe("");
	});
});

describe("toComparisonKey", () => {
	it("produces identical comparison keys for separator variants", () => {
		expect(toComparisonKey("ABP-123")).toBe("ABP123");
		expect(toComparisonKey("abp 123")).toBe("ABP123");
		expect(toComparisonKey("abp_123")).toBe("ABP123");
		expect(toComparisonKey("abp--123")).toBe("ABP123");
		expect(toComparisonKey("ABP123")).toBe("ABP123");
	});

	// 与 normalizeCode 的口径差异是**有意**的：比较键只用于匹配（Emby 在库判定、javtrailers 卡片比对），
	// 剥离分隔符才不会因为写法差异漏匹配；而显示码/查询码必须保留分隔符（见上面的 `100826_` 用例）。
	it("比较键仍剥离分隔符：100826_001 与 100826-001 的比较键相同", () => {
		expect(toComparisonKey("100826_001")).toBe("100826001");
		expect(toComparisonKey("100826-001")).toBe("100826001");
	});

	it("produces identical comparison keys for FC2 variants", () => {
		expect(toComparisonKey("FC2-3061625")).toBe("FC23061625");
		expect(toComparisonKey("FC2 PPV 3061625")).toBe("FC23061625");
		expect(toComparisonKey("ＦＣ２－３０６１６２５")).toBe("FC23061625");
	});

	it("handles null and empty input safely", () => {
		expect(toComparisonKey("")).toBe("");
		expect(toComparisonKey(null)).toBe("");
		expect(toComparisonKey(undefined)).toBe("");
	});
});

describe("dedupeDisplayCodes", () => {
	// 这就是用户报的症状本身：抽取层本来就把两个号都抓到了，是面板去重把它们并成一条。
	it("回归：同一页面的 100826_001 与 100826-001 必须都留在列表里", () => {
		const candidates = ["100826_001", "100826-001"];
		expect(dedupeDisplayCodes(candidates)).toEqual([
			"100826_001",
			"100826-001",
		]);
		expect(dedupeDisplayCodes(candidates)).toHaveLength(2);
	});

	it("同一部作品的写法变体仍只留一条（保留首次出现，输出归一化形式）", () => {
		expect(dedupeDisplayCodes(["abp 123", "ABP-123", "abp—123"])).toEqual([
			"ABP-123",
		]);
		expect(dedupeDisplayCodes(["100826_001", "100826_001"])).toEqual([
			"100826_001",
		]);
	});

	it("保序，并剔除归一化后为空的项", () => {
		expect(dedupeDisplayCodes(["", "  ", "ABP-123", "IPX-118"])).toEqual([
			"ABP-123",
			"IPX-118",
		]);
		expect(dedupeDisplayCodes([])).toEqual([]);
	});
});

describe("toExternalSearchCode", () => {
	it("expands FC2 display codes to the FC2-PPV form", () => {
		expect(toExternalSearchCode("FC2-123456")).toBe("FC2-PPV-123456");
		expect(toExternalSearchCode("FC2-3061625")).toBe("FC2-PPV-3061625");
	});

	it("trims surrounding whitespace before expanding", () => {
		expect(toExternalSearchCode("  FC2-123456  ")).toBe("FC2-PPV-123456");
	});

	it("is idempotent for codes already in the PPV form", () => {
		expect(toExternalSearchCode("FC2-PPV-123456")).toBe("FC2-PPV-123456");
	});

	it("leaves non-FC2 codes untouched", () => {
		expect(toExternalSearchCode("ABP-123")).toBe("ABP-123");
		expect(toExternalSearchCode("DLDSS-529")).toBe("DLDSS-529");
		expect(toExternalSearchCode("BLACKED.20.01.10")).toBe("BLACKED.20.01.10");
	});

	it("leaves FC2-shaped codes with non-digit or out-of-range segments untouched", () => {
		expect(toExternalSearchCode("FC2-123A")).toBe("FC2-123A");
		expect(toExternalSearchCode("FC2-12")).toBe("FC2-12");
	});

	it("handles null and empty input safely", () => {
		expect(toExternalSearchCode("")).toBe("");
		expect(toExternalSearchCode("   ")).toBe("");
		expect(toExternalSearchCode(null)).toBe("");
		expect(toExternalSearchCode(undefined)).toBe("");
	});
});
