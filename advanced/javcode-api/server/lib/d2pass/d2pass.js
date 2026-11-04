/**
 * D2Pass 侧的解析：站内搜索（分词匹配，需片段回退）→ 商品页 → 回链校验。
 *
 * 实测要点：
 * - 加 `RSC: 1` 头，搜索页从 407KB 降到 51~187KB；
 * - 搜索是分词匹配，完整标题经常 0 结果，必须按片段回退（HEYZO-3951 要试 2 次、100426-001 要试 2 次）；
 * - 必须用商品页里的源站回链校验番号，否则可能返回同名不同番号的商品。
 */

import { fetchText, htmlToText } from "./http.js";
import { backlinkMatches, titleFragments } from "./codes.js";

const BASE = "https://www.d2pass.com";

/**
 * D2Pass 的区域限制 / WAF 拦截页特征。
 *
 * 实测：短时间高频抓取后，商品页会返回 **HTTP 200 + 101 字的拦截文案**
 * （`Access is currently unavailable in your location due…`）。
 * 它**不是** 4xx，所以不会被 fetch 的错误通道抓到；如果不识别，
 * 拦截文案会被当成剧情/标题写进**永久缓存**。
 */
const BLOCK_PAGE_RE =
	/Access is currently unavailable|not available in your (?:location|country)|Attention Required|cf-error-details|Just a moment\.\.\.|Enable JavaScript and cookies|アクセスが制限|captcha/i;

/** 页面是否为区域限制/WAF 拦截页（只看开头，避免正文里的偶发词误伤） */
export function isBlockedPage(html) {
	return BLOCK_PAGE_RE.test(String(html || "").slice(0, 3000));
}

/**
 * 商品页的剧情介绍容器。
 *
 * 实测结构（RSC/SSR 渲染出来的部分）：
 *
 * ```html
 * <h1 class="mt-4 mb-4">作品名</h1>
 * <p class="mb-4 text-gray-700 dark:text-gray-300">剧情…</p>
 * ```
 *
 * ⚠️ 注意这个 class 是**剧情**不是标题——标题在同级的 `<h1>` 里。
 *
 * 两条抽取路径，因为 D2Pass 是 Next.js + Tailwind：**工具类名随时可能变**，
 * 只按 class 匹配太脆，所以再加一条"结构兜底"：
 *
 * 1. `byClass`：class 属性里**同时**含 `mb-4`、`text-gray-700`、`dark:text-gray-300` 三个 token
 *    —— 用 token 判定而不是"连续子串"，这样中间插入其它 class（`mb-4 leading-relaxed text-gray-700…`）
 *    或调换顺序都不会失效。取第一个**非空**的命中。
 * 2. `afterH1`：class 全改了也能活——取 `<h1>…</h1>` 之后第一个 `<p>` 的文本，
 *    这正是页面想表达的语义关系（标题 + 其下的说明段）。
 *
 * 返回 `via` 说明走了哪条路（`class` / `after-h1` / `missing`），会带进 `debug`，
 * 好让"某天突然取不到剧情"变成**可见**的回归，而不是静默返回 null。
 */
export function extractDescription(html) {
	// ① 按 class token 匹配
	const tagRe = /<p[^>]*\bclass="([^"]*)"[^>]*>([\s\S]*?)<\/p>/gi;
	for (const m of html.matchAll(tagRe)) {
		const cls = m[1];
		if (/\bmb-4\b/.test(cls) && /\btext-gray-700\b/.test(cls) && /dark:text-gray-300/.test(cls)) {
			const text = htmlToText(m[2]);
			if (text && !looksLikeBlockText(text)) return { text, via: "class" };
		}
	}

	// ② 结构兜底：<h1> 之后第一个 <p>
	const h1 = /<h1[^>]*>[\s\S]*?<\/h1>/i.exec(html);
	if (h1) {
		const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html.slice(h1.index + h1[0].length));
		const text = p ? htmlToText(p[1]) : "";
		// 兜底路径最容易抓到"无关段落"（拦截页、公告、cookie 提示），必须过一遍合理性检查
		if (text && !looksLikeBlockText(text)) return { text, via: "after-h1" };
	}

	return { text: null, via: "missing" };
}

/** 抽取结果的合理性检查：拦截文案、过短、明显的界面文字都不算剧情 */
function looksLikeBlockText(text) {
	if (BLOCK_PAGE_RE.test(text)) return true;
	if (text.length < 30) return true; // 剧情实测 170–448 字；30 字以下基本是界面文字
	return false;
}

/** 站内搜索：返回按出现顺序的商品路径（/product/movies/226138） */
export async function searchProducts(keyword, { timeoutMs = 5000, useRsc = true } = {}) {
	const url = `${BASE}/search?k=${encodeURIComponent(keyword)}`;
	const res = await fetchText(url, {
		headers: useRsc ? { RSC: "1" } : {},
		timeoutMs,
	});
	if (isBlockedPage(res.text)) throw new Error("d2pass blocked (geo/WAF) on search");
	if (res.status !== 200) return { status: res.status, products: [] };
	const products = [
		...new Set([...res.text.matchAll(/\/product\/(?:movies|ppv)\/\d+/g)].map((m) => m[0])),
	].slice(0, 10);
	return { status: res.status, products, bytes: res.buffer.length };
}

/** 商品页：拿封面、标题、女优名、源站回链、样片兜底 */
export async function getProduct(productPath, { timeoutMs = 5000 } = {}) {
	const res = await fetchText(`${BASE}${productPath}`, { timeoutMs });
	if (res.status !== 200) return null;
	const html = res.text;
	// 拦截页是 HTTP 200：必须显式识别，否则会把拦截文案当标题/剧情写进永久缓存
	if (isBlockedPage(html)) throw new Error("d2pass blocked (geo/WAF) on product page");
	const titleTag = (/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1]?.trim() || "";
	const cover =
		(/https:\/\/images\.d2pass\.com\/images\/meta\/(?:movies|ppv)\/flash\/\d+\.webp/.exec(html) || [])[0] || null;
	const backlink =
		(/https?:\/\/(?:www\.)?[a-z0-9.-]+\/[^"'\s\\)<>]*moviepages\/[^"'\s\\)<>]*/i.exec(html) || [])[0]?.replace(/&amp;/g, "&") ||
		null;
	const sample =
		(/https?:\/\/[^"'\s\\)<>]*\.mp4[^"'\s\\)<>]*/i.exec(html) || [])[0]?.replace(/&amp;/g, "&") || null;
	// 商品页标题形如「女优名: 作品名」
	const sep = titleTag.indexOf(":");
	const actress = sep > 0 && sep <= 24 ? titleTag.slice(0, sep).trim() : null;
	// 剧情介绍（纯文本）；pikkur 等站该元素存在但内容为空 → 返回 null
	const desc = extractDescription(html);
	return {
		productPath,
		productUrl: `${BASE}${productPath}`,
		titleTag,
		shortTitle: titleTag || null,
		description: desc.text,
		descriptionVia: desc.via,
		actress,
		cover,
		backlink,
		sample,
	};
}

/**
 * 回链主机是否与解析出的站点一致。
 *
 * 裸数字番号（3997 / 04684 / 3953）在不同站点可能撞号，光比数字会把 A 站的号认成 B 站的商品。
 * 主机一致 = `backlink`；只对得上数字 = `fuzzy`（数据仍返回，但标注可信度更低）。
 */
function hostMatches(backlinkUrl, expectedHost) {
	if (!backlinkUrl || !expectedHost) return false;
	try {
		const host = new URL(backlinkUrl).hostname.replace(/^www\./, "").toLowerCase();
		const want = expectedHost.replace(/^www\./, "").toLowerCase();
		return host === want || host.endsWith(`.${want}`) || want.endsWith(`.${host}`);
	} catch {
		return false;
	}
}

/**
 * 用标题片段回退搜索，直到找到"回链与番号吻合"的商品。
 * 返回 { product, fragment, hostMatched } 或 null。
 */
export async function lookupOnD2Pass(code, title, { timeoutMs = 5000, useRsc = true, expectedHost = "", attempts = [] } = {}) {
	const fragments = titleFragments(title);
	for (const fragment of fragments) {
		let found;
		try {
			found = await searchProducts(fragment, { timeoutMs, useRsc });
		} catch (err) {
			attempts.push({ fragment, error: String(err?.name || err) });
			continue;
		}
		attempts.push({ fragment, count: found.products.length });
		if (found.products.length === 0) continue;
		// 通常第一个就对；给前 3 个候选一次校验机会，避免排序波动导致错配
		for (const productPath of found.products.slice(0, 3)) {
			let product;
			try {
				product = await getProduct(productPath, { timeoutMs });
			} catch {
				continue;
			}
			if (!product) continue;
			if (backlinkMatches(product.backlink, code)) {
				return { product, fragment, hostMatched: hostMatches(product.backlink, expectedHost) };
			}
		}
	}
	return null;
}
