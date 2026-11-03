/**
 * Normalizes a video code string into the panel's **display code**:
 * 1. Unicode NFKC normalization
 * 2. Trim
 * 3. Uppercase using locale-independent behavior
 * 4. Collapse whitespace and dash-variant runs into "-"
 *
 * 口径见 `docs/browser-extension.md` 的「番号规范化（Code normalization）」节
 * （原注释引的 "Section 7" 现在是「版本与更新」，属过时引用，2026-10-08 一并改正）。
 *
 * ⚠️ **分隔符语义（2026-10-08 用户实测修正）**：`-` 与 `_` **编码不同片商**，不得互相折叠。
 * 实测：`100826_001` → 1pondo（一本道）、`100826-001` → caribbeancom（カリビアンコム），
 * 是**两部不同作品**（线上 API 返回的 `site` 就是这两个）。折叠会让面板列表去重后只剩一条，
 * 另一部**永远查不到**，所以本函数只折空白与破折号变体（`—`/`–`），**保留 `-` 与 `_`**。
 *
 * 需要"写法无关"的匹配时用 `toComparisonKey()`（它故意剥离分隔符）——
 * 但**不要**把它的结果当显示码、收藏键或查询码。
 */
export function normalizeCode(raw: string | null | undefined): string {
	if (!raw) return "";
	return raw
		.normalize("NFKC")
		.trim()
		.toUpperCase()
		.replace(/\bFC2[-_\s]*PPV[-_\s]*/gi, "FC2-")
		.replace(/[\s—–-]+/g, "-");
}

/**
 * 面板列表去重：按 `normalizeCode` 归一后**保序**保留首次出现，输出归一化形式。
 *
 * 抽成纯函数是为了让"同一页面的两个号都要显示"这条口径**有测试网**：此前它内联在
 * `CodeList` 组件里，`100826_001` 被折成 `100826-001` 后整条从列表消失，没有任何断言会发现。
 */
export function dedupeDisplayCodes(candidates: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const candidate of candidates) {
		const normalized = normalizeCode(candidate);
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			out.push(normalized);
		}
	}
	return out;
}

/**
 * Produces a normalized comparison key that removes supported separators
 * without changing letters or digits.
 *
 * e.g. "ABP-123" -> "ABP123"
 *      "abp 123" -> "ABP123"
 *      "FC2 PPV 3061625" -> "FC23061625"
 *      "ＦＣ２－３０６１６２５" -> "FC23061625"
 *
 * ⚠️ 与 `normalizeCode` 的差异是**有意**的：本函数**剥离**分隔符，所以 `100826_001` 与
 * `100826-001` 的比较键相同。它只用于"写法无关"的匹配（Emby 在库判定、javtrailers 卡片比对），
 * **不得**用它的结果当显示码、收藏键或查询码 —— 那两个号是两部不同作品（见文件头说明）。
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
