/**
 * advanced/adaptive-proxy.js（Cloudflare Worker）的单测：DOMAIN 归一化 + 失败时的对外表现。
 *
 * 用法：node tools/dmm-proxy-domain-unit.mjs
 * 为什么要有它：这个 Worker 读的是**环境变量**，配错的表现是"线上全 404"，
 * 而本地不做任何断言就发现不了。本脚本用真实 Request + 桩 fetch 断言转发目标与状态码。
 */

const mod = (await import(new URL("../advanced/adaptive-proxy.js", import.meta.url).href)).default;

let captured = [];
globalThis.fetch = async (url) => {
	captured.push(String(url));
	return new Response("ok");
};

const req = () => new Request("https://api.example.com/BDSM-091?key=k");

// Worker 失败时会 console.error 记原因（给 CF 日志看，访客看不到）。
// 这里把它收集起来：既不让 stderr 把脚本运行标成失败，又能断言"原因确实被记录了"。
const logs = [];
const realConsoleError = console.error;
console.error = (...args) => logs.push(args.join(" "));

let failed = 0;
function check(label, actual, expected) {
	const ok = actual === expected;
	if (!ok) failed += 1;
	console.log(
		`${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`,
	);
}

async function call(env) {
	captured = [];
	let res;
	try {
		res = await mod.fetch(req(), env);
	} catch (err) {
		return { target: captured[0] ?? null, status: "THREW", body: String(err?.message ?? err) };
	}
	return { target: captured[0] ?? null, status: res.status, body: await res.text() };
}

console.log("=== DOMAIN 带不带 https:// 都应生效 ===");
check("不带协议", (await call({ DOMAIN: "api.example.com" })).target, "https://api.example.com/BDSM-091?key=k");
check("带 https 与尾斜杠", (await call({ DOMAIN: "https://api.example.com/" })).target, "https://api.example.com/BDSM-091?key=k");
check("首尾空白 + 包裹引号", (await call({ DOMAIN: '  "api.example.com"  ' })).target, "https://api.example.com/BDSM-091?key=k");
check("显式 http 按你写的来", (await call({ DOMAIN: "http://127.0.0.1:3000" })).target, "http://127.0.0.1:3000/BDSM-091?key=k");
check("带路径前缀", (await call({ DOMAIN: "example.com/base/" })).target, "https://example.com/base/BDSM-091?key=k");
check("变量名只有 DOMAIN（旧名不再生效）", (await call({ UPSTREAM_ORIGIN: "legacy.example.com" })).status, 404);

console.log("\n=== 未配置/非法：空 404，不写内容、不转发、不抛异常 ===");
logs.length = 0;
const missing = await call({});
check("未设置 status", missing.status, 404);
check("未设置 响应体为空", missing.body, "");
check("未设置 不发出请求", missing.target, null);
check("未设置 原因只进日志（访客看不到）", logs.length > 0, true);
const blank = await call({ DOMAIN: "   " });
check("空白值 status", blank.status, 404);
check("空白值 响应体为空", blank.body, "");
check("空白值 不发出请求", blank.target, null);
const bad = await call({ DOMAIN: "https://" });
check("非法值 status", bad.status, 404);
check("非法值 响应体为空", bad.body, "");
check("非法值 不发出请求", bad.target, null);

console.log("\n=== 上游请求失败：空 502（而不是抛异常让 CF 出报错页）===");
logs.length = 0;
globalThis.fetch = async () => {
	throw new Error("upstream boom");
};
const upstreamDown = await (async () => {
	try {
		const res = await mod.fetch(req(), { DOMAIN: "api.example.com" });
		return { status: res.status, body: await res.text() };
	} catch (err) {
		return { status: "THREW", body: String(err?.message ?? err) };
	}
})();
check("上游失败 status", upstreamDown.status, 502);
check("上游失败 响应体为空", upstreamDown.body, "");
check("上游失败 原因只进日志", logs.length > 0, true);

console.error = realConsoleError;

console.log(failed === 0 ? "\n=== 全部通过 ===" : `\n=== 有 ${failed} 条失败 ===`);
process.exit(failed === 0 ? 0 : 1);
