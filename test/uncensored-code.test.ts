import { describe, expect, it } from "vitest";
import {
	UNCENSORED_RULES,
	buildUncensoredRules,
	findUncensoredCandidates,
	isUncensoredCode,
	mergeCandidateLists,
} from "../src/lib/uncensored-code";
import type { UncensoredRules } from "../src/lib/uncensored-code";

/**
 * 裸番号语料（页面无任何锚点 ⇒ T2 不启用）：10/11 命中。
 * 第 11 条 `3953` 是明确不做的纯 4 位裸数字（与 `第1234回`、`IMG_3953.jpg` 无法区分）。
 */
const BARE_CORPUS = [
	"100426-001",
	"100426_01",
	"100326_001",
	"100126_100",
	"100426_1267",
	"100526_001",
	"HEYZO-3953",
	"3dw-315",
	"hitozuma1579",
	"04684",
];

/** 带锚点的弱形态：4/4 命中 */
const WEAK_CORPUS = ["ori1812", "4229-2960", "103_933", "n3351"];

/** 噪音语料：ISO 日期 / 电话 / 版本号 / 文件名 / 订单号 / 价格 / 时间 / 序号 */
const NOISE_CORPUS = [
	"2024-01-15",
	"2024/01/15",
	"2024.01.15",
	"09-1234-5678",
	"090-1234-5678",
	"03-1234-5678",
	"v1.2.3",
	"10.3.5",
	"Version 2.14.03",
	"IMG_3953.jpg",
	"IMG_04684.jpg",
	"DSC04684.JPG",
	"20240115-001",
	"user_id=395312",
	"ORDER-20240115-0001",
	"¥1,980",
	"3980円",
	"1,980円",
	"12:30:45",
	"10:30",
	"2024年01月15日",
	"第1234回",
	"No.0001",
	"No.00001",
	"v2.0.1-beta",
	"movie_1080p.mp4",
	"1920x1080",
	"Tel: +81-90-1234-5678",
	// URL 路径片段：T2 的两条数字型规则曾把路径当番号（`12345/678` 这类候选会绕开
	// isValidCodeCandidate 直接进候选列表）。前向断言加 `/` 之后这 3 条必须 0 命中；
	// 另有 2 条文本上无法与真实番号区分的形态，故意保留为残留（见下方专门用例）。
	"https://site.com/video/12345/678.html",
	"watch/movie/4422/032/index.html",
	"/gallery/1234/567",
];

const ANCHOR_TEXT = "無修正";

/**
 * 合成规则：在内置规则上多加一条能产出 4 位裸数字的 T2，并把 `0930` 列进锚点自带数字。
 * 内置 10 条正则抽不出纯 4 位裸数字，规则②因此没有靶子；合成规则让"命中先产生、
 * 规则②再丢弃"这条链路可被单独观测（配合下方对照用例）。
 */
const SYNTHETIC_RULES: UncensoredRules = {
	...UNCENSORED_RULES,
	t2: [...UNCENSORED_RULES.t2, String.raw`(?<![\d])\d{4}(?![\d])`],
	anchors: [...UNCENSORED_RULES.anchors, "無修正"],
	anchorNumbers: ["0930"],
};

describe("findUncensoredCandidates", () => {
	it("裸番号 10/11 命中：T1 强特征零上下文也生效", () => {
		for (const code of BARE_CORPUS) {
			expect(findUncensoredCandidates(`今日の作品 ${code} です`)).toEqual([
				code,
			]);
		}
	});

	it("纯 4 位裸数字不抽取", () => {
		expect(findUncensoredCandidates("3953")).toEqual([]);
	});

	it("带锚点的弱形态 4/4 命中（T2 启用）", () => {
		for (const code of WEAK_CORPUS) {
			expect(findUncensoredCandidates(`${ANCHOR_TEXT} ${code}`)).toEqual([
				code,
			]);
		}
	});

	it("无锚点时弱形态一条都不抽（T2 门控）", () => {
		for (const code of WEAK_CORPUS) {
			expect(findUncensoredCandidates(code)).toEqual([]);
		}
	});

	it("噪音 28 条 + URL 路径片段 3 条 0 误报（带锚点变体 = T2 全开）", () => {
		for (const noise of NOISE_CORPUS) {
			expect(findUncensoredCandidates(`${ANCHOR_TEXT} ${noise}`)).toEqual([]);
		}
	});

	it("URL 路径残留 2 条：显式钉住当前行为（接受，代价是一次查无）", () => {
		// 这两条**故意不修**（已裁决，见 docs/d2pass-api执行进度.md §4.0）：
		//  · `img/04684/01` 里的 `04684` 是 T1 零填充命中，它与真实 pikkur 链接
		//    `www.pikkur.com/moviepages/04684/index.html` 在文本上无法区分——T1 前向断言若加 `/`
		//    就会漏掉真实番号（漏报比多一条可忽略候选行更糟）；
		//  · `ID:12345/678` 的前一字符是 `:`，T2 前向断言若加 `:` 就会漏掉
		//    `av9898:4422/032`、`番号:4422/032` 这类合法写法。
		// 此处断言的不是"正确"，而是"我们知情地接受这个残留"：多出的一条候选行走一次
		// "查无"即结束，改动回归到这两条时这条用例会提醒重新裁决。
		expect(findUncensoredCandidates(`${ANCHOR_TEXT} img/04684/01`)).toEqual([
			"04684",
		]);
		expect(findUncensoredCandidates(`${ANCHOR_TEXT} ID:12345/678`)).toEqual([
			"12345/678",
		]);
	});

	it("合法 av9898 写法仍命中：前向断言加 / 没把 `4422/032` 一起杀掉", () => {
		// 与上面 3 条 URL 的差别只在"前一字符"：空格 ⇒ 是番号；`/` ⇒ 是路径片段
		expect(findUncensoredCandidates("無修正 4422/032")).toEqual(["4422/032"]);
	});

	it("去重规则①：长匹配优先，被更长匹配包含的短匹配丢弃", () => {
		// `04684` 被 T1 零填充命中，`04684-4229` 被 T2 数字型命中 ⇒ 只留长的
		expect(findUncensoredCandidates(`${ANCHOR_TEXT} 04684-4229`)).toEqual([
			"04684-4229",
		]);
	});

	it("去重规则②：锚点自带的数字不当番号", () => {
		// 内置 10 条正则下纯 4 位裸数字本就抽不出来，规则②无可判别之处；
		// 这里改用合成规则（多一条能产出 4 位裸数字的 T2 + 把该数字列进 anchorNumbers）
		// 让规则②真正有靶子：命中先产生，再由规则②丢弃。
		expect(findUncensoredCandidates("無修正 0930", SYNTHETIC_RULES)).toEqual(
			[],
		);
	});

	it("去重规则②对照：同规则只把 anchorNumbers 清空 ⇒ 同一裸数字必须留下", () => {
		// 与上一条的唯一差别就是 anchorNumbers，这样才证明上一条是规则②在起作用，
		// 而不是别的原因（正则没命中 / 两条去重规则里的另一条）顺带让它为空。
		expect(
			findUncensoredCandidates("無修正 0930", {
				...SYNTHETIC_RULES,
				anchorNumbers: [],
			}),
		).toEqual(["0930"]);
	});

	it("同一个号被 T2 的两条数字型正则同跨度命中时只留一条", () => {
		expect(findUncensoredCandidates(`${ANCHOR_TEXT} 4229-2960`)).toEqual([
			"4229-2960",
		]);
	});

	it("大小写不敏感，输出保留页面原文写法", () => {
		expect(findUncensoredCandidates("heyzo-3953")).toEqual(["heyzo-3953"]);
	});

	it("有码/素人番号不被无码规则误吞", () => {
		expect(findUncensoredCandidates("ABP-123 IPX-118 SNIS-456")).toEqual([]);
	});
});

describe("isUncensoredCode", () => {
	it("按形态整串判定：T1/T2 任一条形状命中即为无码", () => {
		expect(isUncensoredCode("HEYZO-3953")).toBe(true);
		expect(isUncensoredCode("100426-001")).toBe(true);
		expect(isUncensoredCode("4229-2960")).toBe(true);
		expect(isUncensoredCode("n3351")).toBe(true);
	});

	it("有码号、FC2 号、空值都不是无码形态", () => {
		expect(isUncensoredCode("IPX-118")).toBe(false);
		expect(isUncensoredCode("FC2-3061625")).toBe(false);
		expect(isUncensoredCode("")).toBe(false);
	});

	it("噪音语料（含 URL 路径片段）全不是无码形态", () => {
		for (const noise of NOISE_CORPUS) {
			expect(isUncensoredCode(noise)).toBe(false);
		}
	});
});

describe("buildUncensoredRules", () => {
	it("非法排除正则不注入（注入端 new RegExp 不能抛）", () => {
		expect(buildUncensoredRules("([").exclude).toBe("");
		expect(buildUncensoredRules("  HEYZO-  ").exclude).toBe("HEYZO-");
	});

	it("快照带全 8 条内置正则与锚点表", () => {
		const rules = buildUncensoredRules("");
		expect(rules.t1).toEqual(UNCENSORED_RULES.t1);
		expect(rules.t2).toEqual(UNCENSORED_RULES.t2);
		expect(rules.anchors).toEqual(UNCENSORED_RULES.anchors);
		expect(rules.anchorNumbers).toEqual(UNCENSORED_RULES.anchorNumbers);
	});

	it("返回的是副本：改快照不会污染 UNCENSORED_RULES", () => {
		// 注入端拿到的快照会被序列化进页面；面板侧的常量表必须与它无共享引用，
		// 否则页面里一次 push 会改到后台进程里的规则表（而且是静默的）。
		const rules = buildUncensoredRules("");
		rules.t1.push("X");
		rules.t2.push("X");
		rules.anchors.push("X");
		rules.anchorNumbers.push("X");
		expect(UNCENSORED_RULES.t1).not.toContain("X");
		expect(UNCENSORED_RULES.t2).not.toContain("X");
		expect(UNCENSORED_RULES.anchors).not.toContain("X");
		expect(UNCENSORED_RULES.anchorNumbers).not.toContain("X");
	});
});

describe("mergeCandidateLists", () => {
	it("同一号两边都命中：只留一条且按无码那一路（无码在前）", () => {
		expect(
			mergeCandidateLists(["IPX-118", "HEYZO-3953"], ["HEYZO-3953"], ""),
		).toEqual(["HEYZO-3953", "IPX-118"]);
	});

	it("排除命中即丢弃，且只作用于无码侧", () => {
		expect(
			mergeCandidateLists(
				[],
				["HEYZO-3953", "3dw-315", "100426-001"],
				"^(?:HEYZO-3953|3dw-315)$",
			),
		).toEqual(["100426-001"]);
		// 有修正侧的误报（`ABC-12345` 这种形状）不受无码排除正则影响
		expect(mergeCandidateLists(["ABC-12345"], [], "^ABC-")).toEqual([
			"ABC-12345",
		]);
	});

	it("双命中的号被排除后彻底移出列表，且不因有修正那一路而残留", () => {
		// 三个不变量压进一条用例：
		//  ① 被排除的双命中号（`HEYZO-3953`）彻底移出，不从有修正侧复活；
		//  ② 去重键大小写不敏感 ⇒ 有修正侧的 `heyzo-3953` 认得出它就是同一个号；
		//  ③ 排除正则只作用无码侧 ⇒ `ABP-123` 即使自己命中 `^ABP-` 也不受影响。
		expect(
			mergeCandidateLists(["ABP-123", "heyzo-3953"], ["HEYZO-3953"], "^HEYZO-"),
		).toEqual(["ABP-123"]);
		expect(
			mergeCandidateLists(
				["ABP-123", "heyzo-3953"],
				["HEYZO-3953"],
				"^(?:HEYZO-|ABP-)",
			),
		).toEqual(["ABP-123"]);
	});

	it("留空 = 不排除；去重大小写不敏感", () => {
		expect(mergeCandidateLists(["heyzo-3953"], ["HEYZO-3953"], "")).toEqual([
			"HEYZO-3953",
		]);
	});
});

/**
 * 等价性 oracle：把本模块改写前的朴素实现（O(n²) 两两比对，逐字照抄自 `d9c966e`）留在这里当参照，
 * 与新实现（按规则分桶 + 二分）在随机语料与构造语料上逐字比对。
 * 它守的是缺陷 2 的验收口径——"对外行为逐字等价"：以后谁再动 dropContained，语义漂移会被它咬住。
 */
function referenceFindCandidates(text: string): string[] {
	const scanText = text || "";
	const lower = scanText.toLowerCase();
	const anchorsHit = UNCENSORED_RULES.anchors.some((anchor) =>
		lower.includes(anchor.toLowerCase()),
	);
	const sources = anchorsHit
		? [...UNCENSORED_RULES.t1, ...UNCENSORED_RULES.t2]
		: [...UNCENSORED_RULES.t1];

	// —— 以下逐字照抄改写前的实现：它就是参照物，不要"顺手优化" ——
	const matches: { text: string; index: number; length: number }[] = [];
	for (const source of sources) {
		let regex: RegExp;
		try {
			regex = new RegExp(source, "gi");
		} catch {
			continue;
		}
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
		}
	}
	const droppedContained = matches.filter(
		(match) =>
			!matches.some(
				(other) =>
					other !== match &&
					other.length > match.length &&
					other.index <= match.index &&
					other.index + other.length >= match.index + match.length,
			),
	);
	const withoutAnchorNumbers = droppedContained.filter(
		(match) => !UNCENSORED_RULES.anchorNumbers.includes(match.text),
	);
	const seen = new Set<string>();
	const candidates: string[] = [];
	for (const match of [...withoutAnchorNumbers].sort((a, b) => a.index - b.index)) {
		const key = match.text.toUpperCase();
		if (seen.has(key)) continue;
		seen.add(key);
		candidates.push(match.text);
	}
	return candidates;
}

/** 固定种子的伪随机：失败必须可复现，所以不用 Math.random */
function makeRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

/**
 * 拼语料用的片段池：**不带分隔地首尾相接**——这正是最容易造出
 * "短匹配被更长匹配包含"（含数字串被拉长、分隔符被吃进更长匹配）的形态。
 */
const FRAGMENTS = [
	"04684",
	"100426-001",
	"4229-2960",
	"103_933",
	"ori1812",
	"n3351",
	"HEYZO-3953",
	"3dw-315",
	"hitozuma1579",
	"無修正",
	"0930",
	"4610",
	"9898",
	"12345/678",
	"4422/032",
	"04684-4229",
	"2024-01-15",
	"090-1234-5678",
	"/",
	"-",
	"_",
	".",
	":",
	" ",
	"img",
	"av9898",
	"http",
	"//site.com/video",
];

function makeRandomText(rng: () => number): string {
	const count = 8 + Math.floor(rng() * 24);
	let text = "";
	for (let i = 0; i < count; i++) {
		text += FRAGMENTS[Math.floor(rng() * FRAGMENTS.length)];
	}
	return text;
}

describe("dropContained 等价改写", () => {
	it("随机合成语料：与改写前的朴素实现逐字一致", () => {
		const rng = makeRng(20241005);
		for (let round = 0; round < 80; round++) {
			const text = makeRandomText(rng);
			expect(findUncensoredCandidates(text)).toEqual(
				referenceFindCandidates(text),
			);
		}
	});

	it("构造语料：嵌套 / 同跨度重复 / 边界相接 / 锚点自带数字都逐字一致", () => {
		const cases = [
			"無修正 04684-4229", // 短匹配被更长匹配包含（同起点）
			"無修正 4229-2960", // T2 两条数字型同跨度重复
			"無修正 4229-2960-1234", // 链式：容器之上还有容器
			"無修正 100426-001 100426_001", // 大小写/D 形近
			"無修正 ori1812 ori18123 n3351 n335123", // 尾断言挡掉截断形态
			"無修正 04684/01 103_933 103_933_1234",
			"無修正 www.pikkur.com/moviepages/04684/index.html", // 已裁决保留的残留
			"無修正 av9898:4422/032", // 已裁决：不得因为 `:` 而漏掉
			"無修正 0930 4610 9898", // 锚点自带数字（去重规则②）
			"無修正 0930-4610",
			"無修正 20240115-001 090-1234-5678 2024/01/15",
			"無修正 ID:12345/678", // 已裁决保留的残留
			"04684",
			"無修正",
			"",
		];
		for (const text of cases) {
			expect(findUncensoredCandidates(text)).toEqual(
				referenceFindCandidates(text),
			);
		}
	});

	it("规模化（4,000 条原始命中）：仍然逐字一致", () => {
		const text = `無修正 ${"04684 ".repeat(2000)}${"4229-2960 ".repeat(1000)}${"100426-001 ".repeat(1000)}`;
		expect(findUncensoredCandidates(text)).toEqual(referenceFindCandidates(text));
	});
});

describe("性能回归（防止 dropContained 退回 O(n²)）", () => {
	it("2 万条原始命中必须远低于宽松上限（O(n²) 实测 ≈2.3s）", () => {
		// 语料：2 万个零填充 5 位码 ⇒ T1 零填充规则产出 20,000 条原始命中；
		// `無修正` 前缀让 T2 也开起来（10 条规则全部参与，分桶数最全）。
		// 这条测试的意义：谁把等价改写退回"两两比对"，20,000² 次比较会立刻把它打红。
		const text = `無修正 ${"04684 ".repeat(20000)}`;
		// 先钉住语料前提（直接用导出的规则表算，不再抄一份规则文本）：规则被改弱时这里先红
		const rawHits = UNCENSORED_RULES.t1.reduce(
			(sum, source) => sum + (text.match(new RegExp(source, "gi"))?.length ?? 0),
			0,
		);
		expect(rawHits).toBeGreaterThanOrEqual(20000);

		const started = performance.now();
		const candidates = findUncensoredCandidates(text);
		const elapsed = performance.now() - started;

		// 同文本（同跨度）重复项由 sortAndDedupe 收成 1 条
		expect(candidates).toEqual(["04684"]);
		// 上限 1500ms（新实现实测数十 ms）：只为挡住 O(n²)，不给 CI 抖动留假红
		expect(elapsed).toBeLessThan(1500);
	}, 20000);
});
