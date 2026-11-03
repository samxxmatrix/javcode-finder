/**
 * HTML 站「出演者 / 发行日」抽取的离线断言（**不打网络**，用真实片段固件）。
 *
 * 固件来源：`tools/oneoff/capture-d2pass-fixtures.mjs`（2026-10-10 经日本出口抓取），
 * 放在本目录 `fixtures/<siteId>.html`，每站以元数据命中点为中心的真实片段
 * （heyzo 另有整页 `heyzo-full.html`；`sites-meta-survey.txt` 是 12 站标签普查报告）。
 *
 * 背景：2026-10-10 之前 `resolveSite` 的 HTML 路径把 `actress`/`releaseDate` **硬编码成 null**，
 * 导致 HEYZO / ピッカー / 0930系 / 女体のしんぴ 等站的面板浮条两侧全空。
 *
 * 用法（本目录）：node verify-meta-extraction.mjs
 */
import { readFileSync } from "node:fs";
import { SITES, extractSiteMeta } from "../../advanced/d2pass-api/vercel-d2pass/api/lib/sites.js";

/** [siteId, 期望出演者, 期望发行日（**原始抓取值**，归一化在扩展侧做）] */
const CASES = [
	["heyzo", "ゆずの琴美", "2024-09-10"],
	["heydouga", "大野みゆ", "2023-03-28"],
	["caribbeancom", "山岸るな", "2026/10/04"],
	["caribbeancompr", "瀬戸かなこ", "2026-10-05"],
	["pikkur", "円山のぞみ", "2026-08-25"],
	["h0930", "船井 悠佳", "2026-10-03"],
	["h4610", "冨丘 京香", "2026-08-22"],
	["c0930", "関矢 恵名", "2026-08-22"],
	["nyoshin", "れいな", "2026年8月26日"],
];

let failed = 0;
function check(label, actual, expected) {
	const ok = actual === expected;
	if (!ok) failed += 1;
	console.log(
		`${ok ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`,
	);
}

console.log("=== 1) 九个 HTML 站：出演者 + 发行日 ===");
for (const [siteId, expectActress, expectDate] of CASES) {
	const html = readFileSync(new URL(`./fixtures/${siteId}.html`, import.meta.url), "utf8");
	const meta = extractSiteMeta(html, SITES[siteId]);
	check(`${siteId.padEnd(15)} actress`, meta.actress, expectActress);
	check(`${siteId.padEnd(15)} release_date`, meta.releaseDate, expectDate);
}

console.log("\n=== 2) 负例：免责声明 / 搜索框不得误命中 ===");
// 裸标签搜索的老写法会把这两处当数据（实测 heydouga 的「出演者」命中其实就是搜索框 placeholder）
const NOISE = `<div>本作品の出演者は、撮影時点ですべて18歳以上であり、作品への出演および撮影内容について法的に有効な同意をしています。</div>
<input name="keyword" type="text" placeholder="作品タイトル・出演者名で検索" value="" />`;
for (const siteId of ["heyzo", "heydouga", "pikkur", "h0930"]) {
	const meta = extractSiteMeta(NOISE, SITES[siteId]);
	check(`${siteId.padEnd(15)} 噪声页 actress`, meta.actress, null);
	check(`${siteId.padEnd(15)} 噪声页 release_date`, meta.releaseDate, null);
}

console.log("\n=== 3) 负例：3d-eros 真实片段确实没有可解析标签（保持 null，不猜）===");
const eros = readFileSync(new URL("./fixtures/3d-eros.html", import.meta.url), "utf8");
const erosMeta = extractSiteMeta(eros, SITES["3d-eros"]);
check("3d-eros actress", erosMeta.actress, null);
check("3d-eros release_date", erosMeta.releaseDate, null);

console.log("\n=== 4) 用户报告的老 caribbeancom 号（不在 D2Pass 上架、页面无 og:image）===");
// 页面里只有「用户评论日期」（review-info__date 2025-05-26/27），**没有发行日标签** →
// 必须保持 null，绝不能把评论日期当成发行日。
const oldHtml = readFileSync(
	new URL("./fixtures/caribbeancom-052725.html", import.meta.url),
	"utf8",
);
const oldMeta = extractSiteMeta(oldHtml, SITES.caribbeancom);
check("052725-001 actress", oldMeta.actress, "佐伯エリ");
check("052725-001 release_date（评论日期不得误取）", oldMeta.releaseDate, null);
check(
	"caribbeancom 封面模板（og:image 缺失时的兜底，运行时先探活）",
	SITES.caribbeancom.coverTemplate({ code: "052725-001" }),
	"https://www.caribbeancom.com/moviepages/052725-001/images/l_l.jpg",
);

console.log(`\n${failed === 0 ? "全部 PASS" : `${failed} 项 FAIL`}`);
process.exitCode = failed === 0 ? 0 : 1;
