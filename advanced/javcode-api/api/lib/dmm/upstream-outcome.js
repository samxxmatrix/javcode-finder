/**
 * 上游结果的定性：把"确认查无"与"查不动"分开。纯函数，无 IO。
 *
 * 背景：接入前 `searchDigital` / mono 搜索 / 详情页三处把上游失败吞成 null，
 * 一路降级成 404 ITEM_NOT_FOUND，客户端于是把接口抖动当"番号不存在"（见 spec §15）。
 */

/** 命中 */
export const HIT = "hit";
/** 确认查无（可以安全地对外报 404） */
export const NOT_FOUND = "not_found";
/** 无法定性（非 404/410 的非 2xx（含 WAF 403）/ 超时 / 网络错 / 拦截页）—— 对外报 503，且**不进缓存** */
export const UPSTREAM = "upstream";

/** HTTP 状态 → 定性：只有 404/410 算确认查无 */
export function classifyHttpStatus(status) {
	if (status === 404 || status === 410) return NOT_FOUND;
	return UPSTREAM;
}

/**
 * 合并数字版与 mono 两路的定性（spec §15.3）：
 * 任一路命中即命中；只有两路都确认查无才是查无；否则一律"无法定性"。
 * ⚠️ 最后一条是关键：数字版抖动 + mono 查无 ≠ 这部片不存在（它可能只在数字版有）。
 */
export function combineRouteOutcomes(digital, mono) {
	if (digital === HIT || mono === HIT) return HIT;
	if (digital === NOT_FOUND && mono === NOT_FOUND) return NOT_FOUND;
	return UPSTREAM;
}

const BLOCKED_MARKERS = ["年齢認証", "age_check"];

/**
 * 命中年龄确认页（年齢認証 / age_check）（200 也可能是拦截页，不能当查无）
 *
 * ⚠️ 调用方**先** `isBlockedPage` 再 `hasDetailContent`；`html` 为 null/undefined（根本没拿到 body）
 * 不得当作查无 —— 否则会重现 §15.3 那个「HTTP 200 + 年齢認証 → 报成 404」的 bug。
 */
export function isBlockedPage(html) {
	const text = String(html ?? "");
	return BLOCKED_MARKERS.some((marker) => text.includes(marker));
}

/** DMM 详情页"有内容"的判据（沿用接入前口径：og:title 或 pl.jpg） */
export function hasDetailContent(html) {
	const text = String(html ?? "");
	return text.includes("og:title") || text.includes("pl.jpg");
}
