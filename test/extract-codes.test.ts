import { describe, expect, it } from "vitest";
import {
	MAX_CANDIDATES,
	MAX_SCAN_CHARS,
	extractCandidatesFromText,
	extractCandidatesInTab,
} from "../src/lib/extract-codes";
import {
	UNCENSORED_RULES,
	buildUncensoredRules,
	findUncensoredCandidates,
	mergeCandidateLists,
} from "../src/lib/uncensored-code";
import type { UncensoredRules } from "../src/lib/uncensored-code";
import { DEFAULT_CODE_REGEX } from "../src/lib/settings";

describe("extractCandidatesFromText", () => {
	it("extracts multiple standard codes with hyphen or space in occurrence order", () => {
		const text = `
			Welcome to the site. Featured today:
			1. Check out ABP-123 and abp-123 (duplicate should not repeat).
			2. Next is SNIS-456, then IPX 534.
			3. FSDSS-111 and PRED 00222.
		`;

		const { candidates, truncated } = extractCandidatesFromText(text);

		expect(truncated).toBe(false);
		expect(candidates).toContain("ABP-123");
		expect(candidates).toContain("SNIS-456");
		expect(candidates).toContain("IPX 534");
		expect(candidates).toContain("FSDSS-111");
		expect(candidates).toContain("PRED 00222");
	});

	it("deduplicates candidates case-insensitively while preserving first occurrence", () => {
		const text = "ssni-123 is great, SSNI-123 is the same, SsNi-123 again.";
		const { candidates } = extractCandidatesFromText(text);

		expect(candidates).toEqual(["ssni-123"]);
	});

	it("caps maximum unique candidates at 500 and flags truncated", () => {
		let text = "";
		for (let i = 100; i < 700; i++) {
			text += `ABC-${i} `;
		}

		const { candidates, truncated } = extractCandidatesFromText(text);

		expect(candidates.length).toBe(MAX_CANDIDATES);
		expect(truncated).toBe(true);
	});

	it("caps maximum text scan at 2 MiB and flags truncated", () => {
		const prefix = "ABP-999 ";
		const hugePadding = "x".repeat(MAX_SCAN_CHARS + 100);
		const suffix = "SNIS-888";

		const { candidates, truncated } = extractCandidatesFromText(
			prefix + hugePadding + suffix,
		);

		expect(candidates).toContain("ABP-999");
		expect(candidates).not.toContain("SNIS-888");
		expect(truncated).toBe(true);
	});

	it("filters out domain names, URLs, and file names while keeping valid codes", () => {
		const text = `
			Visit https://www.javbus.com/forum/ABP-123 or www.javbus.com or javbus.com
			Also check cdn.jsdelivr.net and missav.ws and page.html and video.mp4
			Valid codes are SSIS-567 and STARS 888.
		`;

		const { candidates } = extractCandidatesFromText(text);

		expect(candidates).toContain("ABP-123");
		expect(candidates).toContain("SSIS-567");
		expect(candidates).toContain("STARS 888");

		expect(candidates).not.toContain("www.javbus.com");
		expect(candidates).not.toContain("javbus.com");
		expect(candidates).not.toContain("cdn.jsdelivr.net");
		expect(candidates).not.toContain("missav.ws");
		expect(candidates).not.toContain("page.html");
		expect(candidates).not.toContain("video.mp4");
	});

	it("strictly enforces 2-6 letters on left and 3-6 digits on right", () => {
		const text = `
			Valid: ABP-123, SSIS-001, FSDSS-12345, ABCDEF-123456, AB-123
			FC2 supported: FC2-1234567, FC2-PPV-1234567
			Invalid letter length: ABCDEFG-123 (7 letters)
			Invalid digit length: ABC-12 (2 digits), ABC-1234567 (7 digits)
			Unspaced: SSIS001, LIUJIAYI1111, KAKA233333
			Non-letter prefix: 259LUXU-123
		`;

		const { candidates } = extractCandidatesFromText(text);

		expect(candidates).toContain("ABP-123");
		expect(candidates).toContain("SSIS-001");
		expect(candidates).toContain("FSDSS-12345");
		expect(candidates).toContain("ABCDEF-123456");
		expect(candidates).toContain("AB-123");
		expect(candidates).toContain("FC2-1234567");
		expect(candidates).toContain("FC2-PPV-1234567");

		expect(candidates).not.toContain("ABCDEFG-123");
		expect(candidates).not.toContain("ABC-12");
		expect(candidates).not.toContain("ABC-1234567");
		expect(candidates).not.toContain("SSIS001");
		expect(candidates).not.toContain("LIUJIAYI1111");
		expect(candidates).not.toContain("KAKA233333");
		expect(candidates).not.toContain("259LUXU-123");
	});

	it("supports custom regex override", () => {
		const text = `
			Checking custom regex:
			FC2-PPV-1234567 and AB-12
		`;

		const customRegex = "\\b(?:FC2[-_\\s]+(?:PPV[-_\\s]+)?\\d+|[A-Za-z]{2}-\\d{2})\\b";
		const { candidates } = extractCandidatesFromText(text, customRegex);

		expect(candidates).toContain("FC2-PPV-1234567");
		expect(candidates).toContain("AB-12");
	});
});

/** 模拟 executeScript 的宿主环境：注入函数只认全局 document */
function stubPage(text: string): void {
	(globalThis as any).document = { body: { innerText: text } };
}

/** 序列化后执行 = 真正被注入页面的那份函数（模块作用域一律不可见） */
const injectedExtract = new Function(
	`return (${extractCandidatesInTab.toString()})`,
)() as typeof extractCandidatesInTab;

/** 自定义正则用一条永不匹配的表达式，隔离出无码这一路（与交叉验证用例同一手法） */
const NEVER_MATCH = "(?!)";

/**
 * 合成规则快照：在内置规则上多加一条能产出 4 位裸数字的 T2，并把 `0930` 列进锚点自带数字。
 * 内置 10 条正则的最短命中是 5 位数字、anchorNumbers 全是 4 位数字，规则②因此在注入副本里
 * 也**不可达**（删掉它整段测试照样全绿）；合成规则让"命中先产生、规则②再丢弃"这条链路
 * 可被单独观测。构造与 test/uncensored-code.test.ts 的 SYNTHETIC_RULES 同形，两边语义保持同步。
 */
const SYNTHETIC_RULES: UncensoredRules = {
	...UNCENSORED_RULES,
	t2: [...UNCENSORED_RULES.t2, String.raw`(?<![\d])\d{4}(?![\d])`],
	anchors: [...UNCENSORED_RULES.anchors, "無修正"],
	anchorNumbers: ["0930"],
};

/** 无码语料：裸番号 10 条 + 带锚点弱形态 4 条 */
const UNCENSORED_CORPUS = [
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

describe("extractCandidatesInTab", () => {
	it("开关关闭（uncensored = null）：结果与改造前逐字一致", () => {
		stubPage(
			"Featured: ABP-123, SNIS-456, FC2-PPV-1234567, and IMG_04684.jpg",
		);
		expect(injectedExtract(DEFAULT_CODE_REGEX, null).candidates).toEqual([
			"ABP-123",
			"SNIS-456",
			"FC2-PPV-1234567",
		]);
	});

	it("开关打开但页面无锚点：只走 T1 强特征（裸番号 10/10）", () => {
		for (const code of UNCENSORED_CORPUS) {
			stubPage(`今日の作品 ${code} です`);
			const rules = buildUncensoredRules("");
			expect(injectedExtract(DEFAULT_CODE_REGEX, rules).candidates).toEqual([
				code,
			]);
		}
	});

	it("开关打开且页面命中锚点：T2 弱形态生效", () => {
		stubPage("無修正 ori1812 と 4229-2960");
		const rules = buildUncensoredRules("");
		expect(injectedExtract(DEFAULT_CODE_REGEX, rules).candidates).toEqual([
			"ori1812",
			"4229-2960",
		]);
	});

	it("同一号两边都命中（HEYZO-3953）：只出现一次且排在无码那一路", () => {
		stubPage("無修正 HEYZO-3953 IPX-118");
		const rules = buildUncensoredRules("");
		expect(injectedExtract(DEFAULT_CODE_REGEX, rules).candidates).toEqual([
			"HEYZO-3953",
			"IPX-118",
		]);
	});

	it("排除正则命中即丢弃；双命中的号被彻底移出；有修正侧误报不受影响", () => {
		stubPage("無修正 HEYZO-3953 ABC-12345");
		const rules = buildUncensoredRules("^HEYZO-");
		expect(injectedExtract(DEFAULT_CODE_REGEX, rules).candidates).toEqual([
			"ABC-12345",
		]);

		// IPX-118 不在无码集里 ⇒ 排除正则不作用于它（"只对判定为无码的候选执行"）
		stubPage("無修正 HEYZO-3953 IPX-118");
		expect(
			injectedExtract(
				DEFAULT_CODE_REGEX,
				buildUncensoredRules("^(?:HEYZO-3953|IPX-118)$"),
			).candidates,
		).toEqual(["IPX-118"]);
	});

	it("去重规则②（注入副本）：anchorNumbers 里那一份裸数字命中后必须被剔除", () => {
		// 内置规则下规则②不可达（最短命中 5 位，anchorNumbers 全是 4 位数字），
		// 所以这里用合成规则快照造靶子：`0930` 先被那条 4 位数字 T2 命中，再由规则②剔除，
		// 结果里只剩**不被剔除的对照号** `4610`（证明用例不是"整体为空"的假绿）。
		stubPage("無修正 0930 4610");
		expect(injectedExtract(NEVER_MATCH, SYNTHETIC_RULES).candidates).toEqual([
			"4610",
		]);

		// 对照：同一份规则只换 anchorNumbers ⇒ 丢掉的是快照里那一个（规则②吃的是注入的快照）
		expect(
			injectedExtract(NEVER_MATCH, {
				...SYNTHETIC_RULES,
				anchorNumbers: ["4610"],
			}).candidates,
		).toEqual(["0930"]);
	});

	// ⚠️ 语料上限边界（两条路径的真实口径差异，历史上就有、目前有意保留）：
	// 注入副本最后套了 MAX_CANDIDATES = 500 的上限（超出返回 `truncated: true`），
	// 而模块侧的 mergeCandidateLists **没有上限**。这条上限是**按页（单次调用）**算的：
	// 实测**同一个页面文本**里 600 条互不相同的无码命中 ⇒ 注入侧 500 + truncated=true、模块侧 600
	// （把 600 条摊到 600 个不同页面上则两边一致、正常通过——本用例逐页比对，所以语料总条数不限，
	// 限的是**单个页面**产出的不同候选数）。某一页一旦超过 500，本用例就必然变红，
	// 而失败信息看起来像"注入副本漂移"，实际只是这条上限口径差异
	// （要放宽就得先裁决两边的上限口径，而不是改这条断言）。
	it("交叉验证：注入函数（页面上下文）与模块纯函数结果逐字一致", () => {
		const rules = buildUncensoredRules("^HEYZO-");
		// 自定义正则用一条永不匹配的表达式，隔离出无码这一路
		const neverMatch = "(?!)";
		const corpus = [
			...UNCENSORED_CORPUS.map((code) => `無修正 ${code} です`),
			"無修正 ori1812 4229-2960 103_933 n3351",
			"無修正 04684-4229",
			"無修正 エッチな0930 h4610 av9898.com",
			"無修正 2024-01-15 090-1234-5678 IMG_3953.jpg 第1234回",
			"無修正 4229-2960 IPX-118 ABP-123",
			"锚点都没有的页面 ori1812 n3351",
		];
		for (const text of corpus) {
			stubPage(text);
			expect(injectedExtract(neverMatch, rules).candidates).toEqual(
				mergeCandidateLists(
					[],
					findUncensoredCandidates(text),
					rules.exclude,
				),
			);
		}
	});
});
