import { describe, expect, it } from "vitest";
import {
	createFalenoMissStore,
	FALENO_MISS_LIMIT,
} from "../../src/lib/faleno-miss";

describe("createFalenoMissStore（FALENO 会话级负缓存）", () => {
	it("只命中被标记过的番号", () => {
		const store = createFalenoMissStore();
		store.mark("FNS-263");

		expect(store.has("FNS-263")).toBe(true);
		expect(store.has("FNS-264")).toBe(false);
		expect(store.size()).toBe(1);
	});

	it("上限内不淘汰", () => {
		const store = createFalenoMissStore(3);
		store.mark("A-1");
		store.mark("A-2");
		store.mark("A-3");

		expect(store.size()).toBe(3);
		expect(store.has("A-1")).toBe(true);
	});

	it("超过上限按插入序淘汰最旧（FIFO）", () => {
		const store = createFalenoMissStore(3);
		store.mark("A-1");
		store.mark("A-2");
		store.mark("A-3");
		store.mark("A-4");

		expect(store.size()).toBe(3);
		// 最旧的被淘汰 → 下次还会再问一次 faleno（不会长期假阴性）
		expect(store.has("A-1")).toBe(false);
		expect(store.has("A-4")).toBe(true);
	});

	it("重复标记已存在的番号不触发淘汰", () => {
		const store = createFalenoMissStore(2);
		store.mark("A-1");
		store.mark("A-2");
		// 重复标记 A-1：Set.add 幂等，不应把 A-1 自己挤掉，也不该淘汰 A-2
		store.mark("A-1");

		expect(store.size()).toBe(2);
		expect(store.has("A-1")).toBe(true);
		expect(store.has("A-2")).toBe(true);
	});

	it("默认上限 200：写入 201 个不同番号后仍是 200 条", () => {
		const store = createFalenoMissStore();
		for (let i = 0; i < 201; i += 1) store.mark(`FNS-${i}`);

		expect(FALENO_MISS_LIMIT).toBe(200);
		expect(store.size()).toBe(200);
		expect(store.has("FNS-0")).toBe(false);
		expect(store.has("FNS-200")).toBe(true);
	});

	it("各 store 相互独立（模块级单例之外的调用方不会互相污染）", () => {
		const a = createFalenoMissStore();
		const b = createFalenoMissStore();
		a.mark("FNS-263");

		expect(a.has("FNS-263")).toBe(true);
		expect(b.has("FNS-263")).toBe(false);
	});
});
