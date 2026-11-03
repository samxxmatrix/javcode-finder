/**
 * Redis 缓存验证：区分"Redis 生效"与"仅进程内内存缓存"。
 *
 * 手法：每个番号打两次，第二次换一个无意义参数（绕开 CDN 边缘缓存，强制真进函数）。
 *   - Redis 生效  → 第二次必然 cached:true（跨实例共享）
 *   - 仅内存缓存 → 第二次落在别的实例上就会 cached:false
 * 同时把首次调用错开（先全部打第一次，再全部打第二次），提高命中不同实例的概率。
 */

// base 取值：argv[2] > 环境变量 PROXY_BASE > 报错退出（不设硬编码域名兜底）
const BASE = (process.argv[2] || process.env.PROXY_BASE || "").replace(/\/+$/, "");
const KEY = process.argv[3];
if (!BASE || !KEY) {
	console.error("用法: node verify-redis.mjs <base> <API_KEY>   （base 也可用环境变量 PROXY_BASE）");
	process.exit(1);
}

// 都是此前未在生产查过的番号（避免复用已缓存结果）
const CODES = ["100126_01", "HEYZO-3950", "HEYZO-3949", "ori1812", "ori1967", "hitozuma1585", "04683", "3dw-316"];

const call = async (code, bust) => {
	const r = await fetch(`${BASE}/api?code=${encodeURIComponent(code)}&key=${encodeURIComponent(KEY)}&_=${bust}`);
	let b = null;
	try {
		b = await r.json();
	} catch {}
	return { status: r.status, body: b, cache: r.headers.get("x-vercel-cache"), ms: Date.now() };
};

const L = (s) => console.log(s);

L(`目标 ${BASE}｜冷却全部 ${CODES.length} 个番号\n`);
L("第一轮（各自首次，应全部 cached:false）");
const first = {};
for (const code of CODES) {
	const t = Date.now();
	const r = await call(code, `a-${Date.now()}`);
	first[code] = r;
	L(`  ${code.padEnd(14)} status=${r.status} site=${String(r.body?.site_id || r.body?.error).padEnd(16)} cached=${r.body?.cached} ${Date.now() - t}ms`);
	await new Promise((r) => setTimeout(r, 150));
}

L("\n第二轮（换 cache-buster，绕开 CDN）");
let hits = 0;
let misses = 0;
const noData = [];
for (const code of CODES) {
	const keep = first[code].status === 200;
	const t = Date.now();
	const r = await call(code, `b-${Date.now()}`);
	const ok = r.body?.cached === true;
	if (!keep) {
		noData.push(code);
		L(`  ${code.padEnd(14)} status=${r.status} (首轮未解析成功，跳过判定)`);
		continue;
	}
	ok ? hits++ : misses++;
	L(`  ${code.padEnd(14)} status=${r.status} cached=${r.body?.cached} edge=${r.cache} ${Date.now() - t}ms  ${ok ? "✅" : "❌"}`);
	await new Promise((r2) => setTimeout(r2, 100));
}

L(`\n跨 URL 缓存命中: ${hits} 命中 / ${misses} 未命中${noData.length ? `（${noData.length} 个首轮未成功，未计入）` : ""}`);
if (misses === 0 && hits > 0) L("=> ✅ Redis 生效：换 URL 绕开 CDN 后仍全部命中缓存，只可能来自 Redis 跨实例共享");
else if (hits > 0 && misses > 0) L("=> ⚠️ 部分命中：像进程内内存缓存（不同实例各存一份）。Redis 可能未生效或连接失败");
else L("=> ❌ 全部未命中：缓存完全没生效（Redis 未连接且内存缓存也没命中）");
