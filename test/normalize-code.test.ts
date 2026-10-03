import { describe, expect, it } from "vitest";
import {
	normalizeCode,
	toComparisonKey,
	toExternalSearchCode,
} from "../src/lib/normalize-code";

describe("normalizeCode", () => {
	it("normalizes case, whitespace, full-width, and dash separators", () => {
		expect(normalizeCode("abp 123")).toBe("ABP-123");
		expect(normalizeCode("ABP-123")).toBe("ABP-123");
		expect(normalizeCode("abp_123")).toBe("ABP-123");
		expect(normalizeCode("  abp   123  ")).toBe("ABP-123");
		expect(normalizeCode("ＦＣ２－３０６１６２５")).toBe("FC2-3061625");
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
