/**
 * 反代查询诊断：把一个番号打穿生产端点，打印状态码、耗时、完整响应。
 *
 * 用法：
 *   node tools/proxy-query.mjs <code> [--refresh] [--debug] [--cid] [--base=<url>]
 *
 * 凭据只从环境变量取：PROXY_API_KEY（或 API_KEY）、PROXY_BASE。
 * 缺失就报错退出，不读任何文件、不猜默认地址。
 * （打印的 URL 里 Key 一律替换为 ***，不泄露）
 */

function resolveKey() {
	return process.env.PROXY_API_KEY?.trim() || process.env.API_KEY?.trim() || "";
}

const args = process.argv.slice(2);
const code = args.find((a) => !a.startsWith("--"));
const key = resolveKey();
if (!code || !key) {
	console.error(
		"用法: node tools/proxy-query.mjs <code> [--refresh] [--debug] [--cid]\n" +
			"需要环境变量 PROXY_API_KEY（或 API_KEY）；缺失时请先在当前 shell 里设置。",
	);
	process.exit(2);
}

// base 取值：--base= 参数 > PROXY_BASE 环境变量。都没有就报错，不带硬编码兜底。
const rawBase =
	args.find((a) => a.startsWith("--base="))?.slice("--base=".length) ||
	process.env.PROXY_BASE ||
	"";
if (!rawBase) {
	console.error(
		[
			"缺少 base 地址。二选一：",
			"  1) node tools/proxy-query.mjs <code> --base=https://<你的域名>",
			'  2) $env:PROXY_BASE="https://<你的域名>"    （bash: export PROXY_BASE=https://<你的域名>）',
		].join("\n"),
	);
	process.exit(2);
}
const base = rawBase.replace(/\/+$/, "");

const params = new URLSearchParams({ key });
if (args.includes("--refresh")) params.set("refresh", "1");
if (args.includes("--debug")) params.set("debug", "1");

const path = args.includes("--debug")
	? `/${encodeURIComponent(code)}`
	: args.includes("--cid")
		? `/cid/${encodeURIComponent(code)}`
		: `/${encodeURIComponent(code)}`;
const url = `${base}${path}?${params}`;

const started = Date.now();
const res = await fetch(url, { redirect: "follow" });
const text = await res.text();
const ms = Date.now() - started;

console.log(`GET ${url.replace(encodeURIComponent(key), "***").replace(key, "***")}`);
console.log(`status=${res.status}  ms=${ms}  bytes=${text.length}`);
try {
	console.log(JSON.stringify(JSON.parse(text), null, 1));
} catch {
	console.log(text.slice(0, 4000));
}
