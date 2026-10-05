/**
 * 无码番号识别（两层匹配器）。纯函数、不碰 DOM：页面文本由调用方传入。
 *
 * 规则来源：docs/browser-extension.md:74-99
 *   T1 强特征（任何页面启用，5 条）：日期型 / HEYZO / 3dw / hitozuma / 零填充 5 位
 *   T2 弱特征（全页命中锚点表才启用，5 条）：ori|gol / les / n / 两段数字型（`-` 或 `/` / `-` 或 `_`）
 *   共 **10 条**正则：源文档表格是 8 行，其中一行含 3 个备选
 *   锚点表：18 家站名与域名 + 無修正 / 無碼 / 无码 / uncensored
 *   去重①：长匹配优先（被更长匹配完整包含的短匹配丢弃；唯一可达形态是 `04684` ⊂ `04684-4229`
 *          ——没有任何规则匹配裸 4 位数字，`4229-2960` 丢掉 `4229`/`2960` 那种写法不可达）
 *   去重②：锚点自带数字排除（エッチな0930 的 0930、h4610 的 4610、av9898 的 9898）
 * 实测口径（同文档 :101-108）：裸番号 10/11 命中；带锚点弱形态 4/4；噪音 28 条 + URL 路径片段 3 条
 * 0 误报（另有 2 条 URL 形态接受为残留：`img/04684/01` 的 `04684`、`ID:12345/678`——
 * 它们与真实番号/写法在文本上不可区分，收紧断言会变成漏报，见 test 里的专门用例）。
 *
 * ⚠️ 注入端**已落地**（Task 9，提交 95411ab）：src/lib/extract-codes.ts 的 extractCandidatesInTab 由
 * executeScript 序列化后在页面里执行，import 不跟随注入，所以那边按同一份规则数据自包含地复写了
 * 这套匹配引擎；规则快照（本模块 UNCENSORED_RULES 的可注入副本）由 buildUncensoredRules() 算好后
 * 随 executeScript 的 args 一起进页面。
 * 两条路径的一致性由 test/extract-codes.test.ts 的「交叉验证」用例守住（16 组语料逐字比对）；
 * 该副本已实测自包含：with + Proxy 的自由标识符探针显示它只依赖 RegExp / Set / document。
 */

import { isValidRegex } from "./settings";

/** 注入端要用的规则快照：函数不能 import，只能整份当参数传进页面 */
export interface UncensoredRules {
	/** T1 强特征正则源码（编译时统一加 gi） */
	t1: string[];
	/** T2 弱特征正则源码（仅锚点命中时启用） */
	t2: string[];
	/** 锚点词与域名（大小写不敏感地做子串判定） */
	anchors: string[];
	/** 锚点自带数字：这些裸数字不当番号 */
	anchorNumbers: string[];
	/** 无码番号排除正则源码；留空 = 不排除 */
	exclude: string;
}

/** 锚点分组：一家加盟站 = 站名 + 域名 */
export interface AnchorGroup {
	/** 站名（中日文写法；判定时大小写不敏感地做子串包含） */
	name: string;
	/** 源站域名（判定是大小写不敏感的子串包含，多数按原锚点写裸域名；与站名大小写重复的写全域名，见下面注释） */
	domains: string[];
}

/**
 * 18 家加盟站（docs/d2pass-api接口文档.md §5 的 18 行，一家一条）。
 * **按家分组**而不是拉平成一串：新增一家站只动这一处，下面三条防漂移断言
 * （家数 = 18、锚点表无大小写重复、域名里的 4 位数字必须已列进 anchorNumbers）才有结构可挂。
 * 对外/注入载荷形状不变：`UncensoredRules.anchors` 仍是拉平后的 `string[]`。
 */
export const ANCHOR_GROUPS: readonly AnchorGroup[] = [
	{ name: "Hey動画", domains: ["heydouga"] },
	{ name: "女体のしんぴ", domains: ["nyoshin"] },
	{ name: "カリビアンコム", domains: ["caribbeancom"] },
	{ name: "カリビアンコムプレミアム", domains: ["caribbeancompr"] },
	{ name: "一本道", domains: ["1pondo"] },
	{ name: "天然むすめ", domains: ["10musume"] },
	// 域名写全 `heyzo.com`：判定大小写不敏感，`heyzo` 恒等于站名 `HEYZO`，写裸域名就是死数据
	{ name: "HEYZO", domains: ["heyzo.com"] },
	{ name: "ピッカー", domains: ["pikkur"] },
	{ name: "パコパコママ", domains: ["pacopacomama"] },
	// 同上：站名恒等于裸域名，域名按源文档 §5 写全（也是 anchorNumbers 里 `9898` 的来处）
	{ name: "av9898", domains: ["av9898.heydouga.com"] },
	{ name: "金髪天國", domains: ["kin8tengoku"] },
	{ name: "エロックスジャパン", domains: ["eroxjapanz"] },
	{ name: "ムラムラ", domains: ["muramura"] },
	{ name: "エッチな4610", domains: ["h4610"] },
	{ name: "エッチな0930", domains: ["h0930"] },
	{ name: "人妻斬り", domains: ["c0930"] },
	{ name: "うんこたれ", domains: ["unkotare"] },
	{ name: "3d-eros", domains: ["3d-eros.net", "3dw"] },
];

/** 无码语境词：不属任何加盟站，单独一组 */
const CONTEXT_ANCHORS: string[] = ["無修正", "無碼", "无码", "uncensored"];

/**
 * 冻结一组字符串：`Object.freeze` 的类型是 `readonly string[]`，而对外/注入载荷形状要保住
 * `string[]`（消费者与注入端都按可变数组用），所以这里用一处显式断言换回可变类型。
 * 运行时确实已冻结：ESM 恒为严格模式，写入会抛 TypeError（测试里钉住了这一点）。
 */
function freezeItems(items: string[]): string[] {
	return Object.freeze(items) as string[];
}

/** 冻结整份规则表（对象 + 四个数组）：它是唯一数据源，不能被消费者 push 一下改掉。 */
function freezeRules(rules: UncensoredRules): UncensoredRules {
	return Object.freeze({
		t1: freezeItems(rules.t1),
		t2: freezeItems(rules.t2),
		anchors: freezeItems(rules.anchors),
		anchorNumbers: freezeItems(rules.anchorNumbers),
		exclude: rules.exclude,
	});
}

export const UNCENSORED_RULES: UncensoredRules = freezeRules({
	// 每条规则上方一行注释 = 它挡什么（边界断言 + 具体形态），下面的噪音语料表按这些名字点名。
	t1: [
		// 日期型：月日校验（01–12 / 01–31）是主要防线；尾断言挡 `100426-00123`（超 4 位的尾巴不截断），
		// 前边界挡"嵌在更长数字串里"的日期型（`1100426-001`、`v1.100426-001`）
		String.raw`(?<![\d._])(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{2}[-_]\d{2,4}(?![\d])`,
		// HEYZO：前边界挡字母/数字粘连（`SHEYZO-3953`），尾断言挡 `HEYZO-395312` 这类截断
		String.raw`(?<![A-Z0-9])HEYZO[-_ ]?\d{3,5}(?![\d])`,
		// 3dw：前边界挡字母/数字粘连（`x3dw-315`），尾断言挡 `3dw-31555`
		String.raw`(?<![A-Z0-9])3dw[-_]\d{3,4}(?![\d])`,
		// hitozuma：前边界挡字母/数字粘连（`xhitozuma1579`），尾断言挡 `hitozuma157912`
		String.raw`(?<![A-Z0-9])hitozuma\d{3,5}(?![\d])`,
		// 零填充 5 位：前边界额外排除字母与 `.`/`_`（`DSC04684`、`IMG_04684.jpg`、`No.00001`），
		// 尾断言挡 `046845`；位数下限 `0\d{4}` 顺带放过裸 4 位数字（`No.0001`、`3953`）
		String.raw`(?<![A-Za-z0-9._])0\d{4}(?![\d])`,
	],
	t2: [
		// ori|gol：前边界挡字母粘连（`sori1812`），尾断言挡 `ori181234`（不截断成 `ori18123`）
		String.raw`(?<![A-Z0-9])(?:ori|gol)\d{4,5}(?![\d])`,
		// les：前边界挡字母粘连（`bles3351`），尾断言挡 `les33511`
		String.raw`(?<![A-Z0-9])les\d{3,4}(?![\d])`,
		// n：前边界挡"前面还有字母"的形态（噪音 `on3351`），尾断言挡 `n335123` 这类截断形态
		String.raw`(?<![A-Z0-9])n\d{4,5}(?![\d])`,
		// 数字型（`-` 或 `/`）：前断言里的 `/`/`.`/`_`/数字挡掉 URL 路径片段与长数字串中段
		// （`/video/12345/678.html` 的 `12345/678`、`09-1234-5678` 的 `1234-5678`）；
		// 尾断言挡 `2024-01`（后面还跟着 `-`+数字：噪音 `2024-01-15` / `2024/01/15`）
		String.raw`(?<![\d._/-])\d{3,5}[-/]\d{2,4}(?![\d])(?![-/]\d)`,
		// 数字型（`-` 或 `_`）：与上一条共用同一套边界，不给未来留两套口径；
		// 前断言挡 `Tel: +81-90-1234-5678` 里的 `90-1234`，尾断言挡 `09-1234-5678` 里的 `09-1234`
		String.raw`(?<![\d._/-])\d{2,4}[-_]\d{3,4}(?![\d])(?![-/]\d)`,
	],
	// 18 家加盟站（站名 + 域名）+ 无码语境词，由分组派生 ⇒ 新增一家站只动 ANCHOR_GROUPS 一处
	anchors: [
		...ANCHOR_GROUPS.flatMap((group) => [group.name, ...group.domains]),
		...CONTEXT_ANCHORS,
	],
	anchorNumbers: ["0930", "4610", "9898"],
	exclude: "",
});

/**
 * 规则表加载期自检：把 T1/T2 全部编译一次，**编译失败直接抛**。
 * 手写常量表的笔误（括号不配对、转义写坏）必须在模块加载期炸出来，不能退化成
 * `collectMatches` 里的 `catch { continue }` —— 那样只有"笔误规则的新形态恰好也进了语料"时才会红。
 * 导出只为让 test 反证"坏源码真的抛"。
 * ⚠️ 注入副本（计划 Task 9）**不能**这么干：那边抛错会毁掉整页，必须保留 try/catch。
 */
export function assertRulesCompile(rules: UncensoredRules): void {
	for (const source of [...rules.t1, ...rules.t2]) {
		new RegExp(source, "gi");
	}
}

// 模块加载期就跑一遍：笔误 ⇒ import 即抛 ⇒ `npm test` / 任何 import 它的编译产物立刻红
assertRulesCompile(UNCENSORED_RULES);

/** 锚点判定本体：抽成内部函数，好让调用方能按传入的规则快照判定 */
function hasAnyAnchor(text: string, anchors: string[]): boolean {
	const lower = (text || "").toLowerCase();
	if (!lower) return false;
	return anchors.some((anchor) => lower.includes(anchor.toLowerCase()));
}

/**
 * 页面文本是否命中锚点表：判定"这是无码语境"。
 * 第二参数可选（`hasUncensoredAnchor(text)` 照旧可用）：不传就用内置规则表，
 * 传了就以传入的规则快照为准 —— 规则集在这条链路上可注入，不再直接捕获全局常量。
 */
export function hasUncensoredAnchor(
	text: string,
	rules: UncensoredRules = UNCENSORED_RULES,
): boolean {
	return hasAnyAnchor(text, rules.anchors);
}

interface RawMatch {
	text: string;
	index: number;
	length: number;
}

/**
 * 单条规则的全部命中。不变量（去重规则①的等价改写依赖它）：
 * 同一条规则的一次 `/g` 扫描内，命中互不重叠，且天然按 index 升序。
 */
interface MatchBucket {
	matches: RawMatch[];
	/** 桶内最长命中的长度（容器必须**严格更长**：短于它的候选在本桶必然找不到容器，用来剪枝） */
	maxLength: number;
}

/** 逐条规则跑一遍，按规则分桶收集命中（含位置，供两条去重规则用） */
function collectMatches(text: string, sources: string[]): MatchBucket[] {
	const buckets: MatchBucket[] = [];
	for (const source of sources) {
		let regex: RegExp;
		try {
			regex = new RegExp(source, "gi");
		} catch {
			// 内置规则不该编译失败；真失败也只跳过这一条，不影响其余规则
			continue;
		}
		const matches: RawMatch[] = [];
		let maxLength = 0;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(text)) !== null) {
			if (match[0] === "") {
				regex.lastIndex += 1;
				continue;
			}
			const trimmed = match[0].trim();
			if (!trimmed) continue;
			matches.push({ text: trimmed, index: match.index, length: trimmed.length });
			if (trimmed.length > maxLength) maxLength = trimmed.length;
		}
		buckets.push({ matches, maxLength });
	}
	return buckets;
}

/** 桶内二分：桶按 index 升序，取 index ≤ 目标位置的最后一条命中（没有则 null） */
function lastMatchAtOrBefore(
	bucket: MatchBucket,
	index: number,
): RawMatch | null {
	let low = 0;
	let high = bucket.matches.length - 1;
	let found: RawMatch | null = null;
	while (low <= high) {
		const mid = (low + high) >> 1;
		// mid 必然在范围内；这里的判空只是满足 noUncheckedIndexedAccess
		const candidate = bucket.matches[mid];
		if (candidate && candidate.index <= index) {
			found = candidate;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return found;
}

/**
 * 去重规则①：长匹配优先——被更长匹配完整包含的短匹配丢弃。
 *
 * 语义与最初的 O(n²) 双重遍历**逐字一致**：容器必须**严格更长**、边界比较都取等号、
 * 同跨度的重复项不在这里去重（交给后面的 sortAndDedupe）。
 *
 * 为什么能去掉内层全表扫描：本函数跑在**被注入页面的主线程**上，2 MiB 页面能产生 30 万+
 * 条命中，O(n²) 会把页面卡死（实测 2 万条 2.6s、35 万条 10 分钟以上跑不完）。而按上面的
 * 不变量：能完整包含 m 的匹配必须覆盖 m 的起始位置，每个规则里这样的匹配**至多一条**，
 * 且必定是"该规则中 index ≤ m.index 的最后一条"⇒ 每条命中对每个桶只需一次二分，
 * 复杂度从 O(n²) 降到 O(n·R·log n)（R = 规则条数，内置规则 ≤ 10）。
 */
function dropContained(buckets: MatchBucket[]): RawMatch[] {
	const flat: RawMatch[] = [];
	for (const bucket of buckets) {
		for (const match of bucket.matches) flat.push(match);
	}

	const dropped = new Set<RawMatch>();
	for (const bucket of buckets) {
		for (const match of bucket.matches) {
			const end = match.index + match.length;
			for (const other of buckets) {
				// 容器必须严格更长：这个桶里最长都不够长，就不必二分
				if (other.maxLength <= match.length) continue;
				const container = lastMatchAtOrBefore(other, match.index);
				// 找不到 = 本桶没有匹配覆盖 m 的起始位置；
				// 长度不够（含"命中自己"/同跨度重复项）= 不满足"严格更长"
				if (!container || container.length <= match.length) continue;
				if (container.index + container.length >= end) {
					dropped.add(match);
					break;
				}
			}
		}
	}
	// 输出顺序与改写前的 filter 一致：按收集顺序（规则序 → 桶内 index 序）保留
	return flat.filter((match) => !dropped.has(match));
}

/**
 * 去重规则②：锚点自带数字排除（エッチな0930 的 0930、h4610 的 4610、av9898 的 9898）。
 * 数字表来自传入的规则快照（不传 = 内置表）：规则集在这条链路上可注入。
 */
function dropAnchorNumbers(
	matches: RawMatch[],
	rules: UncensoredRules = UNCENSORED_RULES,
): RawMatch[] {
	return matches.filter((match) => !rules.anchorNumbers.includes(match.text));
}

/** 按页面出现顺序去重（大小写不敏感，保留首次出现的原文写法） */
function sortAndDedupe(matches: RawMatch[]): string[] {
	const seen = new Set<string>();
	const candidates: string[] = [];
	for (const match of [...matches].sort((a, b) => a.index - b.index)) {
		const key = match.text.toUpperCase();
		if (seen.has(key)) continue;
		seen.add(key);
		candidates.push(match.text);
	}
	return candidates;
}

/**
 * 两层匹配：T1 任何页面启用；T2 仅当**页面文本**命中锚点表时启用（与 host 无关）。
 * 返回按页面出现顺序排好的候选番号（已套用两条去重规则）。
 * `rules` 可整份替换（测试用合成规则验证去重规则②这类内置语料覆盖不到的链路）。
 */
export function findUncensoredCandidates(
	text: string,
	rules: UncensoredRules = UNCENSORED_RULES,
): string[] {
	const scanText = text || "";
	const sources = hasAnyAnchor(scanText, rules.anchors)
		? [...rules.t1, ...rules.t2]
		: [...rules.t1];
	return sortAndDedupe(
		dropAnchorNumbers(dropContained(collectMatches(scanText, sources)), rules),
	);
}

/**
 * 形态判定：番号本身是不是无码形态（不看页面锚点，因为选源时只有番号字符串）。
 * T1/T2 任一条正则加锚定后整串命中即成立。
 * `HEYZO-3953` 同时是有修正正则的形状，但这里按无码判定优先（spec 决策①：无码优先）。
 *
 * ⚠️ 形态判定**刻意不吃用户配置的排除正则**（`rules.exclude` / 设置里的无修正排除正则）：
 * 排除只作用于**候选列表**（识别出候选之后、`mergeCandidateLists` 那一步），
 * 所以"手动输入 / 直接查询一个已被排除的番号"照样按无码形态走 D2PASS 源
 * ——这是 spec 已定的口径（排除是"列表降噪"，不是"禁止查询"）。别在这里顺手加排除判断。
 */
export function isUncensoredCode(code: string): boolean {
	const trimmed = (code || "").trim();
	if (!trimmed) return false;
	return [...UNCENSORED_RULES.t1, ...UNCENSORED_RULES.t2].some((source) => {
		try {
			return new RegExp(`^(?:${source})$`, "i").test(trimmed);
		} catch {
			return false;
		}
	});
}

/**
 * 注入端要用的规则快照：面板算好，随 executeScript 的 args 传进页面。
 * 非法排除正则一律降级为空（注入端不能因为一个坏正则整页失败）。
 */
export function buildUncensoredRules(excludeRegex: string): UncensoredRules {
	const pattern = (excludeRegex || "").trim();
	return {
		t1: [...UNCENSORED_RULES.t1],
		t2: [...UNCENSORED_RULES.t2],
		anchors: [...UNCENSORED_RULES.anchors],
		anchorNumbers: [...UNCENSORED_RULES.anchorNumbers],
		exclude: pattern && isValidRegex(pattern) ? pattern : "",
	};
}

/**
 * 合并去重用的键：大小写不敏感（trim 之后统一大写）。
 *
 * 大小写口径（有意为之，spec 字面实现）：
 *   · **排除正则吃原始大小写**——`new RegExp(pattern)` 不加 `i` 标志，`^heyzo-` 不排除 `HEYZO-3953`；
 *   · **去重键大小写不敏感**——`heyzo-3953` 与 `HEYZO-3953` 视为同一个号，只留首次出现的写法。
 */
function keyOf(candidate: string): string {
	return candidate.trim().toUpperCase();
}

/**
 * 合并有修正（customRegex）与无码两路候选：
 * ① 无码优先：同一个号两边都命中时只留一条，保留无码那一路的写法，且排在前面；
 * ② 排除正则在**合并去重之后**执行，只对**判定为无码**的候选生效
 *    —— 双命中的号（HEYZO-3953）因此会被彻底移出列表，而不是从无码那路消失、
 *    又从有修正那路活下来（用户看到的就是"我明明排除了它还在列表里"）；
 * ③ 有修正侧的误报不受排除影响（不做全局排除的自然后果）；
 * ④ 大小写口径见 `keyOf`：排除吃原始大小写、去重键大小写不敏感。
 */
export function mergeCandidateLists(
	customCandidates: string[],
	uncensoredCandidates: string[],
	excludeRegex: string,
): string[] {
	const pattern = (excludeRegex || "").trim();
	// 排除正则匹配候选番号字符串本身（不是页面文本）。不加 g 标志：RegExp.test 带 g 会留 lastIndex 状态
	const isExcluded = (candidate: string): boolean => {
		if (!pattern) return false;
		try {
			return new RegExp(pattern).test(candidate);
		} catch {
			return false;
		}
	};

	const uncensoredKeys = new Set(
		uncensoredCandidates.map((candidate) => keyOf(candidate)),
	);
	const merged: string[] = [];
	const seen = new Set<string>();

	for (const candidate of uncensoredCandidates) {
		const trimmed = candidate.trim();
		const key = keyOf(trimmed);
		if (!trimmed || seen.has(key)) continue;
		if (isExcluded(trimmed)) continue;
		seen.add(key);
		merged.push(trimmed);
	}

	for (const candidate of customCandidates) {
		const trimmed = candidate.trim();
		const key = keyOf(trimmed);
		if (!trimmed || seen.has(key)) continue;
		// 判定为无码的号已经在上面处理过（含被排除的情况），绝不能从有修正这路复活
		if (uncensoredKeys.has(key)) continue;
		seen.add(key);
		merged.push(trimmed);
	}

	return merged;
}
