/**
 * 直接用**本地 handler** 查任意番号（不需要 API key，走真实网络），打印完整响应。
 * 用于排查"某个番号为什么没有封面/出演者/日期"——本地跑的就是部署上去的同一份代码。
 *
 * 用法（需代理出网）：
 *   node tools/d2pass-query-local.mjs 052725-001 100426-001
 */
process.env.API_KEY = process.env.API_KEY || "local-test-key";
process.env.NEGATIVE_TTL_HOURS = process.env.NEGATIVE_TTL_HOURS || "6";

const { default: handler } = await import("../advanced/d2pass-api/api/index.js");
const KEY = process.env.API_KEY;

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

const codes = process.argv.slice(2);
if (codes.length === 0) {
	console.error("用法: node tools/d2pass-query-local.mjs <番号> [更多番号...]");
	process.exit(2);
}

for (const code of codes) {
	const res = mockRes();
	const started = Date.now();
	await handler(
		{ method: "GET", url: `/${code}?key=${KEY}&refresh=1`, headers: { host: "localhost" } },
		res,
	);
	const ms = Date.now() - started;
	console.log(`\n=== ${code}  status=${res.statusCode}  ${ms}ms ===`);
	if (res.body === null) {
		console.log("(空响应)");
		continue;
	}
	console.log(JSON.stringify(res.body, null, 1).slice(0, 1800));
}
