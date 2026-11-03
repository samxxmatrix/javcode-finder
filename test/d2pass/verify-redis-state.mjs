/**
 * 直连 Redis 核对缓存落地情况（键名 / TTL / 内存占用）。
 *
 * 需要 redis 客户端：npm i redis --no-save
 * REDIS_URL 取值优先级：
 *   1) 环境变量 REDIS_URL（推荐，你自己从 Vercel 面板复制）
 *   2) 回退：从 Vercel API 读取（decrypt=true）—— 实测 sensitive 类型取不到，通常走不通
 * 无论哪种方式，**URL 都不会被打印**。
 *
 *   $env:REDIS_URL="rediss://..."; node verify-redis-state.mjs
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const SECRETS = fileURLToPath(new URL("../../advanced/SECRETS.local.md", import.meta.url));

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

function required(name, hint) {
	const value = process.env[name] || readPrivate(name);
	if (value) return value;
	console.error(`缺少 ${name}：${hint}\n  可设同名环境变量，或在 advanced/SECRETS.local.md 里写一行 ${name}=<值>`);
	process.exit(2);
}

const L = (s) => console.log(s);

let redisUrl = process.env.REDIS_URL || "";
let apiKey = process.env.D2PASS_API_KEY || "";
let base = (process.env.PROXY_BASE || readPrivate("D2PASS_BASE") || "").replace(/\/+$/, "");
if (!apiKey) {
	apiKey =
		process.env.D2PASS_API_KEY ||
		readPrivate("API_KEY_D2PASS") ||
		process.env.API_KEY ||
		readPrivate("API_KEY") ||
		"";
}
if (!redisUrl) {
	const token = required("VERCEL_TOKEN_D2PASS", "用于调 Vercel API 读取环境变量");
	const project = required("VERCEL_PROJECT_D2PASS", "Vercel 项目名");
	const team = process.env.VERCEL_TEAM_ID_D2PASS || readPrivate("VERCEL_TEAM_ID_D2PASS") || "";
	const query = new URLSearchParams({ decrypt: "true" });
	if (team) query.set("teamId", team);
	const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(project)}/env?${query}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	const { envs = [] } = await res.json();
	redisUrl = (envs.find((e) => e.key === "REDIS_URL") || {}).value || "";
	apiKey = apiKey || (envs.find((e) => e.key === "API_KEY") || {}).value || "";
}
if (!base) {
	console.error(
		"缺少 base：设 PROXY_BASE 环境变量，或在 advanced/SECRETS.local.md 里写一行 D2PASS_BASE=https://<你的域名>",
	);
	process.exit(2);
}
if (!redisUrl) {
	L("❌ 没有 REDIS_URL。请显式传：$env:REDIS_URL=\"rediss://...\"; node verify-redis-state.mjs");
	L("   （sensitive 类型的变量无法通过 Vercel API 解密，所以必须手动提供）");
	process.exit(1);
}
L(`REDIS_URL 已就绪（长度 ${redisUrl.length}，协议 ${redisUrl.split(":")[0]}://，内容不打印）`);

const { createClient } = await import("redis").catch(() => {
	L("❌ 缺少 redis 客户端：npm i redis --no-save");
	process.exit(1);
});
const client = createClient({ url: redisUrl });
client.on("error", (e) => L(`  [redis error] ${e.message}`));
await client.connect();

L(`\n=== 连接 ===`);
L(`  PING: ${await client.ping()}`);

const info = await client.info("memory");
const pick = (k) => (new RegExp(`${k}:(\\S+)`).exec(info) || [])[1];
L(`  used_memory: ${pick("used_memory_human")}  | peak: ${pick("used_memory_peak_human")}  | maxmemory: ${pick("maxmemory_human")}`);

L(`\n=== 键统计 ===`);
const keys = [];
for await (const batch of client.scanIterator({ MATCH: "D2P:*", COUNT: 200 })) {
	const arr = Array.isArray(batch) ? batch : [batch];
	keys.push(...arr);
	if (keys.length > 5000) break;
}
const positive = keys.filter((k) => !k.startsWith("D2P:NF:") && !k.startsWith("D2P:RL:"));
const negative = keys.filter((k) => k.startsWith("D2P:NF:"));
const ratelimit = keys.filter((k) => k.startsWith("D2P:RL:"));
L(`  总键数: ${keys.length}（正结果 ${positive.length} / 负结果 ${negative.length} / 限流 ${ratelimit.length}）`);
L(`  样例: ${keys.slice(0, 6).join(", ")}`);

L(`\n=== TTL 抽查（正结果应为 -1 = 永久；负结果应 ≈ 21600s = 6h）===`);
for (const k of positive.slice(0, 3)) L(`  ${k.padEnd(28)} TTL=${await client.ttl(k)}  (${await client.strLen(k)} B)`);
for (const k of negative.slice(0, 3)) L(`  ${k.padEnd(28)} TTL=${await client.ttl(k)}`);
if (positive.length === 0) L("  (暂无正结果键)");
if (negative.length === 0) L("  (暂无负结果键)");

L(`\n=== 负缓存写入验证（查一个不存在的号，然后立刻看键）===`);
const probe = "HEYZO-3949";
if (apiKey) {
	await fetch(`${base}/api?code=${probe}&key=${apiKey}&_=ttl${Date.now()}`);
	await new Promise((r) => setTimeout(r, 400));
	const nk = `D2P:NF:${probe}`;
	L(`  ${nk} exists=${await client.exists(nk)} TTL=${await client.ttl(nk)}`);
} else {
	L("  (取不到 API_KEY，跳过)");
}

await client.quit();
