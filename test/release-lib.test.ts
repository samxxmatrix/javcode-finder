import { describe, expect, it } from "vitest";
import {
	applyVersion,
	buildChangelogEntry,
	buildVersionAsset,
	computeNextVersion,
	groupCommits,
	parseRepoSlug,
	prependChangelogEntry,
} from "../scripts/release-lib.ts";

describe("computeNextVersion", () => {
	it("bumps patch / minor / major", () => {
		expect(computeNextVersion("2.0.1", "patch")).toBe("2.0.2");
		expect(computeNextVersion("2.0.1", "minor")).toBe("2.1.0");
		expect(computeNextVersion("2.0.1", "major")).toBe("3.0.0");
		expect(computeNextVersion("2.0.1", "MAJOR")).toBe("3.0.0");
	});

	it("accepts an explicit version, normalized", () => {
		expect(computeNextVersion("2.0.1", "2.1.0")).toBe("2.1.0");
		expect(computeNextVersion("2.0.1", "v2.1.0")).toBe("2.1.0");
		expect(computeNextVersion("2.0.1", " 2.1.0 ")).toBe("2.1.0");
		expect(computeNextVersion("2.0.1", "2.1")).toBe("2.1.0");
	});

	it("rejects equal/older versions and garbage specs", () => {
		expect(computeNextVersion("2.0.1", "2.0.1")).toBeNull();
		expect(computeNextVersion("2.0.1", "2.0.0")).toBeNull();
		expect(computeNextVersion("2.0.1", "")).toBeNull();
		expect(computeNextVersion("2.0.1", "nope")).toBeNull();
		expect(computeNextVersion("2.0.1", "2.1.0-beta")).toBeNull();
		expect(computeNextVersion("不是版本", "patch")).toBeNull();
	});
});

describe("parseRepoSlug", () => {
	it("parses https and ssh remotes with or without .git", () => {
		expect(parseRepoSlug("https://github.com/samxxmatrix/javcode-finder.git")).toBe(
			"samxxmatrix/javcode-finder",
		);
		expect(parseRepoSlug("https://github.com/a/b")).toBe("a/b");
		expect(parseRepoSlug("https://github.com/a/b/")).toBe("a/b");
		expect(parseRepoSlug("git@github.com:a/b.git")).toBe("a/b");
	});

	it("returns null for unusable input", () => {
		expect(parseRepoSlug("")).toBeNull();
		expect(parseRepoSlug("not a url")).toBeNull();
		expect(parseRepoSlug("https://github.com/onlyowner")).toBeNull();
	});
});

describe("groupCommits", () => {
	it("groups feat/fix/perf and puts the rest under 其他, dropping prefixes", () => {
		expect(
			groupCommits([
				"feat: 加 FC2 预览",
				"fix(emby): 圆点边框",
				"perf: 封面换 w276",
				"chore: 版本号",
				"docs: 补文档",
			]),
		).toEqual([
			{ title: "新功能", items: ["加 FC2 预览"] },
			{ title: "修复", items: ["圆点边框"] },
			{ title: "性能", items: ["封面换 w276"] },
			{ title: "其他", items: ["版本号", "补文档"] },
		]);
	});

	it("keeps unprefixed subjects and ignores blanks", () => {
		expect(groupCommits(["随手改了一行", "  ", ""])).toEqual([
			{ title: "其他", items: ["随手改了一行"] },
		]);
		expect(groupCommits([])).toEqual([]);
	});
});

describe("buildChangelogEntry", () => {
	it("renders a dated Keep-a-Changelog style section", () => {
		const entry = buildChangelogEntry({
			version: "2.1.0",
			date: "2026-10-04",
			subjects: ["feat: A", "fix: B"],
		});
		expect(entry).toContain("## [2.1.0] - 2026-10-04");
		expect(entry).toContain("### 新功能");
		expect(entry).toContain("- A");
		expect(entry).toContain("### 修复");
		expect(entry).toContain("- B");
	});

	it("says so when there is nothing to list", () => {
		expect(
			buildChangelogEntry({ version: "2.0.2", date: "2026-10-04", subjects: [] }),
		).toContain("无提交记录");
	});

	it("caps the item count and reports how many were dropped", () => {
		const entry = buildChangelogEntry({
			version: "2.0.2",
			date: "2026-10-04",
			subjects: ["feat: 1", "feat: 2", "feat: 3", "feat: 4", "feat: 5"],
			maxItems: 3,
		});
		expect(entry).toContain("- 1");
		expect(entry).toContain("- 3");
		expect(entry).not.toContain("- 4");
		expect(entry).toContain("已省略 2 条");
	});
});

describe("buildVersionAsset", () => {
	it("points at the zip attached to that tag", () => {
		expect(
			buildVersionAsset({
				repoSlug: "a/b",
				version: "2.1.0",
				zipName: "javcode-finder-extension-2.1.0-chrome.zip",
			}),
		).toEqual({
			version: "2.1.0",
			url: "https://github.com/a/b/releases/download/v2.1.0/javcode-finder-extension-2.1.0-chrome.zip",
		});
	});
});

describe("applyVersion", () => {
	it("rewrites only the first version field and keeps formatting", () => {
		const raw = `{
  "name": "x",
  "version": "2.0.1",
  "private": true,
  "config": {
    "version": "9.9.9"
  }
}
`;
		const updated = applyVersion(raw, "2.1.0");
		expect(updated).toContain('"version": "2.1.0"');
		expect(updated).toContain('"name": "x"');
		expect(updated).toContain('"version": "9.9.9"');
		expect(updated.endsWith("\n")).toBe(true);
		expect(JSON.parse(updated).version).toBe("2.1.0");
	});

	it("throws when there is no version field", () => {
		expect(() => applyVersion('{ "name": "x" }', "2.1.0")).toThrow();
	});
});

describe("prependChangelogEntry", () => {
	it("creates the file with a header on first use", () => {
		const first = prependChangelogEntry(null, "## [2.1.0] - d1\n\n- a\n");
		expect(first.startsWith("# Changelog")).toBe(true);
		expect(first).toContain("## [2.1.0] - d1");
	});

	it("inserts newer entries above older ones and keeps a single header", () => {
		const first = prependChangelogEntry(null, "## [2.1.0] - d1\n\n- a\n");
		const second = prependChangelogEntry(first, "## [2.2.0] - d2\n\n- b\n");
		expect(second.indexOf("2.2.0")).toBeLessThan(second.indexOf("2.1.0"));
		expect(second.match(/# Changelog/g)).toHaveLength(1);
		expect(second).toContain("- a");
		expect(second).toContain("- b");
	});
});
