/**
 * 清理测试期间写进 Redis 的缓存键。
 *
 *   node purge-test-cache.mjs                 # 干跑：只列出将要删的键，不删
 *   node purge-test-cache.mjs --apply         # 真删（仅"测试专用"番号：有码/素人/乱码）
 *   node purge-test-cache.mjs --apply --include-real   # 连真实无码号的热缓存也一并清掉
 *
 * 安全性：
 *   - 只删测试脚本里出现过的番号，**不用 SCAN 通配符**，不会误伤正常缓存；
 *   - REDIS_URL 从环境变量读取（或尝试从 Vercel API 取，通常取不到，见 verify-redis-state.mjs）；
 *   - 不打印 URL 内容。
 *
 * 删除缓存是零风险的：这些键是纯缓存，不参与任何状态机。代价只是下次查同一个番号
 * 要重新解析（1–3 秒）并多打一次上游。
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

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

/** 环境变量优先；都拿不到就报错退出——脚本内不再硬编码项目名/团队/域名 */
function required(name, hint) {
	const value = process.env[name] || readPrivate(name);
	if (value) return value;
	console.error(`缺少 ${name}：${hint}\n  可设同名环境变量，或在 advanced/SECRETS.local.md 里写一行 ${name}=<值>`);
	process.exit(2);
}

const APPLY = process.argv.includes("--apply");
const INCLUDE_REAL = process.argv.includes("--include-real");
const L = (s) => console.log(s);

// ---------- 1) 从测试脚本里收集用过的番号 ----------
// 只认"带引号的字面量"，避免把 timeoutMs: 5000 这类配置数字误当番号
const SCRIPT_RE = /^(test-|verify-|smoke-|show-|purge-).*\.mjs$/;
const CODE_RE =
	/["'`]((?:HEYZO[-_]?\d{3,5}|[A-Z][A-Z0-9]{1,5}-\d{2,7}|\d{6}[-_]\d{2,4}|\d{3,5}[-_/]\d{2,4}|(?:ori|gol|les|hitozuma|3dw|n)\d{3,5}))["'`]/gi;

// 测试脚本已统一放在仓库根的 test/d2pass/，不再散落在项目目录里
const SCAN_DIRS = [
	process.env.TEST_SCAN_DIR || fileURLToPath(new URL("../../test/d2pass/", import.meta.url)),
];
const codes = new Set();
let scanned = 0;
for (const dir of SCAN_DIRS) {
	if (!fs.existsSync(dir)) continue;
	for (const file of fs.readdirSync(dir)) {
		if (!SCRIPT_RE.test(file)) continue;
		scanned++;
		const text = fs.readFileSync(`${dir}/${file}`, "utf8");
		for (const m of text.matchAll(CODE_RE)) codes.add(m[1].toUpperCase());
	}
}
if (scanned === 0) {
	console.error(
		`没有扫到任何测试脚本（扫描目录: ${SCAN_DIRS.join(", ")}）。\n` +
			"可用 TEST_SCAN_DIR 指定目录；确认测试脚本没被移走，否则本脚本会静默空转。",
	);
	process.exit(2);
}

const { classifyCode } = await import("./vercel-d2pass/api/lib/codes.js");
const testOnly = [...codes].filter((c) => classifyCode(c) !== "uncensored").sort();
const real = [...codes].filter((c) => classifyCode(c) === "uncensored").sort();

L(`从测试脚本扫出 ${codes.size} 个番号：`);
L(`  测试专用（有码/素人/乱码，${testOnly.length} 个）: ${testOnly.join(" ")}`);
L(`  真实无码号（${real.length} 个）: ${real.join(" ")}`);
L(`\n要删的键:`);
const targets = [...testOnly, ...(INCLUDE_REAL ? real : [])].flatMap((c) => [`D2P:${c}`, `D2P:NF:${c}`]);
L(`  ${targets.length} 个${INCLUDE_REAL ? "（含真实无码号热缓存）" : "（不含真实无码号，加 --include-real 才会清）"}`);
if (!APPLY) L(`\n干跑模式：什么都没删。确认无误后加 --apply。`);

// ---------- 2) 连 Redis 执行 ----------
let redisUrl = process.env.REDIS_URL || "";
if (!redisUrl) {
	try {
		const token = required("VERCEL_TOKEN_D2PASS", "用于调 Vercel API 读取环境变量");
		const project = required("VERCEL_PROJECT_D2PASS", "Vercel 项目名");
		const team = readPrivate("VERCEL_TEAM_ID_D2PASS") || process.env.VERCEL_TEAM_ID_D2PASS || "";
		const query = new URLSearchParams({ decrypt: "true" });
		if (team) query.set("teamId", team);
		const res = await fetch(
			`https://api.vercel.com/v9/projects/${encodeURIComponent(project)}/env?${query}`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		const { envs = [] } = await res.json();
		redisUrl = (envs.find((e) => e.key === "REDIS_URL") || {}).value || "";
	} catch {
		/* 忽略，下面统一报错 */
	}
}
if (!redisUrl) {
	L(`\n❌ 没有 REDIS_URL。`);
	L(`   注意：Vercel 里 REDIS_URL 是 sensitive 类型，**创建后无法再查看**，要去 Redis 提供方控制台取：`);
	L(`     · Upstash 集成 → 登录 upstash.com → 对应数据库 → Connect → 复制 rediss://... 串`);
	L(`     · 或你自己的 Redis（Redis Cloud 等）控制台里的连接串`);
	L(`   取到后这样传（<...> 是要替换的占位符，别原样粘贴）：`);
	L(`     $env:REDIS_URL="rediss://default:密码@主机:6379"`);
	L(`     node purge-test-cache.mjs --apply`);
	process.exit(APPLY ? 1 : 0);
}

// 常见误操作：把文档占位符原样设进来，或把整行 KEY=value 粘进来
redisUrl = redisUrl.trim().replace(/^["']|["']$/g, "");
if (/^REDIS_URL\s*=/i.test(redisUrl)) redisUrl = redisUrl.replace(/^REDIS_URL\s*=\s*/i, "").replace(/^["']|["']$/g, "");
if (!/^rediss?:\/\//i.test(redisUrl)) {
	L(`\n❌ REDIS_URL 不是有效的连接串（应以 redis:// 或 rediss:// 开头）`);
	L(`   实际拿到的值: ${JSON.stringify(redisUrl.slice(0, 40))}${redisUrl.length > 40 ? "…" : ""}`);
	if (/[<>]/.test(redisUrl)) L(`   ⚠️ 看起来你把文档里的占位符 <从 Vercel 面板复制> 原样设进去了，请换成真实连接串。`);
	L(`   正确示例: $env:REDIS_URL="rediss://default:AbCd1234@xxx.upstash.io:6379"`);
	process.exit(1);
}

const { createClient } = await import("redis").catch(() => {
	L(`\n❌ 缺少 redis 客户端：npm i redis --no-save`);
	process.exit(1);
});
const client = createClient({
	url: redisUrl,
	// 连不上就快速失败，别挂在那里（reconnectStrategy: false 关掉无限重连）
	socket: { connectTimeout: 6000, reconnectStrategy: false },
});
client.on("error", (e) => L(`  [redis error] ${e.message}`));
try {
	await client.connect();
} catch (err) {
	L(`\n❌ 连不上 Redis：${err?.message || err}`);
	L(`   检查：① 连接串是否完整（含密码与端口）② 该 Redis 是否允许你当前网络的出口 IP`);
	process.exit(1);
}

L(`\n=== 逐个检查（存在才删）===`);
let found = 0;
let deleted = 0;
for (const key of targets) {
	const exists = await client.exists(key);
	if (!exists) continue;
	found++;
	const ttl = await client.ttl(key);
	if (APPLY) {
		await client.del(key);
		deleted++;
		L(`  🗑 已删 ${key.padEnd(30)} (原 TTL=${ttl})`);
	} else {
		L(`  • 存在 ${key.padEnd(30)} (TTL=${ttl})`);
	}
}

// 限流键 60s 自动过期，只做提示
const rlSample = [];
for await (const batch of client.scanIterator({ MATCH: "D2P:RL:*", COUNT: 100 })) {
	for (const k of Array.isArray(batch) ? batch : [batch]) rlSample.push(k);
	if (rlSample.length >= 5) break;
}
if (rlSample.length) L(`\n（另有 D2P:RL:* 限流键至少 ${rlSample.length} 个，TTL 60 秒会自己消失，无需处理）`);

L(`\n命中 ${found} 个键，${APPLY ? `已删除 ${deleted} 个` : `干跑未删（加 --apply 执行）`}`);
await client.quit();
