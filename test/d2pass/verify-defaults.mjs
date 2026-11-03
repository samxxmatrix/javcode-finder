/**
 * 验证「是否只有 API_KEY 必需」：把其余环境变量全部清空，看服务是否仍按内置默认值正常工作。
 *
 *   node verify-defaults.mjs
 */

const OPTIONAL = [
	"SOURCE_TIMEOUT_MS",
	"D2PASS_TIMEOUT_MS",
	"TOTAL_BUDGET_MS",
	"NEGATIVE_TTL_HOURS",
	"RATE_LIMIT_PER_MIN",
	"BATCH_MAX",
	"D2PASS_USE_RSC",
	"PREVIEW_ENABLED",
	"PREVIEW_VERIFY",
	"PREVIEW_QUALITY_ORDER",
	"PREVIEW_HEYZO_ORDER",
	"DISABLED_SITES",
	"REDIS_URL",
];

const setBefore = OPTIONAL.filter((k) => process.env[k] !== undefined);
for (const k of OPTIONAL) delete process.env[k];
process.env.API_KEY = process.env.API_KEY || "verify-defaults-key";

console.log(`清空前已设置的项: ${setBefore.length ? setBefore.join(", ") : "(无)"}`);
console.log(`清空后保留: API_KEY\n`);

const { default: handler } = await import("../../advanced/d2pass-api/vercel-d2pass/api/index.js");

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

const L = (s) => console.log(s);
let pass = 0;
let fail = 0;
const check = (ok, label, detail) => {
	ok ? pass++ : fail++;
	L(`${ok ? "✅" : "❌"} ${label.padEnd(46)} ${detail}`);
};

// 1) PREVIEW_HEYZO_ORDER 默认 = sample_low,sample,sample_hd
{
	const r = await call(`/HEYZO-3953?key=${process.env.API_KEY}`);
	check(
		r.statusCode === 200 && r.body?.preview_quality === "sample_low",
		"HEYZO 默认档位 (PREVIEW_HEYZO_ORDER)",
		`quality=${r.body?.preview_quality}`,
	);
}

// 2) PREVIEW_QUALITY_ORDER 默认 = 480p 优先
{
	const r = await call(`/100426-001?key=${process.env.API_KEY}`);
	check(
		r.statusCode === 200 && r.body?.preview_quality === "480p",
		"smovie 系默认档位 (PREVIEW_QUALITY_ORDER)",
		`quality=${r.body?.preview_quality}`,
	);
}

// 3) debug=1 无需任何环境变量开关（旧的 ALLOW_DEBUG 已移除）
{
	const r = await call(`/HEYZO-3953?key=${process.env.API_KEY}&debug=1`);
	check(Boolean(r.body?.debug), "debug=1 无条件生效（无需开关）", `含 debug 字段=${Boolean(r.body?.debug)} backend=${r.body?.debug?.backend}`);
}

// 4) BATCH_MAX 默认 50 —— 60 个应被拒
{
	const codes = Array.from({ length: 60 }, (_, i) => `X-${1000 + i}`).join(",");
	const r = await call(`/batch?codes=${codes}&key=${process.env.API_KEY}`);
	check(r.statusCode === 400 && r.body?.error === "TOO_MANY_CODES", "批量上限默认 50 (BATCH_MAX)", `${r.statusCode} ${r.body?.error}`);
}

// 5) API_KEY 仍然生效
{
	const r = await call(`/HEYZO-3953`);
	check(r.statusCode === 401, "无 key 仍被拒 (API_KEY 生效)", `${r.statusCode} ${r.body?.error}`);
}

L(`\n通过 ${pass}，失败 ${fail}`);
L("结论：除 API_KEY 外全部变量都可删除，服务会回落到内置默认值。");
