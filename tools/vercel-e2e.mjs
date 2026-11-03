/**
 * 反代端点端到端验证（打在**生产部署**上）
 *
 * Key 取值顺序（都不会打印明文）：
 *   1. 环境变量 PROXY_API_KEY
 *   2. 不入库的私有文件 advanced/SECRETS.local.md 里的 PROXY_API_KEY= / API_KEY=
 *      （该文件已被 .gitignore 排除，也不在 Vercel 项目目录内，不会被部署上传）
 *
 * 用法：node tools/vercel-e2e.mjs <base-url>     或     npm run e2e:proxy
 *
 * base（验收目标）取值顺序：命令行参数 > 环境变量 PROXY_BASE > 私有文件里的 PROXY_BASE。
 *   **三者都没有就报错退出**——脚本不带任何硬编码域名，换台机器必须自己指定。
 *   直连不上 *.vercel.app 时（代理把它丢进 fake-IP，解析到 198.18.x.x → ECONNRESET），
 *   在私有文件里写一行 PROXY_BASE=https://你的反代域名 即可。
 *
 * 检查项：
 *   1. /faleno/FNS-263 首次   → 200 channel=faleno，带预告片 URL
 *   2. 同番号二次             → cached=true（Redis 生效）
 *   3. 不存在的番号            → 404 / ITEM_NOT_FOUND
 *   4. /cid/BDSM-091（无 Key） → 401 / MISSING_API_KEY（DMM 回归：接口活着）
 *   5. /faleno/FNS-263（无 Key）→ 401 / MISSING_API_KEY（新端点同样受 Key 保护）
 *   6. /BDSM-091 档位：preview_quality 落在 [320,600]、preview_url 是 mp4；
 *      6b. ?quality=1080p 覆盖生效（严格 NNNp）
 *   7. /ZZZ-999 真查无仍是 404 ITEM_NOT_FOUND（404/503 分离不能改坏它）
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

/**
 * 验收目标 base：命令行参数 > PROXY_BASE 环境变量 > 私有文件里的 PROXY_BASE。
 * 都没有就报错退出——不设硬编码兜底，避免把某台机器的部署地址写死在仓库里。
 */
function resolveBase() {
	const fromArgv = process.argv[2]?.trim();
	if (fromArgv) return fromArgv;
	const fromEnv = process.env.PROXY_BASE?.trim();
	if (fromEnv) return fromEnv;
	const fromFile = readLocalEnv(/^\s*PROXY_BASE\s*=\s*(.+?)\s*$/);
	if (fromFile) return fromFile;
	console.error(
		[
			"缺少验收目标地址。三选一：",
			"  1) 命令行参数：node tools/vercel-e2e.mjs https://<你的域名>",
			'  2) 环境变量：$env:PROXY_BASE="https://<你的域名>"    （bash: export PROXY_BASE=https://<你的域名>）',
			"  3) 在不入库的私有文件 advanced/SECRETS.local.md 里写一行：PROXY_BASE=https://<你的域名>",
		].join("\n"),
	);
	process.exit(2);
}

const base = resolveBase().replace(/\/+$/, "");

/** 从环境变量或本地 env 文件解析 Key；找不到返回空串 */
function resolveKey() {
	if (process.env.PROXY_API_KEY?.trim()) return process.env.PROXY_API_KEY.trim();
	return readLocalEnv(/^\s*(?:PROXY_API_KEY|API_KEY)\s*=\s*(.+?)\s*$/);
}

const key = resolveKey();
if (!key) {
	console.error(
		[
			"缺少 API Key。二选一：",
			'  1) 设环境变量：$env:PROXY_API_KEY="<key>"       （bash: export PROXY_API_KEY=<key>）',
			"  2) 生成 advanced/SECRETS.local.md（不进 git、不会被部署上传）：",
			"     vercel env pull advanced/SECRETS.local.md --environment=production --yes --cwd advanced/dmm-api/vercel-dmm",
		].join("\n"),
	);
	process.exit(2);
}

async function call(path) {
	// 网络层失败（ECONNRESET / 超时 / DNS）不能让整脚本崩掉：返回 status 0 + 摘要，
	// 断言会以 FAIL 的形式把原因打出来，末尾还会打印首次响应摘要。
	try {
		const res = await fetch(`${base}${path}`, { redirect: "follow" });
		const text = await res.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			// 非 JSON（如 HTML 错误页）时保留原文摘要
		}
		return { status: res.status, json, head: text.slice(0, 160) };
	} catch (err) {
		return {
			status: 0,
			json: null,
			head: `网络错误: ${err?.cause?.code ?? err?.message ?? err}`,
		};
	}
}

let failed = 0;
function check(label, actual, expected) {
	const ok = actual === expected;
	if (!ok) failed += 1;
	console.log(
		`${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`,
	);
}

console.log(`base=${base}`);

const first = await call(`/faleno/FNS-263?key=${encodeURIComponent(key)}`);
check("1) 首次 status", first.status, 200);
check("1) channel", first.json?.channel, "faleno");
check("1) cid", first.json?.cid, "fns263");
check("1) preview_url 后缀", String(first.json?.preview_url).endsWith("FNS-263_PR.mp4"), true);
check("1) detail_url", first.json?.detail_url, "https://faleno.jp/top/works/fns263/");
console.log(`     cached=${first.json?.cached} short_title=${String(first.json?.short_title).slice(0, 30)}…`);

const second = await call(`/faleno/FNS-263?key=${encodeURIComponent(key)}`);
check("2) 二次 status", second.status, 200);
check("2) cached=true（Redis 生效）", second.json?.cached, true);

const missing = await call(`/faleno/ZZZ-999?key=${encodeURIComponent(key)}`);
check("3) 不存在番号 status", missing.status, 404);
check("3) error", missing.json?.error, "ITEM_NOT_FOUND");

const dmmNoKey = await call(`/cid/BDSM-091`);
check("4) DMM 无 Key status", dmmNoKey.status, 401);
check("4) DMM 无 Key error", dmmNoKey.json?.error, "MISSING_API_KEY");

const falenoNoKey = await call(`/faleno/FNS-263`);
check("5) FALENO 无 Key status", falenoNoKey.status, 401);
check("5) FALENO 无 Key error", falenoNoKey.json?.error, "MISSING_API_KEY");

// 6) 档位选择（DMM 侧；refresh=1 保证拿到新口径而不是旧缓存）
const tiered = await call(`/BDSM-091?key=${encodeURIComponent(key)}&refresh=1`);
check("6) DMM 档位 status", tiered.status, 200);
const tierHeight = Number(String(tiered.json?.preview_quality ?? "").replace("p", ""));
check("6) preview_quality 落在 [320,600]", tierHeight >= 320 && tierHeight <= 600, true);
check("6) preview_url 是 mp4", String(tiered.json?.preview_url).endsWith(".mp4"), true);
console.log(
	`     preview_quality=${tiered.json?.preview_quality} 档数=${tiered.json?.preview_qualities?.length} v=${tiered.json?.v}`,
);

const override = await call(`/BDSM-091?key=${encodeURIComponent(key)}&refresh=1&quality=1080p`);
check("6b) ?quality=1080p 覆盖生效", override.json?.preview_quality, "1080p");

// 7) 真查无仍然是 404（404/503 分离不能把"查无"改成别的，也不能被负缓存冻结）
const dmmMissing = await call(`/ZZZ-999?key=${encodeURIComponent(key)}&refresh=1`);
check("7) DMM 查无 status", dmmMissing.status, 404);
check("7) DMM 查无 error", dmmMissing.json?.error, "ITEM_NOT_FOUND");

console.log(failed === 0 ? "=== 全部通过 ===" : `=== 有 ${failed} 条失败 ===`);
if (failed > 0) {
	console.log(`首次响应原文摘要: ${first.head}`);
}
process.exit(failed === 0 ? 0 : 1);
