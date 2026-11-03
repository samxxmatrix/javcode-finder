import { extractCandidatesFromText } from "./extract-codes";
import { normalizeCode } from "./normalize-code";
import { DEFAULT_CODE_REGEX } from "./settings";
import {
	buildUncensoredRules,
	findUncensoredCandidatesWithIndex,
	mergeCandidateLists,
} from "./uncensored-code";

/**
 * 面板搜索框输入 → 单个番号。
 *
 * 与页面扫描同一口径的两路抽取（有码 customRegex + 无码 T1/T2 规则），差别只有三点：
 *   1. **排除正则一律传空串**：`uncensored-code.ts` 已定口径"排除只作用于候选列表（降噪），
 *      手动输入 / 直接查询照样走"。实测反证：把设置里的排除正则传进 mergeCandidateLists，
 *      手动输入 `HEYZO-3953` 时 mergeCandidateLists 返回空列表（无码侧被排除、有码侧又被无码键挡住）。
 *   2. 取合并后**最靠前**的一个（列表场景才需要全部）。
 *   3. 两路都抽不到 → 退回 `normalizeCode(input)`，即接入前的行为
 *      （`n3351` / `ori1812` 属 T2，需页面锚点才启用，纯手输抽不到；裸 `3997` 无规则覆盖）。
 *
 * 抽不到也不返回空串地"猜"：**含非键字符**的脏串（中文/冒号）由反代的键卫生守门挡住，不会变成缓存键；
 * 纯空白分隔的串不在此列（`"foo bar baz"` 归一化成 `FOO-BAR-BAZ`，能过反代的 CLEAN_KEY）。
 */
export function pickSearchCode(
	rawInput: string | null | undefined,
	customRegex?: string,
): string {
	const input = String(rawInput ?? "").trim();
	if (!input) return "";

	const censored = extractCandidatesFromText(
		input,
		customRegex || DEFAULT_CODE_REGEX,
		// indexOf 取首次字面命中：更早的出现必在更长的同 index 候选内部，后者排序更靠前，故首个命中即"最靠前"。
	).candidates.map((text) => ({ text, index: input.indexOf(text) }));
	// 手动输入没有"页面噪声"问题，但 T2 的锚点门控仍照旧生效（见上面的已知局限）
	const uncensored = findUncensoredCandidatesWithIndex(
		input,
		buildUncensoredRules(""),
	);

	const first = mergeCandidateLists(censored, uncensored, "")[0];
	return normalizeCode(first ?? input);
}
