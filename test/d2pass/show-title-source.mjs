/**
 * 诊断：title / short_title / actress 各自到底从哪来。
 *
 *   node show-title-source.mjs
 *
 * 打印每个番号的三段原始数据：
 *   ① 源站原始标题（HTML 的 og:title/<title>，或 bifrost JSON 的 Title）
 *   ② 清洗后我们返回的 title
 *   ③ D2Pass 商品页的 <title>（我们返回的 short_title，actress 从它的冒号前缀切出来）
 */

import { resolveSite, SITES } from "../../advanced/d2pass-api/vercel-d2pass/api/lib/sites.js";
import { lookupOnD2Pass } from "../../advanced/d2pass-api/vercel-d2pass/api/lib/d2pass.js";
import { routeCandidates, normalizeCode, alternateCodes } from "../../advanced/d2pass-api/vercel-d2pass/api/lib/codes.js";

const CODES = ["HEYZO-3953", "100126-100", "100426-001", "ori1812", "04684"];

const L = (s) => console.log(s);
const cut = (s, n = 96) => (s == null ? "(null)" : s.length > n ? `${s.slice(0, n)}…` : s);

for (const raw of CODES) {
	const code = normalizeCode(raw);
	const candidates = routeCandidates(code);
	L(`\n${"═".repeat(100)}`);
	L(`番号 ${code}   路由候选 ${JSON.stringify(candidates)}`);

	// 与 api/index.js 一样：按优先级逐个完整解析，直到成功；再退到分隔符兄弟形态
	let site = null;
	let usedSite = null;
	let usedCode = code;
	outer: for (const candidateCode of [code, ...alternateCodes(code)]) {
		for (const id of routeCandidates(candidateCode)) {
			const s = await resolveSite(id, candidateCode, { timeoutMs: 8000 }).catch(() => null);
			if (s) {
				site = s;
				usedSite = id;
				usedCode = candidateCode;
				break outer;
			}
		}
	}
	if (!site) {
		L("  所有候选都解析失败（源站已停服/失效）");
		continue;
	}
	L(`  命中站点    : ${usedSite}（${SITES[usedSite].name}，来源类型 ${SITES[usedSite].kind}）${usedCode !== code ? `  ← 分隔符兜底用了 ${usedCode}` : ""}`);
	L(`  ① 源站原始  : ${cut(site.titleRaw)}`);
	L(`  ② → title   : ${cut(site.title)}      ← 返回给 title`);
	L(`     源站封面 : ${cut(site.coverAlt, 70)}`);
	if (site.actress) L(`     源站女优 : ${site.actress}   (bifrost JSON 的 ActressesJa[0])`);

	const hit = await lookupOnD2Pass(code, site.title, { timeoutMs: 6000, expectedHost: site.host, attempts: [] }).catch(() => null);
	if (!hit) {
		L("  ③ D2Pass    : 未找到商品 → short_title = null");
		continue;
	}
	L(`  ③ D2Pass 商品页 <title>: ${cut(hit.product.titleTag)}`);
	L(`     → short_title         : ${cut(hit.product.shortTitle)}      ← 返回给 short_title`);
	L(`     冒号前缀 → actress    : ${hit.product.actress}   （仅当前缀 ≤24 字符才取）`);
	L(`     回链                  : ${cut(hit.product.backlink, 70)}`);
	L(`     主机一致              : ${hit.hostMatched ? "是（match=backlink）" : "否（match=fuzzy）"}`);

	// 直接给出重复度判断
	const t = site.title;
	const st = hit.product.shortTitle || "";
	L(`  ▸ short_title === title ? ${st === t ? "完全相同" : st.endsWith(t) ? "short_title 以 title 结尾（前面多了女优名前缀）" : "两者不同"}`);
}
