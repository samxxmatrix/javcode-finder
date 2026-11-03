/**
 * 通用"源站页面标签体检"：抓一个页面，打印指定标签（默认出演者/日期一族）首次出现处的上下文。
 * 用途：判断某个加盟站页面里到底有没有出演者与日期，从而决定要不要在反代侧解析。
 * 只读，不写文件。
 *
 * 用法：node tools/probe-source-page.mjs <url> [标签1 标签2 ...]
 * 例：  node tools/probe-source-page.mjs https://www.heyzo.com/moviepages/3405/index.html
 * （本机访问外站需要代理：见 tools/run-probe-proxy.ps1 / .dsh/.env）
 */
const [url, ...rest] = process.argv.slice(2);
if (!url) {
	console.error("用法: node tools/probe-source-page.mjs <url> [标签...]");
	process.exit(2);
}
const LABELS = rest.length
	? rest
	: ["出演者", "出演", "モデル", "女優", "配信開始日", "配信日", "公開日", "発売日", "商品発売日", "収録時間"];

const res = await fetch(url, {
	headers: {
		"User-Agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
		"Accept-Language": "ja,en;q=0.9",
		Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
	},
	redirect: "follow",
	signal: AbortSignal.timeout(30000),
});

// 部分加盟站是 EUC-JP：Node 的 res.text() 一律按 UTF-8 解 → 标签会成乱码。
// 用 PROBE_CHARSET=euc-jp 指定编码（默认 utf-8）。
const charset = process.env.PROBE_CHARSET || "utf-8";
const buffer = Buffer.from(await res.arrayBuffer());
const html =
	charset === "utf-8" ? buffer.toString("utf8") : new TextDecoder(charset).decode(buffer);
console.log(`url = ${url}`);
console.log(`status = ${res.status}  final = ${res.url}  bytes = ${html.length}`);
console.log(`title = ${/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "(none)"}\n`);

for (const label of LABELS) {
	const at = html.indexOf(label);
	if (at < 0) continue;
	console.log(`--- ${label} @${at} ---`);
	console.log(html.slice(Math.max(0, at - 220), at + 420).replace(/\s+/g, " ").trim());
	console.log();
}
