/**
 * 本地端到端测试：直接调用 Vercel Function 的 handler，打真实网络。
 *
 *   node test-local.mjs            跑全部用例
 *   node test-local.mjs HEYZO-3953 只跑指定番号
 *
 * 不依赖 Redis（未设 REDIS_URL 时自动用进程内缓存），也不依赖任何测试框架。
 */

process.env.API_KEY = process.env.API_KEY || "local-test-key";
process.env.NEGATIVE_TTL_HOURS = process.env.NEGATIVE_TTL_HOURS || "6";

const { default: handler } = await import("../../advanced/d2pass-api/vercel-d2pass/api/index.js");

const KEY = process.env.API_KEY;

function mockReq(url, { method = "GET", headers = {} } = {}) {
	return { method, url, headers: { host: "localhost", ...headers } };
}

function mockRes() {
	const res = {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		end(payload) {
			this.body = payload ? JSON.parse(payload) : null;
		},
	};
	return res;
}

async function call(path, { method = "GET", headers = {} } = {}) {
	const res = mockRes();
	const started = Date.now();
	await handler(mockReq(path, { method, headers }), res);
	return { status: res.statusCode, body: res.body, ms: Date.now() - started, headers: res.headers };
}

const line = (s) => console.log(s);
const pad = (s, n) => String(s ?? "-").padEnd(n);

// ---------- 1) 四个已知番号（每个都实测可解析） ----------
const CASES = [
	["/HEYZO-3953", "heyzo", "sample_low"],
	["/HEYZO-3951", "heyzo", "sample_low"],
	// 该号在カリビアンコム（连字符）不存在，走分隔符兜底命中パコパコママ
	["/100126-100", "pacopacomama", "480p"],
	["/100426-001", "caribbeancom", "480p"],
];

const only = process.argv[2];

line("=== 1) 单条查询（首次，未命中缓存）===");
for (const [path, expectSite, expectQuality] of CASES) {
	if (only && !path.includes(only)) continue;
	const r = await call(`${path}?key=${KEY}`);
	const b = r.body || {};
	const ok = r.status === 200 && b.site_id === expectSite;
	line(
		`${ok ? "✅" : "❌"} ${pad(path, 16)} ${String(r.status).padEnd(4)} ${pad(b.site_id, 14)} ` +
			`${pad(b.code, 14)} preview=${pad(b.preview_quality, 10)} ${String(r.ms + "ms").padEnd(8)} d2pass=${b.d2pass_url || "-"}`,
	);
	if (b.preview_url) line(`     preview: ${b.preview_url}`);
	if (b.cover_url) line(`     cover  : ${b.cover_url}`);
	if (b.short_title) line(`     short  : ${b.short_title}`);
	if (b.title) line(`     plot   : ${String(b.title).slice(0, 70)}${String(b.title).length > 70 ? "…" : ""}`);
	if (r.status !== 200) line(`     error  : ${JSON.stringify(b)}`);
}

// ---------- 2) 缓存命中（正结果永久） ----------
line("\n=== 2) 再查一次：应 cached:true 且明显更快 ===");
for (const [path] of CASES) {
	if (only && !path.includes(only)) continue;
	const r = await call(`${path}?key=${KEY}`);
	line(`${r.body?.cached ? "✅" : "❌"} ${pad(path, 16)} cached=${r.body?.cached} ${r.ms}ms`);
}

// ---------- 3) 路由规则回归（写法区分片商） ----------
line("\n=== 3) 路由规则：写法决定片商 ===");
for (const [code, expect] of [
	["100426-001", "caribbeancom"],
	["100326_01", "10musume"],
	["100426_1267", "muramura"],
	["100126_100", "pacopacomama"],
	["HEYZO-3953", "heyzo"],
]) {
	const r = await call(`/api?code=${encodeURIComponent(code)}&key=${KEY}&debug=1`);
	const got = r.body?.site_id || r.body?.error || "?";
	line(`${got === expect ? "✅" : "⚠️"} ${pad(code, 16)} -> ${pad(got, 16)} (期望 ${expect}) ${r.ms}ms`);
}

// ---------- 4) 批量 ----------
line("\n=== 4) 批量接口（部分成功）===");
{
	const codes = ["HEYZO-3953", "100126-100", "100426-001", "QQQ-000"];
	const r = await call(`/batch?codes=${codes.join(",")}&key=${KEY}`);
	const body = r.body || {};
	line(`status=${r.status} results=${Object.keys(body.results || {}).length} errors=${Object.keys(body.errors || {}).length} ${r.ms}ms`);
	line(`  cached: ${JSON.stringify(body.cached)}`);
	if (body.errors) line(`  errors: ${JSON.stringify(body.errors)}`);
}

// ---------- 5) 鉴权与参数错误 ----------
line("\n=== 5) 鉴权 / 参数 ===");
{
	const a = await call("/HEYZO-3953");
	line(`${a.status === 401 ? "✅" : "❌"} 无 key -> ${a.status} ${a.body?.error}`);
	const b = await call(`/HEYZO-3953?key=wrong`);
	line(`${b.status === 403 ? "✅" : "❌"} 错误 key -> ${b.status} ${b.body?.error}`);
	const c = await call(`/batch?key=${KEY}`);
	line(`${c.status === 400 ? "✅" : "❌"} 批量缺参数 -> ${c.status} ${c.body?.error}`);
	const d = await call(`/NOPE-000?key=${KEY}`);
	line(`${d.status === 404 ? "✅" : "❌"} 未知番号 -> ${d.status} ${d.body?.error}`);
}

line("\n完成。");
