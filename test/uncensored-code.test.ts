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

	it("噪音 28 条 0 误报（带锚点变体 = T2 全开）", () => {
		for (const noise of NOISE_CORPUS) {
			expect(findUncensoredCandidates(`${ANCHOR_TEXT} ${noise}`)).toEqual([]);
		}
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

	it("双命中的号被排除后彻底移出列表（不因有修正匹配而残留）", () => {
		expect(mergeCandidateLists(["HEYZO-3953"], ["HEYZO-3953"], "^HEYZO-")).toEqual(
			[],
		);
	});

	it("留空 = 不排除；去重大小写不敏感", () => {
		expect(mergeCandidateLists(["heyzo-3953"], ["HEYZO-3953"], "")).toEqual([
			"HEYZO-3953",
		]);
	});
});
