import { describe, expect, it } from "vitest";
import { findUncensoredCandidates } from "../src/lib/uncensored-code";

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
		expect(
			findUncensoredCandidates(`${ANCHOR_TEXT} エッチな0930 h4610 av9898.com`),
		).toEqual([]);
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
