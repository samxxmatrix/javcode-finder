#!/usr/bin/env node
/**
 * 发版：npm run release <patch|minor|major|x.y.z> [--push] [--dry-run] [--skip-checks]
 *
 * 做的事（顺序即防呆）：
 *   1. 校验工作树干净、从 origin 解析 owner/repo，并断言与扩展里的检查地址一致
 *   2. 计算下一个版本号（只改 package.json —— 唯一版本来源）
 *   3. 跑 npm test + npm run compile
 *   4. 写 package.json、按提交前缀追加 CHANGELOG.md
 *   5. npm run zip，校验产物 manifest.version === package.json.version、zip 名字含版本
 *   6. 生成 Release 资产 .output/version.json（扩展的更新检查就读它）+ release-notes.md
 *   7. git commit + git tag v<版本>
 *   8. --push 才推送；装了 gh CLI 就顺手建 Release，否则打印手动步骤
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	applyVersion,
	buildChangelogEntry,
	buildVersionAsset,
	computeNextVersion,
	parseRepoSlug,
	prependChangelogEntry,
} from "./release-lib.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IS_WINDOWS = process.platform === "win32";
const NPM = IS_WINDOWS ? "npm.cmd" : "npm";
const OUTPUT_DIR = join(ROOT, ".output");

const USAGE =
	"用法: npm run release <patch|minor|major|x.y.z> [--push] [--dry-run] [--skip-checks]";

function sh(command: string, args: string[]): string {
	// stderr 丢弃：这里都是"探测型"调用（如 git describe 在没有 tag 时会失败），
	// 失败由 trySh 兜住，不该把 noise 打到用户终端
	return execFileSync(command, args, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		shell: IS_WINDOWS,
	}).trim();
}

function trySh(command: string, args: string[]): string | null {
	try {
		return sh(command, args);
	} catch {
		return null;
	}
}

function run(command: string, args: string[]): void {
	execFileSync(command, args, {
		cwd: ROOT,
		stdio: "inherit",
		shell: IS_WINDOWS,
	});
}

function fail(message: string): never {
	console.error(`\n✗ ${message}\n`);
	process.exit(1);
}

function info(message: string): void {
	console.log(message);
}

function printManualReleaseSteps(
	repoSlug: string,
	version: string,
	zipPath: string,
	notesPath: string,
	needsPush: boolean,
): void {
	const relative = (p: string): string => p.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "");
	info(
		[
			"",
			"接下来手动完成：",
			needsPush ? `  1) git push && git push origin v${version}` : null,
			`  ${needsPush ? "2" : "1"}) 打开 https://github.com/${repoSlug}/releases/new?tag=v${version}`,
			`  标题填 v${version}，正文粘贴 ${relative(notesPath)} 的内容（正文里含本版变更）`,
			`  上传两个附件：${relative(zipPath)} 和 .output/version.json`,
			"     ↑ version.json 必须传：扩展的更新检查就是读它，缺了提示永远不会出现",
			"  发布后：用户侧最多 24 小时内出现更新提示（受节流限制）",
			"",
			"装了 GitHub CLI 的话这一步可以自动：gh release create v" + version + " --verify-tag \\",
			`  --title v${version} --notes-file ${relative(notesPath)} ${relative(zipPath)} .output/version.json`,
			"",
		]
			.filter((line): line is string => line !== null)
			.join("\n"),
	);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const spec = args.find((arg) => !arg.startsWith("--"));
const dryRun = flags.has("--dry-run");
const push = flags.has("--push");
const skipChecks = flags.has("--skip-checks");

if (!spec) {
	console.error(USAGE);
	process.exit(1);
}

// ---- 1. 前置检查 ----
const dirty = sh("git", ["status", "--porcelain"]);
if (dirty) {
	fail(`工作树不干净，先提交或 stash：\n${dirty}`);
}

const remote = trySh("git", ["remote", "get-url", "origin"]);
const slug = remote ? parseRepoSlug(remote) : null;
if (!slug) {
	fail("无法从 origin 解析 owner/repo（git remote get-url origin）");
}

const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const pkgPath = join(ROOT, "package.json");
const pkgRaw = readFileSync(pkgPath, "utf8");
const current = (JSON.parse(pkgRaw) as { version?: string }).version ?? "";
const next = computeNextVersion(current, spec);
if (!next) {
	fail(`版本 "${spec}" 非法，或不大于当前版本 ${current}`);
}

// ---- 2. 收集提交、生成变更段 ----
const lastTag = trySh("git", ["describe", "--tags", "--abbrev=0"]);
const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const subjects = sh("git", ["log", range, "--pretty=format:%s"])
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean);
const date = new Date().toISOString().slice(0, 10);
const entry = buildChangelogEntry({ version: next, date, subjects });
const zipName = `javcode-finder-extension-${next}-chrome.zip`;
const zipPath = join(OUTPUT_DIR, zipName);
const notesPath = join(OUTPUT_DIR, "release-notes.md");
const asset = buildVersionAsset({ repoSlug: slug, version: next, zipName });

info(
	[
		"",
		"发版计划",
		`  仓库      ${slug}${branch === "main" ? "" : `   ⚠ 当前分支是 ${branch}`}`,
		`  版本      ${current} → ${next}`,
		`  提交范围  ${lastTag ? range : "全部历史（还没打过 tag）"}，共 ${subjects.length} 条`,
		`  产物      .output/${zipName}`,
		`  更新资产  .output/version.json → ${asset.url}`,
		"",
		entry,
	].join("\n"),
);

if (dryRun) {
	info("--dry-run：未做任何改动。\n");
	process.exit(0);
}

// ---- 3. 检查 ----
if (!skipChecks) {
	run(NPM, ["test"]);
	run(NPM, ["run", "compile"]);
}

// ---- 4~6. 改版本、写 CHANGELOG、打包、校验、生成资产 ----
try {
	writeFileSync(pkgPath, applyVersion(pkgRaw, next));
	info(`✓ package.json 版本 → ${next}`);

	const changelogPath = join(ROOT, "CHANGELOG.md");
	const previousChangelog = existsSync(changelogPath)
		? readFileSync(changelogPath, "utf8")
		: null;
	writeFileSync(changelogPath, prependChangelogEntry(previousChangelog, entry));
	info("✓ CHANGELOG.md 已追加本版");

	run(NPM, ["run", "zip"]);

	const manifestPath = join(OUTPUT_DIR, "chrome-mv3", "manifest.json");
	if (!existsSync(manifestPath)) fail("找不到 .output/chrome-mv3/manifest.json");
	const manifestVersion = (
		JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string }
	).version;
	if (manifestVersion !== next) {
		fail(
			`产物 manifest.version=${manifestVersion} 与 package.json=${next} 不一致 —— 检查 wxt.config.ts 是不是又写了 version`,
		);
	}
	if (!existsSync(zipPath)) fail(`找不到打包产物 ${zipPath}`);

	// 更新检查地址必须指向当前仓库：define 注入有没有生效，只能看产物。
	// 注意查的是 slug 而不是整串 URL —— LATEST_VERSION_URL 是运行时模板字符串，不会被折叠。
	const backgroundPath = join(OUTPUT_DIR, "chrome-mv3", "background.js");
	if (!readFileSync(backgroundPath, "utf8").includes(slug)) {
		fail(
			[
				`产物里的发布仓库不是 ${slug} —— 更新检查会指向错误的地方：`,
				"  检查 wxt.config.ts 的 define 注入，或构建时设 RELEASES_REPO=owner/repo",
			].join("\n"),
		);
	}

	writeFileSync(join(OUTPUT_DIR, "version.json"), `${JSON.stringify(asset, null, 2)}\n`);
	writeFileSync(notesPath, entry);
	info("✓ 已生成 .output/version.json 与 .output/release-notes.md");
} catch (error) {
	fail(
		[
			`打包或校验失败：${error instanceof Error ? error.message : String(error)}`,
			"package.json 与 CHANGELOG.md 已被改动，回滚：",
			"  git checkout -- package.json CHANGELOG.md",
		].join("\n"),
	);
}

// ---- 7. 提交 + 打 tag ----
run("git", ["add", "package.json", "CHANGELOG.md"]);
run("git", ["commit", "-m", `chore: 版本号 ${current} -> ${next}`]);
run("git", ["tag", `v${next}`]);
info(`✓ 已提交并打 tag v${next}`);

// ---- 8. 推送 / 建 Release ----
const hasGh = trySh("gh", ["--version"]) !== null;

if (push) {
	run("git", ["push"]);
	run("git", ["push", "origin", `v${next}`]);
	info(`✓ 已推送 main 与 tag v${next}`);

	if (hasGh) {
		run("gh", [
			"release",
			"create",
			`v${next}`,
			"--verify-tag",
			"--title",
			`v${next}`,
			"--notes-file",
			notesPath,
			zipPath,
			join(OUTPUT_DIR, "version.json"),
		]);
		info(`✓ 已创建 GitHub Release v${next}（含 zip 与 version.json）`);
	} else {
		info("未装 gh CLI，Release 需要手动创建。");
		printManualReleaseSteps(slug, next, zipPath, notesPath, false);
	}
} else {
	info("未加 --push：只做了本地提交与 tag。");
	printManualReleaseSteps(slug, next, zipPath, notesPath, true);
}

info(`\n完成：v${next}\n`);
