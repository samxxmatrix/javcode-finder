import { DEFAULT_CODE_REGEX } from "./settings";
import type { ExtractionResult } from "./types";
import type { UncensoredRules } from "./uncensored-code";

export const MAX_SCAN_CHARS = 2 * 1024 * 1024; // 2 MiB
export const MAX_CANDIDATES = 500;
export const MAX_CANDIDATE_LENGTH = 64;

export function isValidCodeCandidate(rawCandidate: string): boolean {
	const trimmed = rawCandidate.trim();
	if (!trimmed || trimmed.length > MAX_CANDIDATE_LENGTH) return false;

	// Reject URLs, protocol prefixes, and host prefixes
	if (/^(?:https?:\/\/|www\.)/i.test(trimmed)) return false;

	// Reject URL path separators, queries, and fragment characters
	if (/[/?&=#%\\]/.test(trimmed)) return false;

	// Reject common web domains and file extensions
	if (
		/\.(?:com|net|org|cn|tw|hk|jp|ws|top|io|tv|me|cc|xyz|html?|php|jsp|asp|json|png|jpg|jpeg|gif|webp|svg|mp4)$/i.test(
			trimmed,
		)
	) {
		return false;
	}

	// Must contain hyphen, underscore, or space separator (unless it strictly matches studio date pattern)
	const hasSeparator = /[-—–_\s]/.test(trimmed);
	const isStudioDate =
		/^[A-Za-z][A-Za-z0-9]*(?:\.\d{2,4}){2,3}$/i.test(trimmed);

	if (!hasSeparator && !isStudioDate) {
		return false;
	}

	// If candidate contains dots, it must strictly match studio date pattern (e.g. blacked.20.01.10)
	if (trimmed.includes(".")) {
		if (!isStudioDate) {
			return false;
		}
	}

	return true;
}

export function extractCandidatesFromText(
	text: string,
	customRegex?: string | RegExp,
): ExtractionResult {
	let truncated = false;
	let scanText = text;

	if (scanText.length > MAX_SCAN_CHARS) {
		scanText = scanText.slice(0, MAX_SCAN_CHARS);
		truncated = true;
	}

	const candidates: string[] = [];
	const seen = new Set<string>();

	let regex: RegExp;
	if (customRegex instanceof RegExp) {
		regex = new RegExp(customRegex.source, "gi");
	} else if (typeof customRegex === "string" && customRegex.trim()) {
		try {
			regex = new RegExp(customRegex.trim(), "gi");
		} catch {
			regex = new RegExp(DEFAULT_CODE_REGEX, "gi");
		}
	} else {
		regex = new RegExp(DEFAULT_CODE_REGEX, "gi");
	}

	let match: RegExpExecArray | null;
	regex.lastIndex = 0;
	while ((match = regex.exec(scanText)) !== null) {
		const rawCandidate = match[0].trim();
		if (!isValidCodeCandidate(rawCandidate)) {
			continue;
		}

		const upper = rawCandidate.toUpperCase();
		if (!seen.has(upper)) {
			seen.add(upper);
			candidates.push(rawCandidate);
			if (candidates.length >= MAX_CANDIDATES) {
				truncated = true;
				break;
			}
		}
	}

	return { candidates, truncated };
}

/**
 * Self-contained function executed in host page top-level document via scripting.executeScript.
 * Must not reference external closure variables.
 *
 * 正则模式必传：默认值由调用方（面板）从设置读取后作为参数传入。
 *
 * uncensored：无码匹配规则快照（面板用 buildUncensoredRules() 算好传进来）。
 * 传 null = D2PASS 开关关闭 —— 此时一行无码逻辑都不走，结果与接入前逐字一致。
 * 规则数据只能这样带进来：executeScript 只序列化函数源码、import 不跟随注入，
 * 所以下面按同一份数据自包含实现了一遍 uncensored-code.ts 的匹配引擎；
 * 两条路径的一致性由本文件 test 里的「交叉验证」用例守住。
 */
export function extractCandidatesInTab(
	customRegexPattern: string,
	uncensored: UncensoredRules | null,
): ExtractionResult {
	try {
		const bodyText = document.body ? document.body.innerText : "";
		const MAX_SCAN_CHARS = 2 * 1024 * 1024;
		const MAX_CANDIDATES = 500;
		const MAX_CANDIDATE_LENGTH = 64;

		let truncated = false;
		let scanText = bodyText;

		if (scanText.length > MAX_SCAN_CHARS) {
			scanText = scanText.slice(0, MAX_SCAN_CHARS);
			truncated = true;
		}

		let codeRegex: RegExp;
		try {
			codeRegex = new RegExp(customRegexPattern.trim(), "gi");
		} catch {
			return { candidates: [], truncated: false, unsupported: true };
		}

		const isValid = (str: string): boolean => {
			const trimmed = str.trim();
			if (!trimmed || trimmed.length > MAX_CANDIDATE_LENGTH) return false;
			if (/^(?:https?:\/\/|www\.)/i.test(trimmed)) return false;
			if (/[/?&=#%\\]/.test(trimmed)) return false;
			if (
				/\.(?:com|net|org|cn|tw|hk|jp|ws|top|io|tv|me|cc|xyz|html?|php|jsp|asp|json|png|jpg|jpeg|gif|webp|svg|mp4)$/i.test(
					trimmed,
				)
			) {
				return false;
			}
			return true;
		};

		// —— 有修正侧：既有 customRegex 扫描，过滤与去重口径保持不变 ——
		const customCandidates: string[] = [];
		{
			const seen = new Set<string>();
			let match: RegExpExecArray | null;
			codeRegex.lastIndex = 0;
			while ((match = codeRegex.exec(scanText)) !== null) {
				const rawCandidate = match[0].trim();
				if (!isValid(rawCandidate)) {
					continue;
				}

				const upper = rawCandidate.toUpperCase();
				if (!seen.has(upper)) {
					seen.add(upper);
					customCandidates.push(rawCandidate);
					if (customCandidates.length >= MAX_CANDIDATES) {
						truncated = true;
						break;
					}
				}
			}
		}

		if (!uncensored) {
			return { candidates: customCandidates, truncated };
		}

		// —— 无码侧：T1 强特征任何页面启用；T2 弱特征仅当全页命中锚点表 ——
		const lowerText = scanText.toLowerCase();
		const anchorsHit = uncensored.anchors.some(
			(anchor) => lowerText.indexOf(anchor.toLowerCase()) >= 0,
		);
		const sources = anchorsHit
			? uncensored.t1.concat(uncensored.t2)
			: uncensored.t1;

		// —— 无码侧命中：按规则分桶 ——
		// 不变量（下面去重规则①的等价改写依赖它）：同一条规则的一次 /g 扫描内命中互不重叠，
		// 且天然按 index 升序。
		type RawMatch = { text: string; index: number; length: number };
		const buckets: { matches: RawMatch[]; maxLength: number }[] = [];
		for (const source of sources) {
			let regex: RegExp;
			try {
				regex = new RegExp(source, "gi");
			} catch {
				continue;
			}
			const matches: RawMatch[] = [];
			let maxLength = 0;
			let match: RegExpExecArray | null;
			while ((match = regex.exec(scanText)) !== null) {
				if (match[0] === "") {
					regex.lastIndex += 1;
					continue;
				}
				const trimmed = match[0].trim();
				if (!trimmed) continue;
				matches.push({
					text: trimmed,
					index: match.index,
					length: trimmed.length,
				});
				if (trimmed.length > maxLength) maxLength = trimmed.length;
			}
			buckets.push({ matches, maxLength });
		}

		// 去重规则①：长匹配优先（被更长匹配完整包含的短匹配丢弃）——与模块同算法的自包含复写：
		// 能完整包含 m 的匹配必须覆盖 m 的起始位置，每个规则里这样的匹配至多一条，且必定是
		// "该规则中 index ≤ m.index 的最后一条" ⇒ 每条命中对每个桶做一次二分即可，
		// 不必 O(n²) 两两比对（这段跑在被注入页面的主线程上，2 MiB 页面能产出 30 万+ 条命中）。
		// 判定条件与最初的实现逐字一致：容器必须**严格更长**，边界比较都取等号。
		//
		// ⚠️ 顺序不变量：本副本与模块**同序**（模块的表达式是 `dropAnchorNumbers(dropContained(...))`，
		//    这里也是先 ① 再去重②）。两种顺序当前等价，**仅因为** anchorNumbers 全是 4 位数字
		//    （`0930`/`4610`/`9898`）而所有规则的最短命中是 5 位：锚点自带数字既不可能被更长的命中包含、
		//    也不可能当容器。这个不变量一旦被新规则打破（出现 ≤4 位的最短命中），两种顺序就有语义差别，
		//    那时必须同时改模块与这里。
		//    另注意：Task 14 的"输出比对"式交叉验证**检测不到**这类顺序漂移（同一份输入下两种顺序的
		//    输出逐字相同），所以"同序 + 这条注释"是唯一保障——不要单独动其中一处。
		const lastAtOrBefore = (
			matches: RawMatch[],
			index: number,
		): RawMatch | null => {
			let low = 0;
			let high = matches.length - 1;
			let found: RawMatch | null = null;
			while (low <= high) {
				const mid = (low + high) >> 1;
				// mid 必然在范围内；这里的判空只是满足 noUncheckedIndexedAccess
				const candidate = matches[mid];
				if (candidate && candidate.index <= index) {
					found = candidate;
					low = mid + 1;
				} else {
					high = mid - 1;
				}
			}
			return found;
		};
		const droppedContained = new Set<RawMatch>();
		for (const bucket of buckets) {
			for (const m of bucket.matches) {
				for (const other of buckets) {
					// 容器必须严格更长：这个桶里最长都不够长，就不必二分
					if (other.maxLength <= m.length) continue;
					const container = lastAtOrBefore(other.matches, m.index);
					if (!container || container.length <= m.length) continue;
					if (container.index + container.length >= m.index + m.length) {
						droppedContained.add(m);
						break;
					}
				}
			}
		}
		const keptContained: RawMatch[] = [];
		for (const bucket of buckets) {
			for (const m of bucket.matches) {
				if (!droppedContained.has(m)) keptContained.push(m);
			}
		}

		// 去重规则②：锚点自带数字排除（エッチな0930 的 0930、h4610 的 4610、av9898 的 9898）
		// 放在 ① 之后 ⇒ 顺序与模块一致：②的输入是①的输出（扁平列表），与模块的 dropAnchorNumbers 同形。
		const kept = keptContained.filter(
			(m) => uncensored.anchorNumbers.indexOf(m.text) < 0,
		);

		const uncensoredSeen = new Set<string>();
		const uncensoredCandidates: string[] = [];
		for (const m of kept.slice().sort((a, b) => a.index - b.index)) {
			const key = m.text.toUpperCase();
			if (uncensoredSeen.has(key)) continue;
			uncensoredSeen.add(key);
			uncensoredCandidates.push(m.text);
		}

		// —— 合并：无码优先；排除正则在合并去重之后、只对判定为无码的候选执行 ——
		const isExcluded = (candidate: string): boolean => {
			if (!uncensored.exclude) return false;
			try {
				// 不加 g：RegExp.test 带 g 会留 lastIndex 状态
				return new RegExp(uncensored.exclude).test(candidate);
			} catch {
				return false;
			}
		};

		const merged: string[] = [];
		const mergedSeen = new Set<string>();
		for (const candidate of uncensoredCandidates) {
			const key = candidate.toUpperCase();
			if (mergedSeen.has(key) || isExcluded(candidate)) continue;
			mergedSeen.add(key);
			merged.push(candidate);
		}
		for (const candidate of customCandidates) {
			const key = candidate.toUpperCase();
			// 双命中的号已经在无码那一路判定过（含被排除的情况），绝不能从有修正这路复活
			if (uncensoredSeen.has(key) || mergedSeen.has(key)) continue;
			mergedSeen.add(key);
			merged.push(candidate);
		}

		if (merged.length > MAX_CANDIDATES) {
			return { candidates: merged.slice(0, MAX_CANDIDATES), truncated: true };
		}
		return { candidates: merged, truncated };
	} catch {
		return { candidates: [], truncated: false, unsupported: true };
	}
}
