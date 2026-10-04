import { describe, expect, it } from "vitest";
import {
	applyVersion,
	buildChangelogEntry,
	buildCommitMessage,
	buildVersionAsset,
	computeNextVersion,
	groupCommits,
	parseCommitArgs,
	parseReleaseArgs,
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

describe("parseReleaseArgs", () => {
	it("defaults to a patch bump with push enabled", () => {
		expect(parseReleaseArgs([])).toEqual({
			spec: "patch",
			push: true,
			dryRun: false,
			skipChecks: false,
		});
	});

	it("takes one positional argument as the version spec", () => {
		expect(parseReleaseArgs(["minor"]).spec).toBe("minor");
		expect(parseReleaseArgs(["2.1.0"]).spec).toBe("2.1.0");
		// 多余的位置参数忽略（只有第一个生效）
		expect(parseReleaseArgs(["major", "minor"]).spec).toBe("major");
	});

	it("understands the flags in any position", () => {
		expect(parseReleaseArgs(["--dry-run"])).toEqual({
			spec: "patch",
			push: true,
			dryRun: true,
			skipChecks: false,
		});
		expect(parseReleaseArgs(["2.1.0", "--no-push"]).push).toBe(false);
		expect(parseReleaseArgs(["--skip-checks", "--dry-run"]).skipChecks).toBe(
			true,
		);
		// --push 保留兼容：默认已是推送，显式给出不改变结果
		expect(parseReleaseArgs(["--push"]).push).toBe(true);
		// 同时给出时以 --no-push 为准
		expect(parseReleaseArgs(["--push", "--no-push"]).push).toBe(false);
	});
});

describe("parseCommitArgs", () => {
	it("returns no message and no dry-run by default", () => {
		expect(parseCommitArgs([])).toEqual({ message: undefined, dryRun: false });
	});

	it("takes one positional argument as the commit subject", () => {
		expect(parseCommitArgs(["fix: 修正重播失败"])).toEqual({
			message: "fix: 修正重播失败",
			dryRun: false,
		});
		expect(parseCommitArgs(["fix: x", "--dry-run"])).toEqual({
			message: "fix: x",
			dryRun: true,
		});
		expect(parseCommitArgs(["--dry-run", "fix: x"]).dryRun).toBe(true);
	});
});

describe("buildCommitMessage", () => {
	it("returns an empty string when there is nothing to commit", () => {
		expect(buildCommitMessage({ files: [] })).toBe("");
		expect(buildCommitMessage({ files: ["", "  "] })).toBe("");
	});

	it("auto-summarizes the file count and lists files with their status", () => {
		const message = buildCommitMessage({
			files: [" M src/lib/a.ts", "?? test/b.test.ts", "A  entrypoints/c.tsx"],
		});
		const [subject, , ...lines] = message.split("\n");
		expect(subject).toBe("chore: 同步改动（3 个文件）");
		expect(lines).toEqual([
			"- M src/lib/a.ts",
			"- ?? test/b.test.ts",
			"- A entrypoints/c.tsx",
		]);
	});

	it("uses a caller-supplied subject verbatim", () => {
		const message = buildCommitMessage({
			files: [" M src/lib/a.ts"],
			subject: "fix: 修正重播失败",
		});
		expect(message.split("\n")[0]).toBe("fix: 修正重播失败");
		expect(message).toContain("- M src/lib/a.ts");
	});

	it("caps the listed files and reports how many were left out", () => {
		const files = Array.from({ length: 25 }, (_, i) => ` M file-${i}.ts`);
		const message = buildCommitMessage({ files, maxFiles: 20 });
		expect(message).toContain("- M file-19.ts");
		expect(message).not.toContain("file-20.ts");
		expect(message).toContain("另有 5 个文件未列出");
		expect(message.split("\n")[0]).toBe("chore: 同步改动（25 个文件）");
	});
});
