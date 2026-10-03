/**
 * Normalizes a video code string according to Section 7 of docs/browser-extension.md:
 * 1. Unicode NFKC normalization
 * 2. Trim
 * 3. Uppercase using locale-independent behavior
 * 4. Normalize dash, underscore, and whitespace runs
 */
export function normalizeCode(raw: string | null | undefined): string {
	if (!raw) return "";
	return raw
		.normalize("NFKC")
		.trim()
		.toUpperCase()
		.replace(/\bFC2[-_\s]*PPV[-_\s]*/gi, "FC2-")
		.replace(/[\s_—–-]+/g, "-");
}

/**
 * Produces a normalized comparison key that removes supported separators
 * without changing letters or digits.
 *
 * e.g. "ABP-123" -> "ABP123"
 *      "abp 123" -> "ABP123"
 *      "FC2 PPV 3061625" -> "FC23061625"
 *      "ＦＣ２－３０６１６２５" -> "FC23061625"
 */
export function toComparisonKey(raw: string | null | undefined): string {
	if (!raw) return "";
	return raw
		.normalize("NFKC")
		.trim()
		.toUpperCase()
		.replace(/\bFC2[-_\s]*PPV[-_\s]*/gi, "FC2-")
		.replace(/[\s_—–-]+/g, "");
}

/**
 * 面板显示码 → 外部平台跳转码。
 *
 * 抽取层保留页面原文，但列表渲染前经 normalizeCode() 把 FC2 系列的 PPV 段压平
 * （"FC2-PPV-123456" / "FC2 PPV 123456" → "FC2-123456"）。javdb、supjav 等外部站点
 * 只认 "FC2-PPV-<数字>" 写法，因此跳转前在此补回 PPV；面板显示、收藏、Emby 在库判定
 * 与预览查询一律继续使用显示码。
 *
 * 入参约定为已归一化的显示码（normalizeCode() 的输出）；非 FC2 番号原样返回。
 */
export function toExternalSearchCode(raw: string | null | undefined): string {
	const code = (raw ?? "").trim();
	if (!code) return "";
	const match = /^FC2-(\d{3,8})$/.exec(code);
	return match ? `FC2-PPV-${match[1]!}` : code;
}
