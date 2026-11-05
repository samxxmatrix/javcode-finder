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
 * 传 null = D2PASS 开关关闭 —— 此时一行无码逻辑都不走，结果与接入前逐字一致
 * （**唯一例外**是全局黑名单：excludeRegex 与开关无关，D2PASS 关闭时仍会压有码误报）。
 * excludeRegex：全局黑名单（可省略；省略时回退到 uncensored.exclude，兼容旧调用）。
 * 规则数据只能这样带进来：executeScript 只序列化函数源码、import 不跟随注入，
 * 所以下面按同一份数据自包含实现了一遍 uncensored-code.ts 的匹配引擎。
 * **覆盖面写清楚，别把"守住了"说大**（Task 15 复核纠正）：「交叉验证」用例只守**无码识别
 * 那一路**（它的有修正侧输入恒为空），**合并段**由本文件注入侧的单点用例守住。
 */
export function extractCandidatesInTab(
	customRegexPattern: string,
	uncensored: UncensoredRules | null,
	excludeRegex?: string,
	viewport = false,
	forceFull = false,
): ExtractionResult {
	try {
		const MAX_SCAN_CHARS = 2 * 1024 * 1024;
		const MAX_CANDIDATES = 500;
		const MAX_CANDIDATE_LENGTH = 64;

		// 取视口内可见文本（安全模式手动扫描用）。注入自包含实现：递归遍历 DOM，
		// 剪掉整棵在视口外的子树（含 display:none / visibility:hidden），收集每个元素的
		// 直接文本节点。逐元素 getBoundingClientRect 只对可见元素发生（视口外子树已被剪枝），开销有界。
		// 已知限制：跨「父文本 + 元素子节点」的番号（如 `ABP-<b>123</b>`）会被换行拆开、可能漏匹配；
		// 安全模式本就是「手动 + 视口」的最佳努力扫描，可接受。
		const getViewportText = (): string => {
			const vw =
				window.innerWidth || (document.documentElement?.clientWidth ?? 0);
			const vh =
				window.innerHeight || (document.documentElement?.clientHeight ?? 0);
			const parts: string[] = [];
			const walk = (el: Element): void => {
				const rect = el.getBoundingClientRect();
				// 整棵子树在视口外（任一方向）→ 剪枝，不再递归
				if (
					rect.bottom <= 0 ||
					rect.top >= vh ||
					rect.right <= 0 ||
					rect.left >= vw
				)
					return;
				const cs = getComputedStyle(el);
				if (cs.visibility === "hidden" || cs.display === "none") return;
				// 收集本元素直接文本节点（带元素子节点的元素里的文字也会被漏掉，故在此补收）
				let direct = "";
				const nodes = el.childNodes;
				for (let i = 0; i < nodes.length; i++) {
					const node = nodes[i];
					if (node && node.nodeType === 3 /* TEXT_NODE */)
						direct += node.textContent || "";
				}
				const trimmed = direct.trim();
				const children = el.children;
				if (children.length === 0) {
					if (trimmed) parts.push(trimmed);
				} else {
					if (trimmed) parts.push(trimmed);
					for (let i = 0; i < children.length; i++) {
						const child = children[i];
						if (child) walk(child);
					}
				}
			};
			if (document.body) walk(document.body);
			return parts.join("\n");
		};

		let truncated = false;
		let scanText: string;

		if (viewport) {
			// 安全模式：只扫视口内可见文本（手动触发），避免大页整页全扫
			scanText = getViewportText();
		} else {
			const bodyText = document.body ? document.body.innerText : "";
			if (bodyText.length > MAX_SCAN_CHARS) {
				if (forceFull) {
					// 用户关闭横幅后的显式整页扫描：扫前 2 MiB 给截断结果与候选，
					// 但仍标记 safeMode（页面仍过大 → 横幅再次弹回）。成本受 2 MiB 上界约束。
					scanText = bodyText.slice(0, MAX_SCAN_CHARS);
					truncated = true;
				} else {
					// 整页超 2 MiB：进安全模式，跳过昂贵的正则全扫（innerText 重排已发生，
					// 但免去后续 30 万+ 命中的扫描/去重）。候选由用户手动扫视口获取。
					return { candidates: [], truncated: false, safeMode: true };
				}
			} else {
				scanText = bodyText;
			}
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

		// 带页面位置的候选：`index` = 命中在页面文本里的起始偏移。
		// 注入副本**自包含**：这里刻意不认识 uncensored-code.ts 的 IndexedCandidate，
		// 只按同形结构本地声明一份（import 不跟随注入）。
		type IndexedCandidate = { readonly text: string; readonly index: number };

		// —— 有修正侧：既有 customRegex 扫描，过滤与去重口径保持不变（只额外保住位置）——
		const customCandidates: IndexedCandidate[] = [];
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
					// index 用正则命中的**原始偏移**（不是 trim 之后的位置）：两路的页面序必须同尺子
					customCandidates.push({ text: rawCandidate, index: match.index });
					if (customCandidates.length >= MAX_CANDIDATES) {
						truncated = true;
						break;
					}
				}
			}
		}

		// 全局黑名单：排除正则对两路候选都生效，且**与 D2PASS 开关无关**（uncensored 为 null 时
		// 也要压有码误报）。显式入参优先；未传时回退到无码规则快照里的 exclude（旧调用兼容）。
		// 模式自身先 trim（纯空白 = 不排除），与模块端 `(excludeRegex || "").trim()` 逐字对齐。
		const excludePattern = (
			excludeRegex !== undefined ? excludeRegex : (uncensored?.exclude ?? "")
		).trim();
		const isExcluded = (candidate: string): boolean => {
			if (!excludePattern) return false;
			try {
				// 不加 g：RegExp.test 带 g 会留 lastIndex 状态
				return new RegExp(excludePattern).test(candidate);
			} catch {
				return false;
			}
		};

		if (!uncensored) {
			// D2PASS 关闭：无码逻辑一律不走，但有码侧仍要过全局黑名单
			return {
				candidates: customCandidates
					.filter((c) => !isExcluded(c.text.trim()))
					.map((c) => c.text),
				truncated,
				// full 模式下撞 500 上限即进安全模式；视口模式不置
				safeMode: !viewport && truncated,
			};
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

		// 无码侧：按页面顺序去重（大小写不敏感）+ 保留位置。
		// `uncensoredKeys` 顺带就是合并段要用的"无码侧 key 集合"（用 trim 后的 text 算），
		// 口径与模块端 mergeCandidateLists 一致。
		const uncensoredKeys = new Set<string>();
		const uncensoredCandidates: IndexedCandidate[] = [];
		for (const m of kept.slice().sort((a, b) => a.index - b.index)) {
			const key = m.text.trim().toUpperCase();
			if (uncensoredKeys.has(key)) continue;
			uncensoredKeys.add(key);
			uncensoredCandidates.push({ text: m.text, index: m.index });
		}

		// —— 合并：全局页面顺序（Task 15）；排除正则（全局黑名单）对两路候选都生效、在合并去重之后执行 ——
		// 与模块端 mergeCandidateLists 同一算法（无码优先入选 → 有修正侧被无码 key 挡住 →
		// 按 index 升序 → 取 text）。这一段**不在**「交叉验证」用例的射程内（那边的有修正侧
		// 输入恒为空），由本文件注入侧的单点用例守住：页面顺序、排除与"被排除的号不复活"、
		// 合并后按页面位置截断到 500。
		// 排除模式 / isExcluded 已在上方（D2PASS 关闭分支之前）定义，此处直接复用。

		// key → 入选候选；Map 的插入序 = 入选顺序（无码在前）
		const winners = new Map<string, IndexedCandidate>();
		for (const candidate of uncensoredCandidates) {
			const trimmed = candidate.text.trim();
			const key = trimmed.toUpperCase();
			if (!trimmed || winners.has(key) || isExcluded(trimmed)) continue;
			winners.set(key, { text: trimmed, index: candidate.index });
		}
		for (const candidate of customCandidates) {
			const trimmed = candidate.text.trim();
			const key = trimmed.toUpperCase();
			// 全局黑名单：有修正侧候选同样过 isExcluded（压有码误报）；
			// 双命中的号已经在无码那一路判定过（含被排除的情况），绝不能从有修正这路复活
			if (
				!trimmed ||
				winners.has(key) ||
				uncensoredKeys.has(key) ||
				isExcluded(trimmed)
			)
				continue;
			winners.set(key, { text: trimmed, index: candidate.index });
		}
		// index 相同则保持入选顺序（无码在前）：sort 稳定，行为确定
		const merged = [...winners.values()]
			.sort((a, b) => a.index - b.index)
			.map((candidate) => candidate.text);

		// 上限截断保留；合并结果已按页面位置升序 ⇒ 现在截掉的是**页面靠后的候选**
		// （旧口径是"无码优先地截"，等于把无码全保住、优先截有修正侧）。
		if (merged.length > MAX_CANDIDATES) {
			return {
				candidates: merged.slice(0, MAX_CANDIDATES),
				truncated: true,
				// 合并段截断 = 候选超 500，full 模式进安全模式；视口模式不置
				safeMode: !viewport,
			};
		}
		return { candidates: merged, truncated, safeMode: !viewport && truncated };
	} catch {
		return { candidates: [], truncated: false, unsupported: true };
	}
}
