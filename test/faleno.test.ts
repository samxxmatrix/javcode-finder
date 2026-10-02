import { describe, expect, it } from "vitest";
import {
	buildFalenoWorksUrl,
	matchesFalenoPrefix,
	normalizePrefix,
	toFalenoCodeKey,
} from "../src/lib/faleno";

describe("faleno", () => {
	it("converts a code to the FALENO lowercase key", () => {
		expect(toFalenoCodeKey("FNS-263")).toBe("fns263");
		expect(toFalenoCodeKey("fns 263")).toBe("fns263");
		expect(toFalenoCodeKey("")).toBe("");
	});

	it("builds the works page URL", () => {
		expect(buildFalenoWorksUrl("FNS-263")).toBe(
			"https://faleno.jp/top/works/fns263",
		);
		expect(buildFalenoWorksUrl("")).toBe("");
	});

	it("normalizes prefix entries", () => {
		expect(normalizePrefix(" fns ")).toBe("FNS");
		expect(normalizePrefix("")).toBe("");
	});

	it("matches prefixes case- and separator-insensitively", () => {
		expect(matchesFalenoPrefix("FNS-263", ["FNS"])).toBe(true);
		expect(matchesFalenoPrefix("fns263", ["fns"])).toBe(true);
		expect(matchesFalenoPrefix("FSDSS-001", ["FNS", "FSDSS"])).toBe(true);
		expect(matchesFalenoPrefix("ABP-123", ["FNS"])).toBe(false);
		expect(matchesFalenoPrefix("FNS-263", [])).toBe(false);
	});
});
