import { toComparisonKey } from "./normalize-code";

/**
 * 番号 → FALENO 官网格式 key:去分隔符、转小写(如 FNS-263 → fns263)。
 * 空输入返回空串,调用方跳过请求。
 */
export function toFalenoCodeKey(code: string): string {
	return toComparisonKey(code).toLowerCase();
}

/**
 * 拼接 FALENO 作品页 URL:https://faleno.jp/top/works/{小写去连字符番号}。
 * 站点会自动重定向到带尾斜杠的正式地址,fetch 自动跟随。
 */
export function buildFalenoWorksUrl(code: string): string {
	const key = toFalenoCodeKey(code);
	if (!key) return "";
	return `https://faleno.jp/top/works/${key}`;
}

/**
 * 归一化番号头设置项:trim + 转 comparison key(去分隔符、大写)。
 * 空串或纯分隔符输入返回空串,由调用方过滤。
 */
export function normalizePrefix(input: string): string {
	return toComparisonKey(input);
}

/**
 * 番号是否命中任一 FALENO 番号头:两侧均转 comparison key 比较,
 * 大小写与分隔符通吃。空番号或空前缀列表均不命中。
 */
export function matchesFalenoPrefix(code: string, prefixes: string[]): boolean {
	const key = toComparisonKey(code);
	if (!key) return false;
	return prefixes.some((prefix) => {
		const normalized = normalizePrefix(prefix);
		return Boolean(normalized) && key.startsWith(normalized);
	});
}
