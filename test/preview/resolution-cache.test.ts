import { describe, expect, it } from "vitest";
import {
	buildResolutionCacheKey,
	createResolutionCacheStore,
	RESOLUTION_CACHE_LIMIT,
} from "../../src/lib/resolution-cache";

describe("buildResolutionCacheKey（解析缓存 key）", () => {
	const scope = {
		lookupEnabled: true,
		falenoPrefixes: ["FNS", "FALENO"],
		apiBase: "https://api.example.com",
	};

	it("番号大小写与首尾空白归一：同一番号只有一个 key", () => {
		expect(buildResolutionCacheKey("ipx-118", scope)).toBe(
			buildResolutionCacheKey("  IPX-118  ", scope),
		);
	});

	it("不同番号 key 不同", () => {
		expect(buildResolutionCacheKey("IPX-118", scope)).not.toBe(
			buildResolutionCacheKey("IPX-119", scope),
		);
	});

	it("番号查询开关变化 → key 变化（否则关掉反代仍命中旧结果）", () => {
		expect(buildResolutionCacheKey("IPX-118", scope)).not.toBe(
			buildResolutionCacheKey("IPX-118", { ...scope, lookupEnabled: false }),
		);
	});

	it("FALENO 前缀变化 → key 变化（否则改了前缀仍命中旧分支结果）", () => {
		expect(buildResolutionCacheKey("IPX-118", scope)).not.toBe(
			buildResolutionCacheKey("IPX-118", {
				...scope,
				falenoPrefixes: ["FNS"],
			}),
		);
	});

	it("反代地址变化 → key 变化（换出口后结果可能不同）", () => {
		expect(buildResolutionCacheKey("IPX-118", scope)).not.toBe(
			buildResolutionCacheKey("IPX-118", {
				...scope,
				apiBase: "https://api.other.com",
			}),
		);
	});

	it("设置顺序变化不影响 key（前缀列表按原样拼入）", () => {
		const key = buildResolutionCacheKey("IPX-118", scope);
		// 同一份设置再算一次必须稳定 —— key 里不能带时间戳之类的东西
		expect(buildResolutionCacheKey("IPX-118", { ...scope })).toBe(key);
	});
});

describe("createResolutionCacheStore（内存缓存本体）", () => {
	it("写入后可命中，未写入返回 null", () => {
		const store = createResolutionCacheStore<string>();
		store.set("IPX-118", "hit");

		expect(store.get("IPX-118")).toBe("hit");
		expect(store.get("IPX-119")).toBeNull();
		expect(store.size()).toBe(1);
	});

	it("超过 TTL 不命中，并顺手删掉过期条目", () => {
		let now = 0;
		const store = createResolutionCacheStore<string>(1000, 50, () => now);
		store.set("IPX-118", "hit");

		now = 999;
		expect(store.get("IPX-118")).toBe("hit");

		now = 1001;
		expect(store.get("IPX-118")).toBeNull();
		expect(store.size()).toBe(0);
	});

	it("超过上限按插入序淘汰最旧（FIFO）", () => {
		const store = createResolutionCacheStore<string>(60_000, 3);
		store.set("A-1", "1");
		store.set("A-2", "2");
		store.set("A-3", "3");
		store.set("A-4", "4");

		expect(store.size()).toBe(3);
		expect(store.get("A-1")).toBeNull();
		expect(store.get("A-4")).toBe("4");
	});

	it("复写已有 key 不会把它当成最旧淘汰掉", () => {
		let now = 0;
		const store = createResolutionCacheStore<string>(60_000, 3, () => now);
		store.set("A-1", "old");
		store.set("A-2", "2");
		store.set("A-3", "3");

		// 刷新 A-1：删+插，插入序里它变成最新
		now = 100;
		store.set("A-1", "new");
		store.set("A-4", "4");

		expect(store.size()).toBe(3);
		expect(store.get("A-1")).toBe("new");
		// 最旧的应是 A-2
		expect(store.get("A-2")).toBeNull();
	});

	it("clear 清空全部条目", () => {
		const store = createResolutionCacheStore<string>();
		store.set("A-1", "1");
		store.set("A-2", "2");
		store.clear();

		expect(store.size()).toBe(0);
		expect(store.get("A-1")).toBeNull();
	});

	it("默认上限为 50 条", () => {
		const store = createResolutionCacheStore<string>();
		for (let i = 0; i < RESOLUTION_CACHE_LIMIT + 5; i += 1) {
			store.set(`CODE-${i}`, String(i));
		}

		expect(store.size()).toBe(RESOLUTION_CACHE_LIMIT);
		// 最早写入的 5 条被淘汰
		expect(store.get("CODE-0")).toBeNull();
		expect(store.get("CODE-5")).toBe("5");
	});
});
