import { describe, expect, it } from "vitest";
import {
	computeCenterScrollTop,
	findCodePage,
} from "../../src/lib/reveal-code";

describe("findCodePage", () => {
	it("命中首页与页内最后一项都落在第 0 页", () => {
		const codes = Array.from({ length: 120 }, (_, i) => `CODE-${i}`);
		expect(findCodePage(codes, "CODE-0", 50)).toBe(0);
		expect(findCodePage(codes, "CODE-49", 50)).toBe(0);
	});

	it("第 51 项起进入第 1 页，跨页边界正确", () => {
		const codes = Array.from({ length: 120 }, (_, i) => `CODE-${i}`);
		expect(findCodePage(codes, "CODE-50", 50)).toBe(1);
		expect(findCodePage(codes, "CODE-99", 50)).toBe(1);
		expect(findCodePage(codes, "CODE-100", 50)).toBe(2);
	});

	it("列表里没有该番号时返回 -1，供调用方跳过翻页", () => {
		expect(findCodePage(["ABP-123"], "ABP-999", 50)).toBe(-1);
		expect(findCodePage([], "ABP-123", 50)).toBe(-1);
	});
});

describe("computeCenterScrollTop", () => {
	// 视口 list 高 100，条目高 20 ⇒ 居中后条目上沿应在视口内 40px 处
	const CENTER = 40;

	it("条目完全在可视区内时返回 null，避免无谓跳动", () => {
		expect(
			computeCenterScrollTop({
				itemTop: 100,
				itemHeight: 20,
				viewTop: 100,
				viewHeight: 100,
				scrollTop: 0,
			}),
		).toBeNull();
	});

	it("条目在视口下方时算出把它移到中间的 scrollTop 增量", () => {
		// relTop=150，期望 0 + 150 - 40 = 110
		expect(
			computeCenterScrollTop({
				itemTop: 250,
				itemHeight: 20,
				viewTop: 100,
				viewHeight: 100,
				scrollTop: 0,
			}),
		).toBe(110);
	});

	it("条目在视口上方时同样居中（考虑当前 scrollTop）", () => {
		// relTop=-50，scrollTop=200 ⇒ 200 - 50 - 40 = 110
		const next = computeCenterScrollTop({
			itemTop: 50,
			itemHeight: 20,
			viewTop: 100,
			viewHeight: 100,
			scrollTop: 200,
		});
		expect(next).toBe(110);
		// 结果代入后，条目上沿相对视口的位置应正好是 CENTER
		expect(-50 - ((next as number) - 200)).toBe(CENTER);
	});

	it("条目在视口上方且容器已在顶部时钳到 0，不越界", () => {
		// relTop=-80 ⇒ 算出 -120，必须钳为 0
		expect(
			computeCenterScrollTop({
				itemTop: 20,
				itemHeight: 20,
				viewTop: 100,
				viewHeight: 100,
				scrollTop: 0,
			}),
		).toBe(0);
	});

	it("条目比视口还高时退化为顶部对齐", () => {
		// 条目高 160 > 视口 100，offset 取 0 ⇒ 0 + 200 - 0 = 200
		// 代入后 relTop' = 200 - 200 = 0，即条目上沿贴视口顶部
		expect(
			computeCenterScrollTop({
				itemTop: 300,
				itemHeight: 160,
				viewTop: 100,
				viewHeight: 100,
				scrollTop: 0,
			}),
		).toBe(200);
	});

	it("force=false 时完整可见返回 null（首次揭示：不在显示区域才滚）", () => {
		// 条目上沿在视口内 10px、高 20，完整可见 ⇒ 不动
		expect(
			computeCenterScrollTop({
				itemTop: 110,
				itemHeight: 20,
				viewTop: 100,
				viewHeight: 100,
				scrollTop: 0,
			}),
		).toBeNull();
	});

	it("force=true 时即便完整可见也重新居中（异步补偿：简介加载后回正中间）", () => {
		// 同上坐标，但强制居中 ⇒ 0 + 10 - 40 = -30 钳到 0；
		// 换个能体现位移的坐标：relTop=20 ⇒ 0 + 20 - 40 = -20 → 0
		// 用 relTop=60（仍完整可见，60+20=80<100）⇒ 60-40=20
		expect(
			computeCenterScrollTop(
				{
					itemTop: 160,
					itemHeight: 20,
					viewTop: 100,
					viewHeight: 100,
					scrollTop: 0,
				},
				true,
			),
		).toBe(20);
	});
});
