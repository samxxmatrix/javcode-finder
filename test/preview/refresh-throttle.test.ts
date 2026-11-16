import { describe, expect, it } from "vitest";
import {
	createRefreshThrottle,
	REFRESH_THROTTLE_LIMIT,
	REFRESH_THROTTLE_MS,
} from "../../src/lib/refresh-throttle";

/** 可控时钟：避免真实等待，断言窗口边界 */
function makeClock(start = 0) {
	let now = start;
	return {
		now: () => now,
		advance(ms: number) {
			now += ms;
		},
	};
}

describe("createRefreshThrottle（防连点把源站打穿）", () => {
	it("首次放行，窗口内第二次拒绝", () => {
		const clock = makeClock();
		const throttle = createRefreshThrottle(REFRESH_THROTTLE_MS, REFRESH_THROTTLE_LIMIT, clock.now);

		expect(throttle.allow("ABP-123")).toBe(true);
		expect(throttle.allow("ABP-123")).toBe(false);
	});

	it("超过窗口后再次放行", () => {
		const clock = makeClock();
		const throttle = createRefreshThrottle(REFRESH_THROTTLE_MS, REFRESH_THROTTLE_LIMIT, clock.now);
		throttle.allow("ABP-123");

		clock.advance(REFRESH_THROTTLE_MS - 1);
		expect(throttle.allow("ABP-123")).toBe(false);

		clock.advance(1);
		expect(throttle.allow("ABP-123")).toBe(true);
	});

	it("不同番号互不影响", () => {
		const clock = makeClock();
		const throttle = createRefreshThrottle(REFRESH_THROTTLE_MS, REFRESH_THROTTLE_LIMIT, clock.now);

		expect(throttle.allow("ABP-123")).toBe(true);
		expect(throttle.allow("ABP-124")).toBe(true);
	});

	it("大小写与首尾空白归一：同一番号不会因写法不同各放行一次", () => {
		const clock = makeClock();
		const throttle = createRefreshThrottle(REFRESH_THROTTLE_MS, REFRESH_THROTTLE_LIMIT, clock.now);

		expect(throttle.allow("abp-123")).toBe(true);
		expect(throttle.allow(" ABP-123 ")).toBe(false);
	});

	it("超上限按插入序淘汰最旧，被淘汰的番号可以重新放行", () => {
		const clock = makeClock();
		const throttle = createRefreshThrottle(REFRESH_THROTTLE_MS, 2, clock.now);

		expect(throttle.allow("A-1")).toBe(true);
		expect(throttle.allow("A-2")).toBe(true);
		expect(throttle.allow("A-3")).toBe(true);

		expect(throttle.size()).toBe(2);
		// A-1 已被挤出，不再受窗口约束
		expect(throttle.allow("A-1")).toBe(true);
	});

	it("默认窗口 5 秒、上限 200 条", () => {
		expect(REFRESH_THROTTLE_MS).toBe(5000);
		expect(REFRESH_THROTTLE_LIMIT).toBe(200);
	});
});
