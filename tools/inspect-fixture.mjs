/**
 * 固件体检：确认 javtrailers 日语页固件是真实页面（而非 Cloudflare 挑战页），
 * 并打印关键锚点与标签上下文，作为写正则的依据。只读。
 *
 * 用法：node tools/inspect-fixture.mjs test/fixtures/javtrailers-ja-video-1dldss00529.html
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
	console.error("用法: node tools/inspect-fixture.mjs <fixture.html>");
	process.exit(2);
}
const html = readFileSync(file, "utf8");

console.log(`file = ${file}`);
console.log(`bytes = ${html.length}`);
console.log(`title = ${/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "(none)"}`);
console.log(`html lang = ${/<html[^>]*lang="([^"]*)"/i.exec(html)?.[1] ?? "(none)"}`);
console.log(`是挑战页 = ${/Just a moment|cf-mitigated|challenge-platform/i.test(html)}`);

const MARKERS = [
	'class="card-container"',
	'href="/video/',
	"__NUXT_DATA__",
	"出演者",
	"出演",
	"配信開始日",
	"配信日",
	"商品発売日",
	"発売日",
	"actress",
	"releaseDate",
	"deliveryStartDate",
];
console.log("\n--- 锚点命中 ---");
for (const marker of MARKERS) {
	const at = html.indexOf(marker);
	console.log(`  ${marker.padEnd(22)} ${at < 0 ? "未命中" : `@${at}`}`);
}

const altSamples = [...html.matchAll(/alt="([^"]*)"/g)].slice(0, 5).map((m) => m[1]);
console.log(`\nalt 样本 = ${JSON.stringify(altSamples)}`);

const card = html.indexOf('class="card-container"');
if (card >= 0) {
	console.log("\n--- card-container 上下文（首张卡片）---");
	console.log(html.slice(card - 120, card + 900).replace(/\s+/g, " "));
}

for (const label of ["出演者", "出演", "配信開始日", "配信日", "商品発売日", "発売日"]) {
	const at = html.indexOf(label);
	if (at < 0) continue;
	console.log(`\n--- ${label} @${at} 上下文 ---`);
	console.log(html.slice(Math.max(0, at - 350), at + 600).replace(/\s+/g, " "));
}

const nuxt = /id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
if (nuxt) {
	console.log(`\n--- __NUXT_DATA__ (${nuxt.length} bytes) 关键词附近 ---`);
	for (const key of ["actress", "Actress", "performer", "release", "delivery", "発売", "配信"]) {
		const at = nuxt.indexOf(key);
		if (at < 0) continue;
		console.log(`  [${key}] …${nuxt.slice(Math.max(0, at - 200), at + 300).replace(/\s+/g, " ")}…`);
	}
}
