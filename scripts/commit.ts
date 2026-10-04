#!/usr/bin/env node
/**
 * 自动提交：npm run commit ["提交标题"] [--dry-run]
 *
 * 做的事：
 *   1. git status 看有没有改动 —— 没有就友好退出 0（方便链式调用、重复执行）
 *   2. 生成提交信息：缺省按文件数自动生成，正文列出改动文件（超 20 条注明未列出数）
 *   3. git add -A + git commit
 *
 * 与 release.ts 一致不用 shell：git 走 execFileSync，带空格或中文的标题
 * 在 shell 模式下会被空格拆成多个参数（历史上踩过）。
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCommitMessage, parseCommitArgs } from "./release-lib.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sh(command: string, args: string[]): string {
	return execFileSync(command, args, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

function run(command: string, args: string[]): void {
	execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });
}

const { message, dryRun } = parseCommitArgs(process.argv.slice(2));

let dirty: string;
try {
	dirty = sh("git", ["status", "--porcelain"]);
} catch {
	console.error("\n✗ git 不可用，或当前目录不是 git 仓库\n");
	process.exit(1);
}

const files = dirty
	.split("\n")
	.map((line) => line.trimEnd())
	.filter(Boolean);
const commitMessage = buildCommitMessage({ files, subject: message });

if (!commitMessage) {
	console.log("✓ 没有需要提交的改动");
	process.exit(0);
}

console.log(`\n改动 ${files.length} 个文件，提交信息：\n`);
console.log(commitMessage);
console.log("");

if (dryRun) {
	console.log("--dry-run：未提交任何改动。\n");
	process.exit(0);
}

try {
	run("git", ["add", "-A"]);
	run("git", ["commit", "-m", commitMessage]);
} catch {
	console.error(
		"\n✗ git 提交失败（见上方 git 输出）。改动仍在工作区，修好后可重试。\n",
	);
	process.exit(1);
}

console.log(`✓ 已提交 ${files.length} 个文件\n`);
