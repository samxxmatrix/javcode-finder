/**
 * 验证「有码/素人/乱码番号不会进入缓存」。
 *
 *   node verify-early-reject.mjs
 *
 * 用进程内缓存后端，按类型数键（positive / negative / ratelimit）：
 *   - 无关番号（有码、素人、乱码）→ negative 与 ratelimit 都必须保持不变
 *   - 归本服务管但源站查无的号 → negative +1
 */

process.env.API_KEY = "verify-early-key";
delete process.env.REDIS_URL; // 强制用进程内缓存，便于数键

const { default: handler } = await import("../../advanced/d2pass-api/vercel-d2pass/api/index.js");
const { memoryKeyStats } = await import("../../advanced/d2pass-api/vercel-d2pass/api/lib/cache.js");

const KEY = process.env.API_KEY;
const L = (s) => console.log(s);

function mockRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		end(p) {
			this.body = p ? JSON.parse(p) : null;
		},
	};
}
async function call(path) {
	const res = mockRes();
	await handler({ method: "GET", url: path, headers: { host: "localhost" } }, res);
	return res;
}

let pass = 0;
let fail = 0;
const check = (ok, label, detail) => {
	ok ? pass++ : fail++;
	L(`${ok ? "✅" : "❌"} ${label.padEnd(50)} ${detail}`);
};

const stats = () => memoryKeyStats();
L(`起始: ${JSON.stringify(stats())}\n`);

// 1) 无关番号：不该写任何缓存、也不该消耗限流键
for (const [code, expectClass] of [
	["IPX-118", "censored"],
	["SSIS-001", "censored"],
	["MIDE-999", "censored"],
	// 字母+连字符+数字 的形状与有码号无法区分，故按有码归类（有码数量远多于无码，这是安全的默认）
	["QQQ-000", "censored"],
	["FC2-3061625", "amateur"],
	["SIRO-4567", "amateur"],
	// 连形状都不像番号
	["ZZZZZ", "unknown"],
]) {
	const before = stats();
	const r = await call(`/api?code=${encodeURIComponent(code)}&key=${KEY}&debug=1`);
	const after = stats();
	check(
		r.statusCode === 404 && after.negative === before.negative && after.ratelimit === before.ratelimit && r.body?.class === expectClass,
		`${code} 不写缓存 / 不计数`,
		`status=${r.statusCode} class=${r.body?.class} neg ${before.negative}→${after.negative} rl ${before.ratelimit}→${after.ratelimit} 早退=${r.body?.debug?.cacheSkipped}`,
	);
}

// 2) 压力场景：连打 40 个有码号（"有码远多于无码"的真实形态）
{
	const before = stats();
	for (let i = 0; i < 40; i++) await call(`/api?code=MIDE-${100 + i}&key=${KEY}`);
	const after = stats();
	check(after.negative === before.negative && after.ratelimit === before.ratelimit, "连打 40 个有码号：零缓存写入、零限流计数", `neg ${before.negative}→${after.negative} rl ${before.ratelimit}→${after.ratelimit}`);
}

// 3) 归本服务管但源站查无 → 必须写负结果缓存（否则每次都要打源站）
{
	const before = stats();
	const r = await call(`/api?code=HEYZO-3949&key=${KEY}`);
	const after = stats();
	check(
		r.statusCode === 404 && after.negative === before.negative + 1 && after.ratelimit === before.ratelimit + 1,
		"查无的无码号：写 1 个负结果键 + 1 个限流键",
		`neg ${before.negative}→${after.negative} rl ${before.ratelimit}→${after.ratelimit}`,
	);
}

// 4) 批量：全是有码号 → 不产生缓存键
{
	const before = stats();
	const codes = Array.from({ length: 10 }, (_, i) => `ABP-${200 + i}`).join(",");
	const r = await call(`/batch?codes=${codes}&key=${KEY}`);
	const after = stats();
	check(
		r.statusCode === 200 &&
			Object.keys(r.body?.results || {}).length === 0 &&
			Object.keys(r.body?.errors || {}).length === 10 &&
			after.negative === before.negative &&
			after.ratelimit === before.ratelimit,
		"批量全有码：0 结果 / 10 错误 / 零缓存写入",
		`neg ${before.negative}→${after.negative} rl ${before.ratelimit}→${after.ratelimit}`,
	);
}

// 5) 混合批量：只处理归本服务管的那一个
{
	const before = stats();
	const r = await call(`/batch?codes=IPX-118,HEYZO-3953,QQQ-000&key=${KEY}`);
	const after = stats();
	check(
		r.statusCode === 200 &&
			Object.keys(r.body?.results || {}).includes("HEYZO-3953") &&
			Object.keys(r.body?.errors || {}).length === 2 &&
			after.positive > before.positive,
		"混合批量：只解析无码号，其余就地拒绝",
		`results=${Object.keys(r.body?.results || {}).join(",")} errors=${Object.keys(r.body?.errors || {}).join(",")}`,
	);
}

L(`\n通过 ${pass}，失败 ${fail}`);
