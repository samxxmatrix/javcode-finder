/**
 * 反代纯函数单测（无网络）。用法：node tools/dmm-quality-unit.mjs
 * 断言口径见 docs/superpowers/specs/2026-10-06-dmm-preview-quality-design.md §5
 */
import { isDeepStrictEqual } from "node:util";
import {
	parseHlsVariants,
	resolveHeight,
	rankVariants,
	pickVariant,
	qualityLabel,
	replaceQualityToken,
	orderByPreference,
	shapeQualities,
	toMp4Url,
	DEFAULT_MIN_HEIGHT,
	DEFAULT_MAX_HEIGHT,
} from "../advanced/dmm-api/vercel-dmm/lib/preview-quality.js";
import {
	INCOMPLETE_TTL_SECONDS,
	entryTtlSeconds,
	isEntryIncomplete,
} from "../advanced/dmm-api/vercel-dmm/lib/cache-entry.js";
import { SCHEMA_VERSION, cacheKeyFrom, usableEntry } from "../advanced/dmm-api/vercel-dmm/lib/cache-entry.js";
import {
	HIT,
	NOT_FOUND,
	UPSTREAM,
	classifyHttpStatus,
	combineRouteOutcomes,
	isBlockedPage,
	hasDetailContent,
} from "../advanced/dmm-api/vercel-dmm/lib/upstream-outcome.js";

let failed = 0;
function check(label, actual, expected) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	const ok = isDeepStrictEqual(actual, expected);
	if (!ok) failed += 1;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${a}${ok ? "" : ` (期望 ${e})`}`);
}

// ---- 真实 playlist 固件（BDSM-091，8 档；抓取于 2026-10-06）----
const EIGHT_TIER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=395222,AVERAGE-BANDWIDTH=220445,RESOLUTION=256x144,CODECS="avc1.4d400d,mp4a.40.2"
h_1096bdsm091sm.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=879940,AVERAGE-BANDWIDTH=443866,RESOLUTION=512x288,CODECS="avc1.4d401e,mp4a.40.2"
h_1096bdsm091dm.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1642948,AVERAGE-BANDWIDTH=840820,RESOLUTION=768x432,CODECS="avc1.4d401e,mp4a.40.2"
h_1096bdsm091mmb.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2585602,AVERAGE-BANDWIDTH=1360049,RESOLUTION=1024x576,CODECS="avc1.4d401f,mp4a.40.2"
h_1096bdsm091mhb.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4015587,AVERAGE-BANDWIDTH=2461460,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"
h_1096bdsm091hmb.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5433161,AVERAGE-BANDWIDTH=3107552,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"
h_1096bdsm091hmbs.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6425463,AVERAGE-BANDWIDTH=4089229,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
h_1096bdsm091hhb.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8728203,AVERAGE-BANDWIDTH=5175235,RESOLUTION=1920x1080,CODECS="avc1.64002a,mp4a.40.2"
h_1096bdsm091hhbs.m3u8
`;

// ---- 数字版家族（无 RESOLUTION，只有 BANDWIDTH；IPX-118，3 档）----
const W_TIER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=300000
ipx00118_sm_w.m3u8
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1000000
ipx00118_dm_w.m3u8
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1500000
ipx00118_dmb_w.m3u8
`;

console.log("=== parseHlsVariants ===");
const eight = parseHlsVariants(EIGHT_TIER);
check("档数", eight.length, 8);
check("第一档", eight[0], {
	uri: "h_1096bdsm091sm.m3u8",
	resolution: "256x144",
	bandwidth: 220445,
	height: 144,
});
check("第 3 档 token/高度", [eight[2].uri, eight[2].height], ["h_1096bdsm091mmb.m3u8", 432]);
check("空文本", parseHlsVariants(""), []);
check("无 STREAM-INF", parseHlsVariants("#EXTM3U\n#EXT-X-VERSION:3\n"), []);
check("流 URI 后紧跟注释行 → 忽略", parseHlsVariants("#EXT-X-STREAM-INF:BANDWIDTH=1\n#comment\n"), []);
check("缺 RESOLUTION → 走静态表", parseHlsVariants(W_TIER).map((v) => v.height), [180, 316, 404]);
check("缺 RESOLUTION 时带宽仍解析", parseHlsVariants(W_TIER)[2].bandwidth, 1500000);

console.log("\n=== resolveHeight（静态家族表）===");
check("主家族 sm", resolveHeight("h_1096bdsm091sm.mp4"), 144);
check("主家族 hhbs = 1080", resolveHeight("h_1096bdsm091hhbs.mp4"), 1080);
check("主家族 4k", resolveHeight("ipx005354k.mp4"), 2160);
check("数字版 _w（最长后缀优先：dmb=404 非 dm=316）", resolveHeight("ipx00118_dmb_w.mp4"), 404);
check("数字版 _s", resolveHeight("iptd00700_dmb_s.mp4"), 404);
check("RESOLUTION 覆盖静态表", resolveHeight("whatever.mp4", "1920x1080"), 1080);
check("未知形态 → null", resolveHeight("mystery-file.mp4"), null);
check("带 query 的 URL", resolveHeight("https://x.test/a/b/h_1096bdsm091mmb.mp4?t=1"), 432);

console.log("\n=== pickVariant / rankVariants（spec §5 复核表）===");
const band = { minHeight: DEFAULT_MIN_HEIGHT, maxHeight: DEFAULT_MAX_HEIGHT };
check("BDSM-091 → mmb", pickVariant(eight, band)?.uri, "h_1096bdsm091mmb.m3u8");
check("BDSM-091 → 432p", qualityLabel(pickVariant(eight, band)?.height), "432p");
check("IPX-118(_w) → dmb_w", pickVariant(parseHlsVariants(W_TIER), band)?.uri, "ipx00118_dmb_w.m3u8");
check("IPX-118(_w) → 404p", qualityLabel(pickVariant(parseHlsVariants(W_TIER), band)?.height), "404p");
check(
	"SSIS-001 同分辨率取更轻（1.5M vs 3.0M）",
	pickVariant(
		[
			{ uri: "a_dmb_w.m3u8", resolution: null, bandwidth: 1500000, height: 404 },
			{ uri: "a_mhb_w.m3u8", resolution: null, bandwidth: 3000000, height: 404 },
		],
		band,
	)?.uri,
	"a_dmb_w.m3u8",
);
check("?quality=1080p → 两个 1080 里取更轻", pickVariant(eight, { quality: 1080 })?.uri, "h_1096bdsm091hhb.m3u8");
check("?quality=432p 在 _w 家族退到 404", pickVariant(parseHlsVariants(W_TIER), { quality: 432 })?.uri, "ipx00118_dmb_w.m3u8");
check("区间内为空：全部低于下界 → 取最高", pickVariant([
	{ uri: "a.mp4", resolution: null, bandwidth: 1, height: 144 },
	{ uri: "b.mp4", resolution: null, bandwidth: 2, height: 288 },
], band)?.uri, "b.mp4");
check("区间内为空：全部高于上界 → 取最低", pickVariant([
	{ uri: "a.mp4", resolution: null, bandwidth: 1, height: 720 },
	{ uri: "b.mp4", resolution: null, bandwidth: 2, height: 1080 },
], band)?.uri, "a.mp4");
check("高度全未知 → 带宽中位数（奇数取中位）", pickVariant([
	{ uri: "a.mp4", resolution: null, bandwidth: 300000, height: null },
	{ uri: "b.mp4", resolution: null, bandwidth: 1000000, height: null },
	{ uri: "c.mp4", resolution: null, bandwidth: 1500000, height: null },
], band)?.uri, "b.mp4");
check("高度全未知 → 偶数取更轻一侧", pickVariant([
	{ uri: "a.mp4", resolution: null, bandwidth: 100, height: null },
	{ uri: "b.mp4", resolution: null, bandwidth: 200, height: null },
	{ uri: "c.mp4", resolution: null, bandwidth: 300, height: null },
	{ uri: "d.mp4", resolution: null, bandwidth: 400, height: null },
], band)?.uri, "b.mp4");
check("已知+未知混合：选已知最近档，未知排最后", (() => {
	const r = rankVariants([
		{ uri: "u.mp4", resolution: null, bandwidth: 1, height: null },
		{ uri: "k.mp4", resolution: null, bandwidth: 2, height: 432 },
	], band);
	return [r.picked.uri, r.ordered.map((v) => v.uri)];
})(), ["k.mp4", ["k.mp4", "u.mp4"]]);
check("空输入 → null", pickVariant([], band), null);
check("rankVariants 报 target/inBand", (() => {
	const r = rankVariants(eight, band);
	return [r.target, r.inBand, r.picked.height];
})(), [460, true, 432]);
check(
	"orderByPreference 全序（默认区间）",
	orderByPreference(eight, band).map((v) => v.uri),
	[
		"h_1096bdsm091mmb.m3u8",
		"h_1096bdsm091mhb.m3u8",
		"h_1096bdsm091dm.m3u8",
		"h_1096bdsm091hmb.m3u8",
		"h_1096bdsm091hmbs.m3u8",
		"h_1096bdsm091sm.m3u8",
		"h_1096bdsm091hhb.m3u8",
		"h_1096bdsm091hhbs.m3u8",
	],
);
check("orderByPreference 次位 = mhb(576)", orderByPreference(eight, band)[1].uri, "h_1096bdsm091mhb.m3u8");

console.log("\n=== replaceQualityToken（模板探测路径用）===");
check("主家族换 token", replaceQualityToken("h_1096bdsm091hhbs.mp4", "mmb"), "h_1096bdsm091mmb.mp4");
check("数字版保留 _w", replaceQualityToken("ipx00118_sm_w.mp4", "dm"), "ipx00118_dm_w.mp4");
check("数字版保留 _s", replaceQualityToken("iptd00700_dmb_s.mp4", "sm"), "iptd00700_sm_s.mp4");
check("未知形态 → null", replaceQualityToken("mystery-file.mp4", "mmb"), null);
check("保留目录/扩展名/query/fragment",
	replaceQualityToken("https://x.test/a/b/h_1096bdsm091sm.mp4?t=1#f", "mmb"),
	"https://x.test/a/b/h_1096bdsm091mmb.mp4?t=1#f");

console.log("\n=== cacheKeyFrom（键卫生守门：纯语法，不识别番号类别）===");
check("有码小写 → 大写", cacheKeyFrom("ssis-001"), "SSIS-001");
check("有码前导零保留", cacheKeyFrom("BDSM-091"), "BDSM-091");
check("无码日期型前导零保留", cacheKeyFrom("072126-100"), "072126-100");
check("3 位字母数字开头", cacheKeyFrom("3dw-315"), "3DW-315");
check("裸数字", cacheKeyFrom("3997"), "3997");
check("下划线形态", cacheKeyFrom("h_1096bdsm00091"), "H_1096BDSM00091");
check("脏输入（中文+冒号）→ null", cacheKeyFrom("任务名称:-MFYD-189"), null);
check("含空格 → null", cacheKeyFrom("ABP 123"), null);
check("含中文 → null", cacheKeyFrom("N3351-和-ORI1812"), null);
check("冒号塌缩候选 → null", cacheKeyFrom("abc-123:456"), null);
check("空串 → null", cacheKeyFrom("   "), null);
check("超过 32 字符 → null", cacheKeyFrom("A".repeat(33)), null);
check("32 字符上限可通过", cacheKeyFrom("A".repeat(32)), "A".repeat(32));
check("首字符是分隔符 → null", cacheKeyFrom("-ABP-123"), null);
check("全角番号经 NFKC 归一", cacheKeyFrom("ＡＢＰ－１２３"), "ABP-123");
check("首尾空白先 trim（内部空白不放行）", cacheKeyFrom("  ABP-123  "), "ABP-123");
check("1 字符 → null（长度下限 2）", cacheKeyFrom("A"), null);
check("非字符串 false → \"FALSE\"（类型不设防，仅语法守门）", cacheKeyFrom(false), "FALSE");

console.log("\n=== usableEntry（版本 + 键值一致性 + quality 口径）===");
const entry = { v: SCHEMA_VERSION, code: "IPTD-700", cid: "iptd00700", quality: null };
check("正常条目可用", usableEntry(entry, "IPTD-700", null)?.cid, "iptd00700");
check("版本不符 → 未命中", usableEntry({ ...entry, v: SCHEMA_VERSION - 1 }, "IPTD-700", null), null);
check("无版本字段（历史条目）→ 未命中", usableEntry({ code: "IPTD-700", cid: "iptd00700" }, "IPTD-700", null), null);
check("键值不一致（脏条目）→ 未命中", usableEntry(entry, "MFYD-189", null), null);
check("quality 不符 → 未命中", usableEntry(entry, "IPTD-700", 1080), null);
check("quality 不参与时忽略该字段", usableEntry({ ...entry, quality: 1080 }, "IPTD-700")?.cid, "iptd00700");
check("缺 quality 字段 ≡ null", usableEntry({ v: SCHEMA_VERSION, code: "IPTD-700", cid: "iptd00700" }, "IPTD-700", null)?.cid, "iptd00700");
check("null 条目 → 未命中", usableEntry(null, "IPTD-700", null), null);
check("非对象 → 未命中", usableEntry("x", "IPTD-700", null), null);

console.log("\n=== upstream-outcome 常量字面值 ===");
check("常量字面值（防 404↔503 反转）", [HIT, NOT_FOUND, UPSTREAM], ["hit", "not_found", "upstream"]);

console.log("\n=== classifyHttpStatus（404/410 才是确认查无）===");
check("404", classifyHttpStatus(404), NOT_FOUND);
check("410", classifyHttpStatus(410), NOT_FOUND);
check("403（WAF）", classifyHttpStatus(403), UPSTREAM);
check("429", classifyHttpStatus(429), UPSTREAM);
check("500", classifyHttpStatus(500), UPSTREAM);
check("503", classifyHttpStatus(503), UPSTREAM);
check("字符串 404 不当查无", classifyHttpStatus("404"), UPSTREAM);

console.log("\n=== combineRouteOutcomes（spec §15.3）===");
check("数字版命中", combineRouteOutcomes(HIT, NOT_FOUND), HIT);
check("mono 命中", combineRouteOutcomes(UPSTREAM, HIT), HIT);
check("两路都查无 → 查无", combineRouteOutcomes(NOT_FOUND, NOT_FOUND), NOT_FOUND);
check("数字版无法定性 + mono 查无 → 无法定性", combineRouteOutcomes(UPSTREAM, NOT_FOUND), UPSTREAM);
check("数字版查无 + mono 无法定性 → 无法定性", combineRouteOutcomes(NOT_FOUND, UPSTREAM), UPSTREAM);
check("两路都无法定性", combineRouteOutcomes(UPSTREAM, UPSTREAM), UPSTREAM);

console.log("\n=== 页面判定 ===");
check("年龄确认页（日文）", isBlockedPage("<html>年齢認証</html>"), true);
check("age_check 链接", isBlockedPage('<a href="/age_check/=/declared=yes/">x</a>'), true);
check("正常页", isBlockedPage("<html><title>x</title></html>"), false);
check("详情页有内容（og:title）", hasDetailContent('<meta property="og:title" content="x">'), true);
check("详情页有内容（pl.jpg）", hasDetailContent("h_1pl.jpg"), true);
check("空壳页", hasDetailContent("<html><body>Not Found</body></html>"), false);
check("null 安全", [isBlockedPage(null), hasDetailContent(null)], [false, false]);

console.log("\n=== toMp4Url（档位 URI → mp4；只改写 path，query/fragment 保留）===");
const MP4_DIR = "https://cc3001.dmm.co.jp/pv/TOKEN/";
check("裸文件名（真实固件形态）", toMp4Url(MP4_DIR, "h_1096bdsm091mmb.m3u8"), MP4_DIR + "h_1096bdsm091mmb.mp4");
check("带 query 仍改写扩展名", toMp4Url(MP4_DIR, "x.m3u8?t=1"), MP4_DIR + "x.mp4?t=1");
check("带 fragment 仍改写扩展名", toMp4Url(MP4_DIR, "x.m3u8#f"), MP4_DIR + "x.mp4#f");
check("绝对路径按 mp4Dir 解析（不拼出双斜杠）", toMp4Url(MP4_DIR, "/pv/other/x.m3u8"), "https://cc3001.dmm.co.jp/pv/other/x.mp4");
check("绝对 URL 保留自身 origin", toMp4Url(MP4_DIR, "https://cdn/x.m3u8?t=1"), "https://cdn/x.mp4?t=1");
check("空串原样返回", toMp4Url(MP4_DIR, ""), "");
check("非字符串原样返回", toMp4Url(MP4_DIR, null), null);

console.log("\n=== shapeQualities（升序 + url 走 toMp4Url + 不改写入参）===");
const UNSORTED = [
	{ uri: "b_mmb.m3u8", resolution: "768x432", bandwidth: 800000, height: 432 },
	{ uri: "b_sm.m3u8", resolution: "256x144", bandwidth: 200000, height: 144 },
	{ uri: "b_hhb.m3u8", resolution: "1920x1080", bandwidth: 5000000, height: 1080 },
	{ uri: "b_hmbs.m3u8", resolution: "1280x720", bandwidth: 3100000, height: 720 },
	{ uri: "b_hmb.m3u8", resolution: "1280x720", bandwidth: 2400000, height: 720 },
];
const INPUT_ORDER = UNSORTED.map((v) => v.uri);
const shaped = shapeQualities(UNSORTED, MP4_DIR);
check("非升序输入 → 高度升序", shaped.map((q) => q.height), [144, 432, 720, 720, 1080]);
check("同高度 → 带宽升序", shaped.filter((q) => q.height === 720).map((q) => q.bandwidth), [2400000, 3100000]);
check("每档 url 都经 toMp4Url（m3u8 → mp4）", shaped.map((q) => q.url), [
	MP4_DIR + "b_sm.mp4",
	MP4_DIR + "b_mmb.mp4",
	MP4_DIR + "b_hmb.mp4",
	MP4_DIR + "b_hmbs.mp4",
	MP4_DIR + "b_hhb.mp4",
]);
check("条目形状", shaped[0], {
	quality: "144p",
	height: 144,
	resolution: "256x144",
	bandwidth: 200000,
	url: MP4_DIR + "b_sm.mp4",
});
check("入参数组未被改写", UNSORTED.map((v) => v.uri), INPUT_ORDER);

// ----------------------------------------------------
// 字段完整性分级 TTL：资料不全的条目只缓存 6h，资料齐全的永久保存
// 目的：源站后来补齐封面/预告片时，最迟一个 TTL 就能自动生效（否则永久缓存永远返回 null）
// ----------------------------------------------------
const FULL = { title: "标题", cover_url: "https://x/pl.jpg", preview_url: "https://x/a.mp4" };
check("默认短 TTL = 6h", INCOMPLETE_TTL_SECONDS, 21600);
check("字段齐全 → 永久（null）", entryTtlSeconds(FULL, INCOMPLETE_TTL_SECONDS), null);
check("缺预告片 → 短 TTL", entryTtlSeconds({ ...FULL, preview_url: null }, INCOMPLETE_TTL_SECONDS), 21600);
check("缺封面 → 短 TTL", entryTtlSeconds({ ...FULL, cover_url: null }, INCOMPLETE_TTL_SECONDS), 21600);
check("缺标题 → 短 TTL", entryTtlSeconds({ ...FULL, title: null }, INCOMPLETE_TTL_SECONDS), 21600);
check("键整体缺失 → 短 TTL", entryTtlSeconds({ cid: "x", channel: "digital" }, INCOMPLETE_TTL_SECONDS), 21600);
check("空串/纯空白按缺失算", entryTtlSeconds({ ...FULL, title: "   " }, INCOMPLETE_TTL_SECONDS), 21600);
check("非对象入参 → 短 TTL", entryTtlSeconds(null, INCOMPLETE_TTL_SECONDS), 21600);
check("TTL 传 0 → 该策略关闭（永久）", entryTtlSeconds({ cid: "x" }, 0), null);
check("TTL 传负数 → 该策略关闭（永久）", entryTtlSeconds({ cid: "x" }, -1), null);
check("字段齐全的判定本身", isEntryIncomplete(FULL), false);
check("字段缺失的判定本身", isEntryIncomplete({ title: "t", cover_url: null, preview_url: "p" }), true);

console.log(failed === 0 ? "\n=== 全部通过 ===" : `\n=== 有 ${failed} 条失败 ===`);
process.exit(failed === 0 ? 0 : 1);
