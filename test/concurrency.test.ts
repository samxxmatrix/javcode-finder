import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/lib/concurrency";

describe("mapWithConcurrency", () => {
	it("保序返回每个元素的结果", async () => {
		const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
		expect(out).toEqual([10, 20, 30, 40, 50]);
	});

	it("并发数不超过上限", async () => {
		let running = 0;
		let peak = 0;
		await mapWithConcurrency(
			Array.from({ length: 9 }, (_, i) => i),
			3,
			async () => {
				running += 1;
				peak = Math.max(peak, running);
				await new Promise((resolve) => setTimeout(resolve, 1));
				running -= 1;
				return null;
			},
		);
		expect(peak).toBe(3);
	});

	it("worker 抛错只把该位置置为 null，不影响其它项", async () => {
		const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
			if (n === 2) throw new Error("boom");
			return n;
		});
		expect(out).toEqual([1, null, 3]);
	});

	it("limit <= 0 视为 1；空数组返回空数组", async () => {
		const out = await mapWithConcurrency([1, 2], 0, async (n) => n);
		expect(out).toEqual([1, 2]);
		expect(
			await mapWithConcurrency<number, number>([], 4, async (n) => n),
		).toEqual([]);
	});
});
