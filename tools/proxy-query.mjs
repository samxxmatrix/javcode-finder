/**
 * 反代查询诊断：把一个番号打穿生产端点，打印状态码、耗时、完整响应。
 *
 * 用法：
 *   node tools/proxy-query.mjs <code> [--refresh] [--debug] [--cid] [--base=<url>]
 *
 * Key 取值：PROXY_API_KEY 环境变量 → advanced/SECRETS.local.md 的 PROXY_API_KEY= / API_KEY=
 * base 取值：--base= 参数 → PROXY_BASE 环境变量 → 私有文件里的 PROXY_BASE（都没有就报错退出）
 * （打印的 URL 里 Key 一律替换为 ***，不泄露）
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 从 advanced/SECRETS.local.md / advanced/SECRETS.local.md 里读第一个匹配的行；找不到返回空串 */
function readLocalEnv(pattern) {
	for (const relative of ["../advanced/SECRETS.local.md"]) {
		const path = fileURLToPath(new URL(relative, import.meta.url));
		if (!existsSync(path)) continue;
		for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
			const matched = line.match(pattern);
			if (matched) return matched[1].replace(/^["']|["']$/g, "");
			// 兼容 Markdown 表格：| `KEY` | `VALUE` | 用途 |
			const cell = line.match(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*`([^`]+)`\s*\|/);
			if (cell) {
				const pseudo = `${cell[1]}=${cell[2]}`;
				const m2 = pseudo.match(pattern);
				if (m2) return m2[1].trim();
			}
		}
	}
	return "";
}

function resolveKey() {
	if (process.env.PROXY_API_KEY?.trim()) return process.env.PROXY_API_KEY.trim();
	return readLocalEnv(/^\s*(?:PROXY_API_KEY|API_KEY)\s*=\s*(.+?)\s*$/);
}

const args = process.argv.slice(2);
const code = args.find((a) => !a.startsWith("--"));
const key = resolveKey();
if (!code || !key) {
	console.error("用法: node tools/proxy-query.mjs <code> [--refresh] [--debug] [--cid]");
	process.exit(2);
}

// base 取值：--base= 参数 > PROXY_BASE 环境变量 > 私有文件里的 PROXY_BASE。都没有就报错，不带硬编码兜底。
const rawBase =
	args.find((a) => a.startsWith("--base="))?.slice("--base=".length) ||
	process.env.PROXY_BASE ||
	readLocalEnv(/^\s*PROXY_BASE\s*=\s*(.+?)\s*$/);
if (!rawBase) {
	console.error(
		[
			"缺少 base 地址。三选一：",
			"  1) node tools/proxy-query.mjs <code> --base=https://<你的域名>",
			'  2) $env:PROXY_BASE="https://<你的域名>"    （bash: export PROXY_BASE=https://<你的域名>）',
			"  3) 在不入库的私有文件 advanced/SECRETS.local.md 里写一行：PROXY_BASE=https://<你的域名>",
		].join("\n"),
	);
	process.exit(2);
}
const base = rawBase.replace(/\/+$/, "");

const params = new URLSearchParams({ key });
if (args.includes("--refresh")) params.set("refresh", "1");
if (args.includes("--debug")) params.set("debug", "1");

const path = args.includes("--debug")
	? `/${encodeURIComponent(code)}`
	: args.includes("--cid")
		? `/cid/${encodeURIComponent(code)}`
		: `/${encodeURIComponent(code)}`;
const url = `${base}${path}?${params}`;

const started = Date.now();
const res = await fetch(url, { redirect: "follow" });
const text = await res.text();
const ms = Date.now() - started;

console.log(`GET ${url.replace(encodeURIComponent(key), "***").replace(key, "***")}`);
console.log(`status=${res.status}  ms=${ms}  bytes=${text.length}`);
try {
	console.log(JSON.stringify(JSON.parse(text), null, 1));
} catch {
	console.log(text.slice(0, 4000));
}
