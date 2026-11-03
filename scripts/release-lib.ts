/**
 * 发版脚本的纯逻辑（不碰 fs / git，便于单测）。
 * 版本解析与比较直接复用扩展里的实现 —— 两处各写一份迟早漂移（历史上就漏过 minor 段）。
 */
import { isNewerVersion, parseVersion } from "../src/lib/release.ts";

export interface CommitGroup {
	title: string;
	items: string[];
}

export interface VersionAsset {
	version: string;
	url: string;
}

export const CHANGELOG_HEADER =
	"# Changelog\n\n本文件由 `npm run release` 维护：发版时按提交前缀（feat / fix / perf / 其他）自动追加一段。\n\n";

const BUMP_PATTERN = /^(patch|minor|major)$/i;
const GROUPS: ReadonlyArray<{ key: string; title: string }> = [
	{ key: "feat", title: "新功能" },
	{ key: "fix", title: "修复" },
	{ key: "perf", title: "性能" },
	{ key: "other", title: "其他" },
];
const DEFAULT_MAX_ITEMS = 40;

/**
 * 计算下一个版本号。spec 为 `patch|minor|major` 或显式版本（`2.1.0` / `v2.1.0`）。
 * 显式版本必须严格大于当前版本，否则返回 null —— 调用方据此拒绝发版。
 */
export function computeNextVersion(
	current: string,
	spec: string,
): string | null {
	const base = parseVersion(current);
	if (!base) return null;

	const wanted = (spec ?? "").trim();
	const bump = BUMP_PATTERN.exec(wanted);
	if (bump) {
		const major = base[0] ?? 0;
		const minor = base[1] ?? 0;
		const patch = base[2] ?? 0;
		switch (bump[1]?.toLowerCase()) {
			case "major":
				return `${major + 1}.0.0`;
			case "minor":
				return `${major}.${minor + 1}.0`;
			default:
				return `${major}.${minor}.${patch + 1}`;
		}
	}

	const explicit = parseVersion(wanted);
	if (!explicit) return null;
	const normalized = explicit.join(".");
	return isNewerVersion(normalized, current) ? normalized : null;
}

export interface ReleaseArgs {
	spec: string;
	push: boolean;
	dryRun: boolean;
	skipChecks: boolean;
}

/**
 * 解析 `npm run release` 的参数：位置参数（可省略）是版本号，缺省 = patch，
 * 所以"不带参数就能发一个小版本"。推送默认开启（发版即发布），`--no-push` 退回纯本地；
 * `--push` 保留兼容（默认已是推送）。
 */
export function parseReleaseArgs(argv: string[]): ReleaseArgs {
	const args = argv ?? [];
	const flags = new Set(args.filter((arg) => arg.startsWith("--")));
	return {
		spec: args.find((arg) => !arg.startsWith("--")) ?? "patch",
		push: !flags.has("--no-push"),
		dryRun: flags.has("--dry-run"),
		skipChecks: flags.has("--skip-checks"),
	};
}

export interface CommitArgs {
	/** 自定义提交标题；缺省时由 buildCommitMessage 按文件数生成 */
	message?: string;
	dryRun: boolean;
}

/** 解析 `npm run commit` 的参数：位置参数（可省略）是提交标题，`--dry-run` 只打印不提交 */
export function parseCommitArgs(argv: string[]): CommitArgs {
	const args = argv ?? [];
	return {
		message: args.find((arg) => !arg.startsWith("--")),
		dryRun: args.includes("--dry-run"),
	};
}

const DEFAULT_MAX_COMMIT_FILES = 20;

/** git status --porcelain 的一行 → "M path"（状态码与路径都去掉多余空白） */
function formatStatusLine(line: string): string {
	const status = line.slice(0, 2).trim() || "M";
	const path = line.slice(2).trim();
	return path ? `${status} ${path}` : status;
}

/**
 * 自动提交信息：首行标题（调用方给了就用它，否则按文件数生成），正文列出改动文件。
 * files 为空返回空串 —— 调用方据此判定"没有需要提交的改动"。
 * 注：默认标题用 chore 前缀，CHANGELOG 会归入"其他"；想要正确归类就传 `feat: ...` 这种标题。
 */
export function buildCommitMessage(input: {
	files: string[];
	subject?: string;
	maxFiles?: number;
}): string {
	const files = (input.files ?? [])
		.map((line) => String(line ?? "").trim())
		.filter(Boolean);
	if (files.length === 0) return "";

	const max = input.maxFiles ?? DEFAULT_MAX_COMMIT_FILES;
	const kept = files.slice(0, Math.max(0, max));
	const dropped = files.length - kept.length;
	const subject =
		(input.subject ?? "").trim() || `chore: 同步改动（${files.length} 个文件）`;

	const lines = [
		subject,
		"",
		...kept.map((line) => `- ${formatStatusLine(line)}`),
	];
	if (dropped > 0) lines.push(`- 另有 ${dropped} 个文件未列出`);
	return lines.join("\n");
}

/** 从 git remote 解析 owner/repo，支持 https 与 ssh、带或不带 .git 与尾斜杠 */
export function parseRepoSlug(remoteUrl: string): string | null {
	const url = (remoteUrl ?? "").trim();
	const https = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
	if (https) return `${https[1]}/${https[2]}`;
	const ssh = /^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
	if (ssh) return `${ssh[1]}/${ssh[2]}`;
	return null;
}

/** 按提交前缀分组；feat/fix/perf 单独成组，其余（含无前缀）归入「其他」，并去掉前缀 */
export function groupCommits(subjects: string[]): CommitGroup[] {
	const buckets = new Map<string, string[]>(
		GROUPS.map((group) => [group.key, []]),
	);

	for (const raw of subjects ?? []) {
		const subject = String(raw ?? "").trim();
		if (!subject) continue;
		const match = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(subject);
		const prefix = (match?.[1] ?? "").toLowerCase();
		const key = buckets.has(prefix) ? prefix : "other";
		buckets.get(key)?.push((match?.[2] ?? subject).trim());
	}

	return GROUPS.map(({ key, title }) => ({
		title,
		items: buckets.get(key) ?? [],
	})).filter((group) => group.items.length > 0);
}

/** 生成 CHANGELOG 的一段（Keep a Changelog 风格）；超出 maxItems 时省略更早的并注明条数 */
export function buildChangelogEntry(input: {
	version: string;
	date: string;
	subjects: string[];
	maxItems?: number;
}): string {
	const max = input.maxItems ?? DEFAULT_MAX_ITEMS;
	const all = (input.subjects ?? []).filter((s) => String(s ?? "").trim());
	const kept = all.slice(0, Math.max(0, max));
	const dropped = all.length - kept.length;

	const lines = [`## [${input.version}] - ${input.date}`, ""];
	if (kept.length === 0) {
		lines.push("- 无提交记录", "");
		return lines.join("\n");
	}

	for (const group of groupCommits(kept)) {
		lines.push(`### ${group.title}`, "");
		for (const item of group.items) lines.push(`- ${item}`);
		lines.push("");
	}
	if (dropped > 0) {
		lines.push(
			`- （已省略 ${dropped} 条更早的提交；建议先给历史打一个基线 tag）`,
			"",
		);
	}
	return lines.join("\n");
}

/** Release 资产 version.json 的内容：指向该 tag 下挂的 zip */
export function buildVersionAsset(input: {
	repoSlug: string;
	version: string;
	zipName: string;
}): VersionAsset {
	return {
		version: input.version,
		url: `https://github.com/${input.repoSlug}/releases/download/v${input.version}/${input.zipName}`,
	};
}

/** 只改写 package.json 顶层（第一个）version 字段，保留其余格式 */
export function applyVersion(packageJson: string, version: string): string {
	const pattern = /("version"\s*:\s*)"[^"]*"/;
	if (!pattern.test(packageJson)) {
		throw new Error("package.json 里找不到 version 字段");
	}
	return packageJson.replace(pattern, `$1"${version}"`);
}

/** 把新的一段插到最前（保留既有内容与单一标题） */
export function prependChangelogEntry(
	previous: string | null,
	entry: string,
): string {
	const body = previous
		? previous.startsWith(CHANGELOG_HEADER)
			? previous.slice(CHANGELOG_HEADER.length)
			: previous.replace(/^# Changelog[^\n]*\n+/, "")
		: "";
	return `${CHANGELOG_HEADER}${entry.trim()}\n${body.trim() ? `\n${body.trim()}\n` : ""}`;
}
