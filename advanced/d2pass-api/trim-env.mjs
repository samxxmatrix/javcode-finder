/**
 * 精简 Vercel 项目里多余的环境变量（只保留白名单，其余删除）。
 *
 *   node trim-env.mjs            # 干跑：列出将要删除的项
 *   node trim-env.mjs --apply    # 真删
 *
 * 安全性：
 *   - **白名单式**：只删不在 KEEP 里的键，绝不删 REDIS_URL / API_KEY（REDIS_URL 是 sensitive，
 *     删了就得去提供方控制台重新取，代价很大）；
 *   - 删除后需要**重新部署**才彻底生效；若之后又跑 deploy-rest.mjs，它只会写回 KEEP 里的那几项。
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const SECRETS = fileURLToPath(new URL("../SECRETS.local.md", import.meta.url));

/** 从私有文件读一个键；支持 `KEY=value` 与 Markdown 表格行 */
function readPrivate(name) {
	if (!fs.existsSync(SECRETS)) return "";
	for (const line of fs.readFileSync(SECRETS, "utf8").split(/\r?\n/)) {
		const kv = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`));
		if (kv) return kv[1].replace(/^["']|["']$/g, "");
		const cell = line.match(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*`([^`]+)`\s*\|/);
		if (cell && cell[1] === name) return cell[2].trim();
	}
	return "";
}

/** 环境变量优先；都拿不到就报错退出——脚本内不再硬编码项目名/团队/token */
function required(name, hint) {
	const value = process.env[name] || readPrivate(name);
	if (value) return value;
	console.error(`缺少 ${name}：${hint}\n  可设同名环境变量，或在 advanced/SECRETS.local.md 里写一行 ${name}=<值>`);
	process.exit(2);
}

/** 要保留的键：必需项 + 明确产品决策（debug=1 已无条件生效，不再需要 ALLOW_DEBUG） */
// KV_* 是 Marketplace 集成注入的，代码虽然不读，但删掉后若改用 KV REST 接口就找不回来了
const KEEP = new Set([
	"API_KEY",
	"REDIS_URL",
	"KV_URL",
	"KV_REST_API_URL",
	"KV_REST_API_TOKEN",
	"KV_REST_API_READ_ONLY_TOKEN",
	"PREVIEW_QUALITY_ORDER",
	"PREVIEW_HEYZO_ORDER",
]);

const L = (s) => console.log(s);

const token = required("VERCEL_TOKEN_D2PASS", "用于调 Vercel API");
const PROJECT = required("VERCEL_PROJECT_D2PASS", "Vercel 项目名");
const TEAM_ID = readPrivate("VERCEL_TEAM_ID_D2PASS") || process.env.VERCEL_TEAM_ID_D2PASS || "";

const api = async (method, path) => {
	const res = await fetch(`https://api.vercel.com${path}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
	});
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* 保留 text */
	}
	return { status: res.status, json, text };
};

const listed = await api(
	"GET",
	`/v9/projects/${encodeURIComponent(PROJECT)}/env?decrypt=false${TEAM_ID ? `&teamId=${TEAM_ID}` : ""}`,
);
if (listed.status !== 200) {
	L(`❌ 读取环境变量失败 ${listed.status}: ${listed.text.slice(0, 200)}`);
	process.exit(1);
}
const envs = listed.json.envs || [];
const drop = envs.filter((e) => !KEEP.has(e.key));
const keep = envs.filter((e) => KEEP.has(e.key));

L(`当前 ${envs.length} 项 → 保留 ${keep.length} 项，删除 ${drop.length} 项\n`);
L(`保留:`);
for (const e of keep) L(`  ✔ ${e.key.padEnd(24)} type=${e.type} targets=${JSON.stringify(e.target)}`);
L(`\n${APPLY ? "删除:" : "将删除（干跑）:"}`);
for (const e of drop) L(`  ✘ ${e.key.padEnd(24)} type=${e.type} value=${e.type === "plain" ? e.value : "(隐藏)"}`);

if (!APPLY) {
	L(`\n干跑模式：什么都没删。确认无误后加 --apply。`);
	L(`注意：删除后需重新部署才彻底生效。`);
} else {
	L("");
	let ok = 0;
	let fail = 0;
	for (const e of drop) {
		const res = await api(
			"DELETE",
			`/v9/projects/${encodeURIComponent(PROJECT)}/env/${e.id}${TEAM_ID ? `?teamId=${TEAM_ID}` : ""}`,
		);
		if (res.status < 300) {
			ok++;
			L(`  🗑 已删 ${e.key}`);
		} else {
			fail++;
			L(`  ❌ 删除失败 ${e.key} -> ${res.status} ${res.text.slice(0, 120)}`);
		}
	}
	L(`\n删除 ${ok} 项，失败 ${fail} 项`);
	L(`别忘了重新部署：$env:D2PASS_API_KEY="..."; node deploy-rest.mjs`);
}
