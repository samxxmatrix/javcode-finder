/**
 * 通用原始查询：直接打印某个反代端点对某个番号的**完整响应体**（不套用任何字段假设）。
 *
 * 用途：排查"某个源到底给了什么"（如 D2PASS 的 `actress` / `release_date` 与 DMM 的
 * `actresses` / `delivery_date` 字段名不同，check-prod-meta.mjs 只认后者）。
 *
 * key 取值：环境变量 API_KEY（唯一来源；缺失时打印告警并在请求里带上空 key，便于看服务端报错）。
 *
 * 用法（仓库根目录）：
 *   node tools/raw-query.mjs <base> <path> [更多 path...]
 * 例：
 *   node tools/raw-query.mjs https://<你的域名> /HEYZO-3405
 *   node tools/raw-query.mjs https://<你的域名> /HEYZO-3405 /faleno/FNS-263
 */

const [base, ...paths] = process.argv.slice(2);
if (!base || paths.length === 0) {
	console.error("用法: node tools/raw-query.mjs <base> <path> [更多 path...]");
	process.exit(2);
}
const key = process.env.API_KEY?.trim() || "";

console.log(`base = ${base}`);
console.log(`key  = ${key ? `长度 ${key.length}` : "⚠️ 未找到"}\n`);

for (const path of paths) {
	const sep = path.includes("?") ? "&" : "?";
	const url = `${base.replace(/\/+$/, "")}${path}${sep}key=${encodeURIComponent(key)}&refresh=1`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
		const text = await res.text();
		console.log(`--- ${path}  status=${res.status} ---`);
		try {
			console.log(JSON.stringify(JSON.parse(text), null, 1).slice(0, 1600));
		} catch {
			console.log(text.replace(/\s+/g, " ").slice(0, 400));
		}
		console.log();
	} catch (error) {
		console.log(`--- ${path}  ERR ${error.name}: ${error.message} ---\n`);
	}
}
